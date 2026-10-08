import "server-only";
import {
  sql,
  ensureSchema,
  getConfig,
  listAccounts,
  Account,
  Automation,
  Followup,
  QueueItem,
} from "./db";
import type { Platform, Flow, FlowRun } from "./db";
import { matches, pickRandom } from "./match";
import { normalizarMidia } from "./media";
import {
  sendMessage,
  replyToComment,
  linkMessage,
  buttonsMessage,
  mediaMessage,
  getUserProfile,
  followsAccount,
  reactToMessage,
  GraphError,
  type OutgoingMessage,
} from "./messaging";
import {
  acharNo,
  normalizarGrafo,
  proximoNo,
  saidasDoNo,
  type FlowGraph,
  type FlowNode,
} from "./flow";
import { scheduleTick } from "./qstash";
import { renderVariables, type VariableContext } from "./variables";

// ============================================================
// Recepção: transforma eventos do webhook em itens na fila
// ============================================================

type CommentValue = {
  id: string; // comment_id
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  text?: string;
  parent_id?: string;
};

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { story?: { url?: string; id?: string }; mid?: string };
  };
};

export async function logEvent(accountId: string | null, type: string, payload: unknown) {
  await ensureSchema();
  await sql().query(`insert into events (account_id, type, payload) values ($1, $2, $3)`, [
    accountId,
    type,
    JSON.stringify(payload),
  ]);
}

// A Meta manda o id da conta que recebeu o evento em entry.id — é ele que diz
// qual das contas conectadas deve responder (no Facebook, o id da página). Se
// não bater (id em formato inesperado) e só existir uma conta DAQUELA
// plataforma, ela assume: o palpite só é seguro dentro da mesma plataforma,
// senão um evento de página cairia numa conta do Instagram.
async function resolveAccount(
  entryId: string | undefined,
  platform: Platform
): Promise<Account | null> {
  const accounts = (await listAccounts()).filter((a) => a.platform === platform);
  if (!accounts.length) return null;
  if (entryId) {
    const found = accounts.find((a) => a.ig_user_id === entryId);
    if (found) return found;
  }
  return accounts.length === 1 ? accounts[0] : null;
}

async function activeAutomations(accountId: string): Promise<Automation[]> {
  return (await sql().query(
    `select * from automations
     where account_id = $1 and active = true
     order by created_at asc`,
    [accountId]
  )) as Automation[];
}

function findMatch(
  automations: Automation[],
  trigger: "comment" | "story" | "dm",
  text: string,
  mediaId?: string
): Automation | undefined {
  const candidates = automations.filter((a) => {
    if (!a.triggers.includes(trigger)) return false;
    if (trigger === "comment" && a.media_id && a.media_id !== mediaId) return false;
    if (trigger === "story" && a.story_id && a.story_id !== mediaId) return false;
    return matches(text, a.keywords, a.match_type);
  });
  // automação presa a um post/story específico ganha da genérica
  return (
    candidates.find((a) => (trigger === "story" ? a.story_id : a.media_id)) ?? candidates[0]
  );
}

async function enqueue(item: {
  account_id: string;
  kind: QueueItem["kind"];
  contact_ig_id?: string;
  automation_id?: string;
  comment_id?: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  not_before?: Date;
}): Promise<boolean> {
  const notBefore = item.not_before ?? new Date();
  const rows = (await sql().query(
    `insert into queue (account_id, kind, contact_ig_id, automation_id, comment_id, payload, dedupe_key, not_before)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (dedupe_key) do nothing
     returning id`,
    [
      item.account_id,
      item.kind,
      item.contact_ig_id ?? null,
      item.automation_id ?? null,
      item.comment_id ?? null,
      JSON.stringify(item.payload),
      item.dedupe_key,
      notBefore.toISOString(),
    ]
  )) as { id: string }[];
  const inserted = rows.length > 0;

  // item com atraso: pede pro QStash acordar o app na hora certa
  if (inserted && notBefore.getTime() > Date.now() + 15_000) {
    const config = await getConfig();
    await scheduleTick(config.app_url ?? "", (notBefore.getTime() - Date.now()) / 1000 + 5);
  }
  return inserted;
}

async function upsertContact(
  accountId: string,
  igId: string,
  fields: {
    username?: string | null;
    name?: string | null;
    profile_pic?: string | null;
    last_reply_at?: Date;
    last_automation_id?: string;
  }
) {
  await sql().query(
    `insert into contacts (account_id, ig_id, username, name, profile_pic, last_reply_at, last_automation_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (account_id, ig_id) do update set
       username = coalesce(excluded.username, contacts.username),
       name = coalesce(excluded.name, contacts.name),
       profile_pic = coalesce(excluded.profile_pic, contacts.profile_pic),
       last_reply_at = coalesce(excluded.last_reply_at, contacts.last_reply_at),
       last_automation_id = coalesce(excluded.last_automation_id, contacts.last_automation_id)`,
    [
      accountId,
      igId,
      fields.username ?? null,
      fields.name ?? null,
      fields.profile_pic ?? null,
      fields.last_reply_at?.toISOString() ?? null,
      fields.last_automation_id ?? null,
    ]
  );
}

// O webhook de mensagens só traz o ID interno da pessoa (um número). Busca o
// perfil na primeira mensagem para o contato não ficar salvo como
// "1436974448...".
async function fetchProfileFields(
  account: Account,
  igId: string
): Promise<{ username?: string | null; name?: string | null; profile_pic?: string | null }> {
  const rows = (await sql().query(
    `select username from contacts where account_id = $1 and ig_id = $2`,
    [account.ig_user_id, igId]
  )) as { username: string | null }[];
  if (rows[0]?.username) return {}; // já conhecido
  try {
    const p = await getUserProfile(account, igId);
    return { username: p.username ?? null, name: p.name ?? null, profile_pic: p.profile_pic ?? null };
  } catch {
    return {}; // perfil indisponível (conta privada/apagada): segue só com o id
  }
}

// dia atual em UTC — 1 sequência de follow-up por pessoa/automação/dia
function dayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadAutomation(
  accountId: string,
  automationId: string
): Promise<Automation | undefined> {
  const rows = (await sql().query(
    `select * from automations where id = $1 and account_id = $2 and active = true`,
    [automationId, accountId]
  )) as Automation[];
  return rows[0];
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// Quantas vezes repetimos o pedido antes de parar de insistir. A verificação
// continua acontecendo depois disso — só o lembrete para, para não virar spam
// (e não chamar a atenção da Meta).
const MAX_PEDIDOS_DE_FOLLOW = 5;

async function limparEstadoDeFollow(accountId: string, igId: string) {
  await sql().query(
    `update contacts set
       awaiting = case when awaiting = 'follow' then null else awaiting end,
       follow_attempts = 0
     where account_id = $1 and ig_id = $2`,
    [accountId, igId]
  );
}

// Portão de seguidor: devolve true só quando a pessoa REALMENTE segue.
// Enquanto não seguir, marca o estado, repete o pedido (com moderação) e
// devolve false — o próximo passo do fluxo não sai.
async function portaoDeFollow(
  account: Account,
  auto: Automation,
  contactIgId: string
): Promise<boolean> {
  if (!auto.require_follow) return true;

  const segue = await followsAccount(account, contactIgId);

  if (segue === null) {
    // A Meta não informou (ou é uma página do Facebook, onde esse dado não
    // existe). Barrar aqui deixaria TODA a base presa caso o campo fique
    // indisponível (permissão, instabilidade) — e o dono do painel só
    // descobriria pelos clientes reclamando. Então libera e registra, para o
    // erro aparecer em Atividade em vez de virar uma automação morta e muda.
    await logEvent(account.ig_user_id, "follow_check_unavailable", {
      contact_ig_id: contactIgId,
      automation_id: auto.id,
    });
    await limparEstadoDeFollow(account.ig_user_id, contactIgId);
    return true;
  }

  if (segue) {
    await limparEstadoDeFollow(account.ig_user_id, contactIgId);
    return true;
  }

  // Ainda não segue: guarda o estado e conta a tentativa
  const rows = (await sql().query(
    `update contacts set awaiting = 'follow', follow_attempts = follow_attempts + 1
     where account_id = $1 and ig_id = $2
     returning follow_attempts`,
    [account.ig_user_id, contactIgId]
  )) as { follow_attempts: number }[];
  const tentativa = rows[0]?.follow_attempts ?? 1;

  if (tentativa <= MAX_PEDIDOS_DE_FOLLOW) {
    await enqueue({
      account_id: account.ig_user_id,
      kind: "dm_follow_gate",
      contact_ig_id: contactIgId,
      automation_id: auto.id,
      payload: {
        text:
          tentativa === 1
            ? auto.follow_text || "Antes de te mandar o link, me segue lá no perfil 🙏"
            : "Ainda não consegui ver você na minha lista de seguidores 👀 Segue lá e toca no botão de novo.",
        quick_reply_label: auto.follow_button_label || "Já sigo! ✅",
        quick_reply_payload: `FOLLOW:${auto.id}`,
      },
      // a tentativa entra na chave: cada pedido é um item novo na fila
      dedupe_key: `fg:${auto.id}:${contactIgId}:${dayBucket()}:${tentativa}`,
    });
  }
  return false;
}

// Decide qual é o PRÓXIMO passo do fluxo desta pessoa:
// seguir o perfil → informar o e-mail → receber o link.
// Cada etapa é opcional; sem nenhuma ligada, o link sai direto (como antes).
async function advanceFlow(account: Account, auto: Automation, contactIgId: string) {
  if (!(await portaoDeFollow(account, auto, contactIgId))) return;

  if (auto.ask_email) {
    const rows = (await sql().query(
      `select email from contacts where account_id = $1 and ig_id = $2`,
      [account.ig_user_id, contactIgId]
    )) as { email: string | null }[];
    if (!rows[0]?.email) {
      await sql().query(
        `update contacts set awaiting = 'email' where account_id = $1 and ig_id = $2`,
        [account.ig_user_id, contactIgId]
      );
      await enqueue({
        account_id: account.ig_user_id,
        kind: "dm_email_ask",
        contact_ig_id: contactIgId,
        automation_id: auto.id,
        payload: {
          text: auto.email_text || "Me manda seu melhor e-mail que eu te envio o link 👇",
        },
        dedupe_key: `ea:${auto.id}:${contactIgId}:${dayBucket()}`,
      });
      return;
    }
  }

  await enqueueFollowups(account.ig_user_id, auto.id, contactIgId);
}

async function enqueueFollowups(accountId: string, automationId: string, contactIgId: string) {
  const followups = (await sql().query(
    `select * from followups where automation_id = $1 order by position asc`,
    [automationId]
  )) as Followup[];
  for (const f of followups) {
    await enqueue({
      account_id: accountId,
      kind:
        f.kind === "link" ? "dm_link" : f.kind === "followup" ? "dm_followup" : "dm_reminder",
      contact_ig_id: contactIgId,
      automation_id: automationId,
      payload: {
        text: f.text,
        button_label: f.button_label,
        url: f.url,
        media: { kind: f.media_type, url: f.media_url },
      },
      dedupe_key: `fu:${f.id}:${contactIgId}:${dayBucket()}`,
      not_before: new Date(Date.now() + f.delay_minutes * 60_000),
    });
  }
}

// ============================================================
// Fluxos: o mapa de blocos em execução
//
// A automação simples percorre sempre a mesma sequência. O fluxo caminha pelo
// mapa: a cada bloco ele decide se manda mensagem, espera, pergunta algo ou
// segue para o próximo — e onde ele PARA fica guardado em flow_runs, porque a
// continuação depende de um evento futuro (um toque no botão, um e-mail, um
// tempo passar) que chega em outra requisição.
// ============================================================

async function activeFlows(accountId: string): Promise<Flow[]> {
  return (await sql().query(
    `select * from flows where account_id = $1 and active = true order by created_at asc`,
    [accountId]
  )) as Flow[];
}

async function carregarFluxo(accountId: string, flowId: string): Promise<Flow | null> {
  const rows = (await sql().query(
    `select * from flows where id = $1 and account_id = $2 and active = true`,
    [flowId, accountId]
  )) as Flow[];
  return rows[0] ?? null;
}

function grafoDoFluxo(flow: Flow): FlowGraph {
  return normalizarGrafo({ nodes: flow.nodes, edges: flow.edges });
}

function acharFluxo(
  flows: Flow[],
  trigger: "comment" | "story" | "dm",
  text: string,
  mediaId?: string
): Flow | undefined {
  const candidatos = flows.filter((f) => {
    if (f.trigger !== trigger) return false;
    if (trigger === "comment" && f.media_id && f.media_id !== mediaId) return false;
    if (trigger === "story" && f.story_id && f.story_id !== mediaId) return false;
    return matches(text, f.keywords, f.match_type);
  });
  // preso a um post específico ganha do genérico, igual à automação simples
  return candidatos.find((f) => (trigger === "story" ? f.story_id : f.media_id)) ?? candidatos[0];
}

async function salvarPosicao(
  accountId: string,
  contactId: string,
  flowId: string,
  nodeId: string | null,
  awaiting: string | null
) {
  await sql().query(
    `insert into flow_runs (account_id, contact_ig_id, flow_id, node_id, awaiting, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (account_id, contact_ig_id) do update set
       flow_id = excluded.flow_id,
       node_id = excluded.node_id,
       awaiting = excluded.awaiting,
       updated_at = now()`,
    [accountId, contactId, flowId, nodeId, awaiting]
  );
}

async function encerrarPosicao(accountId: string, contactId: string) {
  await sql().query(`delete from flow_runs where account_id = $1 and contact_ig_id = $2`, [
    accountId,
    contactId,
  ]);
}

async function posicaoAtual(accountId: string, contactId: string): Promise<FlowRun | null> {
  const rows = (await sql().query(
    `select * from flow_runs where account_id = $1 and contact_ig_id = $2`,
    [accountId, contactId]
  )) as FlowRun[];
  return rows[0] ?? null;
}

// Mensagem de um bloco. O formato do payload é diferente do da automação
// simples (lista de botões em vez de um só), e é o processItem que traduz isso
// para a API na hora do envio.
async function enfileirarBloco(opts: {
  account: Account;
  flow: Flow;
  node: FlowNode;
  contactId: string;
  commentId: string | null;
  origem: string;
  // Por padrão cada botão avança pela sua saída. O portão de seguidor usa isto
  // para reconferir o MESMO bloco em vez de avançar.
  payloadDoBotao?: string;
}) {
  const { node, flow } = opts;
  const respostas = node.buttonMode === "reply" ? (node.buttons ?? []) : [];
  const links = node.buttonMode === "url" ? (node.buttons ?? []) : [];

  await enqueue({
    account_id: opts.account.ig_user_id,
    // resposta privada ao comentário fura a janela de 24h; daí em diante é
    // conversa normal no privado
    kind: opts.commentId ? "private_reply" : "flow_message",
    contact_ig_id: opts.contactId,
    comment_id: opts.commentId ?? undefined,
    payload: {
      text: node.text ?? "",
      buttons: links.filter((b) => b.url).map((b) => ({ title: b.label, url: b.url })),
      quick_replies: respostas.map((b, i) => ({
        title: b.label,
        payload: opts.payloadDoBotao ?? `FLOW:${flow.id}:${node.id}:${i}`,
      })),
      media: { kind: node.mediaKind, url: node.mediaUrl },
    },
    // idempotência pelo evento que originou o passo: se a Meta reenviar o
    // mesmo comentário ou o mesmo toque de botão, o bloco não sai duas vezes
    dedupe_key: `fx:${opts.origem}:${node.id}`,
  });
}

// Quantos blocos o fluxo pode atravessar de uma vez. O editor permite ligar um
// bloco de volta a um anterior, e sem este teto um ciclo viraria envio infinito.
const MAX_BLOCOS_POR_VEZ = 25;

// Caminha pelo mapa a partir de um bloco, até precisar esperar alguma coisa.
async function executarDoNo(opts: {
  account: Account;
  flow: Flow;
  graph: FlowGraph;
  nodeId: string | null;
  contactId: string;
  origem: string;
  commentId?: string | null;
}) {
  const { account, flow, graph, contactId, origem } = opts;
  const accountId = account.ig_user_id;
  // só a PRIMEIRA mensagem responde ao comentário; as seguintes vão para a DM
  let commentId = opts.commentId ?? null;
  let atual = opts.nodeId;

  for (let passo = 0; passo < MAX_BLOCOS_POR_VEZ; passo++) {
    const node = acharNo(graph, atual);
    if (!node) break;

    if (node.kind === "start") {
      atual = proximoNo(graph, node.id);
      continue;
    }

    if (node.kind === "message") {
      await enfileirarBloco({ account, flow, node, contactId, commentId, origem });
      commentId = null;
      const esperaResposta = saidasDoNo(node).some((s) => s.handle.startsWith("btn:"));
      if (esperaResposta) {
        await salvarPosicao(accountId, contactId, flow.id, node.id, "button");
        return;
      }
      atual = proximoNo(graph, node.id);
      continue;
    }

    if (node.kind === "delay") {
      const destino = proximoNo(graph, node.id);
      if (!destino) break;
      await enqueue({
        account_id: accountId,
        kind: "flow_resume",
        contact_ig_id: contactId,
        payload: { flow_id: flow.id, node_id: destino },
        dedupe_key: `fw:${origem}:${node.id}`,
        not_before: new Date(Date.now() + (node.minutes ?? 60) * 60_000),
      });
      await salvarPosicao(accountId, contactId, flow.id, node.id, "delay");
      return;
    }

    if (node.kind === "ask_email") {
      const rows = (await sql().query(
        `select email from contacts where account_id = $1 and ig_id = $2`,
        [accountId, contactId]
      )) as { email: string | null }[];
      if (rows[0]?.email) {
        // já temos o e-mail dessa pessoa: não faz sentido pedir de novo
        atual = proximoNo(graph, node.id);
        continue;
      }
      await enfileirarBloco({
        account,
        flow,
        node: { ...node, buttons: [], text: node.text || "Me manda seu melhor e-mail 👇" },
        contactId,
        commentId,
        origem,
      });
      await salvarPosicao(accountId, contactId, flow.id, node.id, "email");
      return;
    }

    // Etiqueta: marca a pessoa e segue em frente. array_append só entra quando
    // a etiqueta ainda não está lá, para não duplicar em quem passa duas vezes.
    if (node.kind === "tag") {
      const etiqueta = node.tag?.trim();
      if (etiqueta) {
        await sql().query(
          `update contacts set tags = array_append(tags, $3)
           where account_id = $1 and ig_id = $2 and not (tags @> array[$3]::text[])`,
          [accountId, contactId, etiqueta]
        );
      }
      atual = proximoNo(graph, node.id);
      continue;
    }

    if (node.kind === "follow_gate") {
      const segue = await followsAccount(account, contactId);
      if (segue === false) {
        await enfileirarBloco({
          account,
          flow,
          node: {
            ...node,
            text: node.text || "Antes de continuar, me segue lá no perfil 🙏",
            buttonMode: "reply",
            buttons: [{ label: node.buttonLabel || "Já sigo! ✅" }],
          },
          contactId,
          commentId,
          origem,
          // o botão deste bloco reconfere o seguidor: volta ao MESMO bloco
          payloadDoBotao: `FLOWGATE:${flow.id}:${node.id}`,
        });
        await salvarPosicao(accountId, contactId, flow.id, node.id, "follow");
        return;
      }
      if (segue === null) {
        // a Meta não informou (ou é página do Facebook): libera e registra, em
        // vez de deixar a pessoa presa num portão que ninguém consegue abrir
        await logEvent(accountId, "follow_check_unavailable", {
          contact_ig_id: contactId,
          flow_id: flow.id,
        });
      }
      atual = proximoNo(graph, node.id);
      continue;
    }

    break;
  }

  // chegou ao fim do mapa: a pessoa sai do fluxo
  await encerrarPosicao(accountId, contactId);
}

// Começa o fluxo do zero para esta pessoa.
async function iniciarFluxo(
  account: Account,
  flow: Flow,
  contactId: string,
  origem: string,
  commentId?: string | null
) {
  const graph = grafoDoFluxo(flow);
  const start = graph.nodes.find((n) => n.kind === "start");
  await executarDoNo({
    account,
    flow,
    graph,
    nodeId: start ? start.id : null,
    contactId,
    origem,
    commentId,
  });
}

// Retoma de um bloco específico (toque no botão, e-mail recebido, espera
// vencida). Fluxo apagado ou desativado no meio do caminho: encerra sem erro.
async function retomarFluxo(
  account: Account,
  flowId: string,
  nodeId: string | null,
  contactId: string,
  origem: string
) {
  const flow = await carregarFluxo(account.ig_user_id, flowId);
  if (!flow) {
    await encerrarPosicao(account.ig_user_id, contactId);
    return;
  }
  await executarDoNo({
    account,
    flow,
    graph: grafoDoFluxo(flow),
    nodeId,
    contactId,
    origem,
  });
}

// Toque num botão de fluxo: FLOW:<fluxo>:<bloco>:<indice do botão>
async function seguirBotaoDeFluxo(account: Account, payload: string, contactId: string, origem: string) {
  const [, flowId, nodeId, indice] = payload.split(":");
  if (!flowId || !nodeId) return;
  const flow = await carregarFluxo(account.ig_user_id, flowId);
  if (!flow) return;
  const graph = grafoDoFluxo(flow);
  const destino = proximoNo(graph, nodeId, `btn:${Number(indice) || 0}`);
  if (!destino) {
    // botão sem destino: o editor avisa, mas se salvou assim mesmo, a pessoa
    // simplesmente sai do fluxo em vez de ficar esperando para sempre
    await encerrarPosicao(account.ig_user_id, contactId);
    return;
  }
  await executarDoNo({ account, flow, graph, nodeId: destino, contactId, origem });
}

// Mensagem recebida enquanto a pessoa está parada num bloco. Devolve true
// quando o fluxo tratou a mensagem — daí a automação simples nem entra.
async function fluxoTratouMensagem(
  account: Account,
  contactId: string,
  text: string,
  origem: string
): Promise<boolean> {
  const run = await posicaoAtual(account.ig_user_id, contactId);
  if (!run) return false;

  if (run.awaiting === "email") {
    const email = extractEmail(text);
    if (!email) {
      const flow = await carregarFluxo(account.ig_user_id, run.flow_id);
      if (!flow) return false;
      await enqueue({
        account_id: account.ig_user_id,
        kind: "flow_message",
        contact_ig_id: contactId,
        payload: { text: "Acho que esse e-mail saiu errado 🤔 Me manda de novo, só o e-mail." },
        dedupe_key: `fxe:${origem}`,
      });
      return true;
    }
    await sql().query(
      `update contacts set email = $3 where account_id = $1 and ig_id = $2`,
      [account.ig_user_id, contactId, email]
    );
    const flow = await carregarFluxo(account.ig_user_id, run.flow_id);
    if (!flow) {
      await encerrarPosicao(account.ig_user_id, contactId);
      return true;
    }
    const graph = grafoDoFluxo(flow);
    await executarDoNo({
      account,
      flow,
      graph,
      nodeId: proximoNo(graph, run.node_id ?? ""),
      contactId,
      origem,
    });
    return true;
  }

  if (run.awaiting === "follow") {
    // qualquer mensagem ("já segui", "pronto") vale como pedido de reconferir
    await retomarFluxo(account, run.flow_id, run.node_id, contactId, origem);
    return true;
  }

  return false;
}

// Já houve boas-vindas recentes (e o link ainda não saiu)?
// Evita reenviar o link quando a pessoa só manda "obrigado" depois.
async function shouldFallbackFollowup(
  accountId: string,
  automationId: string,
  contactIgId: string
): Promise<boolean> {
  const rows = (await sql().query(
    `select
       exists(
         select 1 from queue
         where account_id = $1 and contact_ig_id = $2 and automation_id = $3
           and kind in ('private_reply','dm_welcome') and status = 'sent'
           and sent_at > now() - interval '7 days'
       ) as welcomed,
       exists(
         select 1 from queue
         where account_id = $1 and contact_ig_id = $2 and automation_id = $3
           and kind = 'dm_link' and status in ('pending','sending','sent')
           and created_at > now() - interval '7 days'
       ) as linked`,
    [accountId, contactIgId, automationId]
  )) as { welcomed: boolean; linked: boolean }[];
  return Boolean(rows[0]?.welcomed) && !rows[0]?.linked;
}

export async function handleCommentEvent(
  entryId: string | undefined,
  value: CommentValue,
  platform: Platform = "instagram"
) {
  const account = await resolveAccount(entryId, platform);
  if (!account) return;
  const fromId = value.from?.id;
  const commentId = value.id;
  if (!fromId || !commentId) return;

  // ---------- duas travas contra o laço ----------
  //
  // A resposta pública é postada em /{comment_id}/replies, ou seja: ela é
  // ela mesma um comentário, dentro da thread, e a Meta manda webhook dela.
  // Se ela voltar aqui como um comentário qualquer, a automação responde de
  // novo — e a mesma pessoa recebe duas respostas públicas no mesmo
  // comentário, que foi exatamente o que apareceu em produção.
  //
  // 1) É comentário nosso? Comparar só o id não basta: o id que a Meta manda
  //    em from.id nem sempre é o mesmo id com que a conta está salva aqui
  //    (formatos diferentes entre webhook e login). O @ é a segunda tranca.
  const meuUsuario = account.username?.trim().toLowerCase();
  const quemComentou = value.from?.username?.trim().toLowerCase();
  if (fromId === account.ig_user_id || (meuUsuario && quemComentou === meuUsuario)) return;

  // 2) É resposta dentro de uma thread? A automação existe para reagir a
  //    comentários NO POST. Resposta dentro de thread é justamente a forma da
  //    nossa própria resposta — e é o que sustenta o laço mesmo quando a
  //    trava 1 não reconhece a conta. Também evita responder a mesma pessoa
  //    várias vezes quando a conversa continua embaixo do mesmo comentário.
  if (value.parent_id) {
    await logEvent(account.ig_user_id, "comment_ignorado", {
      motivo: "resposta dentro de uma thread, não um comentário no post",
      comment_id: commentId,
      parent_id: value.parent_id,
    });
    return;
  }

  await logEvent(account.ig_user_id, "comment", value);

  // Fluxo primeiro: quem montou um mapa espera que ele mande, e não a
  // automação simples que por acaso tem a mesma palavra-chave.
  const flow = acharFluxo(
    await activeFlows(account.ig_user_id),
    "comment",
    value.text ?? "",
    value.media?.id
  );
  if (flow) {
    await upsertContact(account.ig_user_id, fromId, {
      username: value.from?.username ?? null,
    });
    const respostaPublica = pickRandom(flow.public_replies);
    if (respostaPublica) {
      await enqueue({
        account_id: account.ig_user_id,
        kind: "comment_reply",
        contact_ig_id: fromId,
        comment_id: commentId,
        payload: { text: respostaPublica },
        dedupe_key: `cr:${commentId}`,
      });
    }
    await iniciarFluxo(account, flow, fromId, `c:${commentId}`, commentId);
    return;
  }

  const automations = await activeAutomations(account.ig_user_id);
  const auto = findMatch(automations, "comment", value.text ?? "", value.media?.id);
  if (!auto) return;

  await upsertContact(account.ig_user_id, fromId, {
    username: value.from?.username ?? null,
    last_automation_id: auto.id,
  });

  // Resposta PRIVADA ao comentário: fura a janela de 24h,
  // 1 vez por comentário, válida por até 7 dias.
  if (auto.welcome_text) {
    await enqueue({
      account_id: account.ig_user_id,
      kind: "private_reply",
      contact_ig_id: fromId,
      automation_id: auto.id,
      comment_id: commentId,
      payload: {
        text: auto.welcome_text,
        quick_reply_label: auto.quick_reply_label,
        quick_reply_payload: `AUTO:${auto.id}`,
      },
      dedupe_key: `pr:${commentId}`,
    });
  }

  // Resposta pública opcional no comentário (sorteia variação)
  const publicReply = pickRandom(auto.public_replies);
  if (publicReply) {
    await enqueue({
      account_id: account.ig_user_id,
      kind: "comment_reply",
      contact_ig_id: fromId,
      automation_id: auto.id,
      comment_id: commentId,
      payload: { text: publicReply },
      dedupe_key: `cr:${commentId}`,
    });
  }
}

// O webhook "feed" da página do Facebook é um balaio: curtida, reação, post
// novo, compartilhamento e comentário chegam todos no mesmo campo. Aqui a gente
// separa só o que interessa (comentário recém-criado) e traduz para o mesmo
// formato do evento do Instagram — daí para frente o fluxo é literalmente o
// mesmo código.
type FeedValue = {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  message?: string;
  from?: { id?: string; name?: string };
};

export async function handleFacebookFeedChange(entryId: string | undefined, value: FeedValue) {
  if (value.item !== "comment") return;
  // "add" é comentário novo; edited/remove/hide não devem disparar automação
  if (value.verb && value.verb !== "add") return;
  if (!value.comment_id) return;

  await handleCommentEvent(
    entryId,
    {
      id: value.comment_id,
      from: { id: value.from?.id, username: value.from?.name },
      media: { id: value.post_id },
      text: value.message ?? "",
      parent_id: value.parent_id,
    },
    "facebook"
  );
}

export async function handleMessagingEvent(
  entryId: string | undefined,
  ev: MessagingEvent,
  platform: Platform = "instagram"
) {
  const account = await resolveAccount(entryId, platform);
  if (!account) return;
  const msg = ev.message;
  const senderId = ev.sender?.id;
  if (!msg || !senderId) return;
  if (msg.is_echo) return; // mensagem enviada por nós mesmos
  if (senderId === account.ig_user_id) return;

  const isStoryReply = Boolean(msg.reply_to?.story);
  const isQuickReply = Boolean(msg.quick_reply?.payload);
  const type = isQuickReply ? "quick_reply" : isStoryReply ? "story_reply" : "message";
  await logEvent(account.ig_user_id, type, ev);

  // Qualquer mensagem recebida abre/renova a janela de 24h
  const profile = await fetchProfileFields(account, senderId);
  await upsertContact(account.ig_user_id, senderId, { ...profile, last_reply_at: new Date() });

  const origem = msg.mid ?? `${senderId}:${Date.now()}`;

  // Toque num botão de resposta rápida → segue o fluxo
  if (isQuickReply) {
    const payload = msg.quick_reply!.payload!;
    if (payload.startsWith("FLOW:")) {
      await seguirBotaoDeFluxo(account, payload, senderId, origem);
      return;
    }
    if (payload.startsWith("FLOWGATE:")) {
      // "Já sigo!" dentro de um fluxo: reexecuta o mesmo portão, que consulta
      // a API de novo e só então libera o próximo bloco
      const [, flowId, nodeId] = payload.split(":");
      await retomarFluxo(account, flowId, nodeId, senderId, origem);
      return;
    }
    if (payload.startsWith("AUTO:")) {
      const auto = await loadAutomation(account.ig_user_id, payload.slice(5));
      if (auto) await advanceFlow(account, auto, senderId);
    } else if (payload.startsWith("FOLLOW:")) {
      // "Já sigo!" — consulta a API de novo. Só passa se realmente seguir.
      const auto = await loadAutomation(account.ig_user_id, payload.slice(7));
      if (auto) await advanceFlow(account, auto, senderId);
    }
    return;
  }

  const text = msg.text ?? "";

  // A pessoa está parada dentro de um fluxo (esperando e-mail ou o follow)?
  if (await fluxoTratouMensagem(account, senderId, text, origem)) return;

  // Estamos esperando o e-mail desta pessoa?
  const estado = (await sql().query(
    `select awaiting, last_automation_id from contacts where account_id = $1 and ig_id = $2`,
    [account.ig_user_id, senderId]
  )) as { awaiting: string | null; last_automation_id: string | null }[];

  // Esperando que ela siga? Qualquer mensagem ("já segui", "pronto", "ok")
  // vale como "quero continuar" e dispara nova consulta à API.
  if (estado[0]?.awaiting === "follow") {
    const auto = estado[0].last_automation_id
      ? await loadAutomation(account.ig_user_id, estado[0].last_automation_id)
      : undefined;
    if (auto) await advanceFlow(account, auto, senderId);
    return;
  }

  if (estado[0]?.awaiting === "email") {
    const email = extractEmail(text);
    if (email) {
      await sql().query(
        `update contacts set email = $3, awaiting = null where account_id = $1 and ig_id = $2`,
        [account.ig_user_id, senderId, email]
      );
      const auto = estado[0].last_automation_id
        ? await loadAutomation(account.ig_user_id, estado[0].last_automation_id)
        : undefined;
      if (auto) await enqueueFollowups(account.ig_user_id, auto.id, senderId);
      return;
    }
    // não parecia um e-mail: pede de novo, uma vez por mensagem recebida
    await enqueue({
      account_id: account.ig_user_id,
      kind: "dm_email_ask",
      contact_ig_id: senderId,
      automation_id: estado[0].last_automation_id ?? undefined,
      payload: { text: "Acho que esse e-mail saiu errado 🤔 Me manda de novo, só o e-mail." },
      dedupe_key: `ear:${msg.mid ?? `${senderId}:${Date.now()}`}`,
    });
    return;
  }
  const trigger = isStoryReply ? "story" : "dm";

  // Gatilho de fluxo, de novo antes da automação simples
  const fluxo = acharFluxo(
    await activeFlows(account.ig_user_id),
    trigger,
    text,
    msg.reply_to?.story?.id
  );
  if (fluxo) {
    await iniciarFluxo(account, fluxo, senderId, origem);
    return;
  }

  const automations = await activeAutomations(account.ig_user_id);
  const auto = findMatch(automations, trigger, text, msg.reply_to?.story?.id);

  if (auto) {
    // Coraçãozinho na resposta de story, como no ManyChat
    if (isStoryReply && auto.story_reaction && msg.mid) {
      await enqueue({
        account_id: account.ig_user_id,
        kind: "story_reaction",
        contact_ig_id: senderId,
        automation_id: auto.id,
        payload: { message_id: msg.mid, reaction: auto.story_reaction },
        dedupe_key: `rx:${msg.mid}`,
      });
    }

    // Conversa já aberta (a pessoa nos mandou mensagem) → DM direta
    if (auto.welcome_text) {
      await enqueue({
        account_id: account.ig_user_id,
        kind: "dm_welcome",
        contact_ig_id: senderId,
        automation_id: auto.id,
        payload: {
          text: auto.welcome_text,
          quick_reply_label: auto.quick_reply_label,
          quick_reply_payload: `AUTO:${auto.id}`,
          media: { kind: auto.welcome_media_type, url: auto.welcome_media_url },
        },
        dedupe_key: `wm:${msg.mid ?? `${senderId}:${Date.now()}`}`,
      });
      await upsertContact(account.ig_user_id, senderId, { last_automation_id: auto.id });
    }
    return;
  }

  // Sem palavra-chave, mas a pessoa respondeu com texto em vez de tocar
  // no botão: se a última automação dela ainda está ativa, segue o fluxo.
  const lastAuto = estado[0]?.last_automation_id;
  if (
    lastAuto &&
    automations.some((a) => a.id === lastAuto) &&
    (await shouldFallbackFollowup(account.ig_user_id, lastAuto, senderId))
  ) {
    await enqueueFollowups(account.ig_user_id, lastAuto, senderId);
  }
}

// ============================================================
// Envio: drena a fila respeitando limites da Meta
// ============================================================

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HOURLY_CAP = 190; // margem sobre o limite prático de ~200/h, POR CONTA
const BATCH_SIZE = 15;
const GAP_MS = 600; // ~1,6 envios/segundo

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function windowOpen(accountId: string, contactIgId: string | null): Promise<boolean> {
  if (!contactIgId) return false;
  const rows = (await sql().query(
    `select last_reply_at from contacts where account_id = $1 and ig_id = $2`,
    [accountId, contactIgId]
  )) as { last_reply_at: Date | null }[];
  const last = rows[0]?.last_reply_at ? new Date(rows[0].last_reply_at).getTime() : 0;
  return Date.now() - last < WINDOW_MS - 5 * 60_000; // margem de 5 min
}

async function finish(id: string, fields: { status: string; sent_at?: Date; not_before?: Date; error?: string }) {
  await sql().query(
    `update queue set
       status = $2,
       sent_at = coalesce($3, sent_at),
       not_before = coalesce($4, not_before),
       error = coalesce($5, error)
     where id = $1`,
    [
      id,
      fields.status,
      fields.sent_at?.toISOString() ?? null,
      fields.not_before?.toISOString() ?? null,
      fields.error ?? null,
    ]
  );
}

// Dados de quem vai receber a mensagem, para resolver as variáveis
// ({{first_name}} e afins). Uma consulta só, no momento do envio — assim vale
// para toda automação, inclusive as criadas antes deste recurso existir.
async function variableContext(
  accountId: string,
  contactIgId: string | null | undefined
): Promise<VariableContext> {
  if (!contactIgId) return {};
  try {
    const rows = (await sql().query(
      `select username, name, email from contacts where account_id = $1 and ig_id = $2`,
      [accountId, contactIgId]
    )) as { username: string | null; name: string | null; email: string | null }[];
    return rows[0] ?? {};
  } catch {
    // sem contato salvo: as variáveis caem no fallback (ou somem)
    return {};
  }
}

async function processItem(item: QueueItem, account: Account): Promise<"sent" | "skipped"> {
  const igUserId = account.ig_user_id;
  const p = item.payload as {
    text?: string;
    quick_reply_label?: string;
    quick_reply_payload?: string;
    button_label?: string;
    url?: string;
    message_id?: string;
    reaction?: string;
    // blocos de fluxo: listas, porque um bloco pode ter até 3 botões
    buttons?: { title: string; url: string }[];
    quick_replies?: { title: string; payload: string }[];
    flow_id?: string;
    node_id?: string;
    // anexo: a Meta busca a URL do lado dela e manda como mensagem separada
    media?: { kind?: string; url?: string };
  };

  // Único ponto de saída de texto do sistema: resolver as variáveis aqui faz
  // TODA mensagem — atual ou futura — suportá-las, sem tocar em cada fluxo.
  const ctx = await variableContext(igUserId, item.contact_ig_id);
  const texto = renderVariables(p.text ?? "", ctx);
  const rotuloBotao = renderVariables(p.button_label ?? "", ctx);
  const rotuloResposta = renderVariables(p.quick_reply_label ?? "", ctx);

  // "Acorda e continua": o bloco de espera do fluxo virou um item na fila com
  // hora marcada. Ele não envia nada — só retoma o mapa de onde parou.
  if (item.kind === "flow_resume") {
    if (!p.flow_id || !item.contact_ig_id) return "skipped";
    await retomarFluxo(account, p.flow_id, p.node_id ?? null, item.contact_ig_id, `q:${item.id}`);
    return "sent";
  }

  // Resposta pública: só na PRIMEIRA tentativa.
  //
  // attempts é incrementado na hora de reivindicar o item, então attempts > 1
  // significa que já houve uma investida antes — ou porque a anterior falhou
  // de um jeito que não diz se saiu (rede caiu, tempo esgotou), ou porque o
  // item ficou preso em "sending" e foi recuperado depois de 3 minutos. Nos
  // dois casos a Meta pode muito bem ter publicado a resposta.
  //
  // Para uma DM, repetir é melhor do que não entregar. Para um comentário
  // público, é o contrário: aparece duas vezes para todo mundo ver. Então
  // aqui a escolha é entregar no máximo uma vez.
  if (item.kind === "comment_reply") {
    if (item.attempts > 1) {
      await logEvent(igUserId, "comment_reply_nao_repetida", {
        queue_id: item.id,
        comment_id: item.comment_id,
        tentativas: item.attempts,
      });
      return "skipped";
    }
    await replyToComment(account, item.comment_id!, texto);
    return "sent";
  }

  // Reação (coraçãozinho) na mensagem que a pessoa mandou
  if (item.kind === "story_reaction") {
    if (!p.message_id || !item.contact_ig_id) return "skipped";
    if (!(await windowOpen(igUserId, item.contact_ig_id))) return "skipped";
    const reagiu = await reactToMessage(
      account,
      item.contact_ig_id,
      p.message_id,
      p.reaction || "❤️"
    );
    return reagiu ? "sent" : "skipped";
  }

  let recipient: { comment_id: string } | { id: string };
  if (item.kind === "private_reply") {
    recipient = { comment_id: item.comment_id! };
  } else {
    // DMs comuns só dentro da janela de 24h — regra da Meta
    if (!(await windowOpen(igUserId, item.contact_ig_id))) return "skipped";
    recipient = { id: item.contact_ig_id! };
  }

  // ---------- anexo ----------
  // Anexo e texto não cabem na mesma mensagem da Meta, então a mídia sai
  // primeiro, numa mensagem só dela. Duas decisões deliberadas:
  //
  // 1. Resposta privada a comentário aceita só texto. Mandar a mídia ali
  //    derrubaria a mensagem inteira — a única que fura a janela de 24h —,
  //    então ela é pulada e o texto segue. O editor avisa sobre isso antes.
  // 2. Falha no anexo (link quebrado, arquivo grande demais, servidor fora do
  //    ar) NÃO cancela o texto. Fica registrada em Eventos, com o motivo, e a
  //    conversa continua: perder o resto do fluxo por causa de uma imagem
  //    seria muito pior do que entregar a mensagem sem ela.
  const midia = normalizarMidia(p.media?.kind, p.media?.url);
  if (midia && !("comment_id" in recipient)) {
    try {
      await sendMessage(account, recipient, mediaMessage(midia.kind, midia.url));
    } catch (err) {
      await logEvent(igUserId, "media_failed", {
        queue_id: item.id,
        media: midia,
        erro: err instanceof Error ? err.message.slice(0, 400) : "erro",
      });
    }
  }

  let message: OutgoingMessage;
  // Bloco de fluxo: os botões vêm em lista. Botão de link vira template; opção
  // de resposta vira resposta rápida (nunca os dois na mesma mensagem — a Meta
  // não aceita, e o editor já obriga a escolher um dos dois por bloco).
  if (p.buttons?.length || p.quick_replies?.length) {
    const links = (p.buttons ?? []).map((b) => ({
      title: renderVariables(b.title ?? "", ctx),
      url: b.url,
    }));
    if (links.length) {
      message = buttonsMessage(texto, links);
    } else {
      message = {
        text: texto,
        quick_replies: (p.quick_replies ?? []).slice(0, 13).map((q) => ({
          content_type: "text" as const,
          title: renderVariables(q.title ?? "", ctx).slice(0, 20),
          payload: q.payload,
        })),
      };
    }
  } else if (
    item.kind === "dm_link" ||
    item.kind === "dm_reminder" ||
    item.kind === "dm_followup" ||
    item.kind === "dm_broadcast"
  ) {
    message = linkMessage(texto, rotuloBotao || "Abrir link", p.url ?? "");
  } else if (p.quick_reply_label && p.quick_reply_payload) {
    message = {
      text: texto,
      quick_replies: [
        { content_type: "text", title: rotuloResposta, payload: p.quick_reply_payload },
      ],
    };
  } else {
    message = { text: texto };
  }

  await sendMessage(account, recipient, message);
  return "sent";
}

export async function drainQueue(): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  await ensureSchema();
  const accounts = await listAccounts();
  if (!accounts.length) return result;
  const byId = new Map(accounts.map((a) => [a.ig_user_id, a]));

  // O limite horário da Meta é POR CONTA: contas no teto ficam de fora do
  // lote (em vez de serem reivindicadas e devolvidas, o que inflaria attempts).
  const capRows = (await sql()`
    select account_id, count(*)::int as n from queue
    where status = 'sent' and sent_at > now() - interval '1 hour'
    group by account_id
  `) as { account_id: string | null; n: number }[];
  const blocked = capRows
    .filter((r) => r.account_id && r.n >= HOURLY_CAP)
    .map((r) => r.account_id as string);

  // Trava atômica: FOR UPDATE SKIP LOCKED garante que dois drenos
  // simultâneos nunca peguem o mesmo item. Itens presos em 'sending'
  // há mais de 3 minutos são recuperados.
  const items = (await sql().query(
    `update queue q
     set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
     where q.id in (
       select id from queue
       where ((status = 'pending' and not_before <= now())
          or (status = 'sending' and claimed_at < now() - interval '3 minutes'))
         and (account_id is null or not (account_id = any($2::text[])))
       -- Disparo manual nunca passa na frente do fluxo automático: uma DM de
       -- boas-vindas que atrasa horas quebra a automação, um disparo que
       -- atrasa não. (false < true no Postgres, então o resto vem primeiro.)
       order by (kind = 'dm_broadcast'), created_at
       limit $1
       for update skip locked
     )
     returning q.*`,
    [BATCH_SIZE, blocked]
  )) as QueueItem[];

  for (const item of items) {
    const account = item.account_id ? byId.get(item.account_id) : undefined;
    if (!account) {
      // conta desconectada (ou item órfão antigo): não há token para enviar
      await finish(item.id, { status: "skipped", error: "conta não conectada" });
      result.skipped++;
      continue;
    }
    try {
      const outcome = await processItem(item, account);
      if (outcome === "sent") {
        await finish(item.id, { status: "sent", sent_at: new Date() });
        result.sent++;
        await sleep(GAP_MS);
      } else {
        await finish(item.id, { status: "skipped", error: "janela de 24h fechada" });
        result.skipped++;
      }
    } catch (err) {
      const permanent = err instanceof GraphError && err.status >= 400 && err.status < 500;
      const giveUp = permanent || item.attempts >= 3;
      await finish(item.id, {
        status: giveUp ? "failed" : "pending",
        not_before: new Date(Date.now() + 2 * 60_000),
        error: err instanceof Error ? err.message.slice(0, 500) : String(err),
      });
      result.failed++;
    }
  }

  // sobrou item pendente? agenda o próximo despertar
  // (item já vencido — ex.: lote cheio — volta em ~20s)
  const nextRows = (await sql()`
    select extract(epoch from (min(not_before) - now()))::float8 as secs
    from queue where status = 'pending'
  `) as { secs: number | null }[];
  const secs = nextRows[0]?.secs;
  if (secs !== null && secs !== undefined) {
    const config = await getConfig();
    await scheduleTick(config.app_url ?? "", Math.max(secs + 5, 20));
  }

  return result;
}
