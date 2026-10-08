// ============================================================
// Fluxo: a automação em forma de mapa
//
// A automação simples é uma sequência fixa (boas-vindas → condições → link →
// acompanhamento). O fluxo é o passo seguinte: blocos ligados por setas, onde
// cada opção de resposta leva a um caminho diferente — o que o ManyChat chama
// de flow builder.
//
// O desenho inteiro (blocos + ligações) mora em duas colunas jsonb da tabela
// `flows`. É um documento pequeno, sempre lido e salvo por inteiro pelo editor,
// e guardá-lo assim evita transformar cada arrastada de bloco em três tabelas
// relacionais — sem perder nada, porque nada consulta um bloco isolado.
//
// Este arquivo é o contrato entre o editor (cliente) e o motor (servidor), por
// isso não importa "server-only": os dois lados usam os mesmos tipos e a mesma
// normalização.
// ============================================================

import { normalizarMidia, type MediaKind } from "./media";

export type FlowNodeKind =
  | "start"
  | "message"
  | "delay"
  | "ask_email"
  | "follow_gate"
  | "tag";

// Botão de link abre um endereço e não muda o caminho do fluxo.
// Botão de resposta é o que RAMIFICA: cada um tem sua própria saída.
export type FlowButton = { label: string; url?: string };

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  x: number;
  y: number;
  // message / ask_email / follow_gate
  text?: string;
  // message: os botões são todos de link ou todos de resposta. Misturar os dois
  // numa mensagem só não é aceito pela API da Meta (template com botão não
  // carrega resposta rápida), então a escolha é do bloco inteiro.
  buttonMode?: "url" | "reply";
  buttons?: FlowButton[];
  // Anexo da mensagem: imagem, áudio ou vídeo. Sai como uma mensagem separada,
  // logo antes do texto — a Meta não aceita anexo e texto na mesma mensagem.
  mediaKind?: MediaKind;
  mediaUrl?: string;
  // delay
  minutes?: number;
  // follow_gate
  buttonLabel?: string;
  // tag
  tag?: string;
};

// handle: "next" (saída única) ou "btn:0", "btn:1"… (uma por opção de resposta)
export type FlowEdge = { from: string; handle: string; to: string };

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export const NODE_LABEL: Record<FlowNodeKind, string> = {
  start: "Quando alguém…",
  message: "Enviar mensagem",
  delay: "Esperar",
  ask_email: "Pedir e-mail",
  follow_gate: "Só para quem segue",
  tag: "Etiquetar",
};

export const NODE_DESC: Record<FlowNodeKind, string> = {
  start: "O gatilho do fluxo.",
  message: "Um texto, com botões de link ou opções de resposta.",
  delay: "Segura o próximo passo por um tempo.",
  ask_email: "Guarda o e-mail da pessoa e só então continua.",
  follow_gate: "Confere se a pessoa segue antes de continuar.",
  tag: "Marca a pessoa com uma etiqueta, que aparece em Contatos.",
};

export const START_NODE_ID = "start";

// Fluxo novo: só o gatilho e uma primeira mensagem, já ligados. Começar com a
// tela vazia faz a pessoa ter que descobrir sozinha o que é um bloco.
export function novoGrafo(): FlowGraph {
  return {
    nodes: [
      { id: START_NODE_ID, kind: "start", x: 60, y: 140 },
      {
        id: "n1",
        kind: "message",
        x: 330,
        y: 110,
        text: "Oi {{first_name}}! Que bom te ver por aqui 😊",
        buttonMode: "reply",
        // sem botão de saída: um fluxo recém-criado não deve nascer com aviso
        // de "opção que não leva a lugar nenhum"
        buttons: [],
      },
    ],
    edges: [{ from: START_NODE_ID, handle: "next", to: "n1" }],
  };
}

// Quantas saídas o bloco tem, e como elas se chamam. É o que o editor desenha
// e o que o motor consulta na hora de decidir para onde ir.
export function saidasDoNo(node: FlowNode): { handle: string; label: string }[] {
  if (node.kind === "message" && node.buttonMode === "reply" && node.buttons?.length) {
    return node.buttons.map((b, i) => ({ handle: `btn:${i}`, label: b.label || `Opção ${i + 1}` }));
  }
  return [{ handle: "next", label: "" }];
}

// Um bloco "ramifica" quando tem mais de um caminho possível. Só nesses casos
// uma saída solta é defeito — em bloco de caminho único, ela é o fim do fluxo.
export function ramifica(node: FlowNode): boolean {
  return saidasDoNo(node).length > 1;
}

export function proximoNo(graph: FlowGraph, from: string, handle = "next"): string | null {
  return graph.edges.find((e) => e.from === from && e.handle === handle)?.to ?? null;
}

export function acharNo(graph: FlowGraph, id: string | null | undefined): FlowNode | null {
  if (!id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

// Limpa o que veio do cliente antes de gravar: ids repetidos, blocos de tipo
// desconhecido, ligações apontando para o vazio e textos gigantes. O editor é
// código no navegador — o formato só é confiável depois de passar por aqui.
export function normalizarGrafo(bruto: unknown): FlowGraph {
  const entrada = (bruto ?? {}) as Partial<FlowGraph>;
  const vistos = new Set<string>();
  const nodes: FlowNode[] = [];

  for (const n of Array.isArray(entrada.nodes) ? entrada.nodes : []) {
    if (!n || typeof n.id !== "string" || !n.id) continue;
    if (vistos.has(n.id)) continue;
    if (!(n.kind in NODE_LABEL)) continue;
    vistos.add(n.id);

    const buttons = (Array.isArray(n.buttons) ? n.buttons : [])
      .slice(0, 3) // limite da Meta para botões de link
      .map((b) => ({
        label: String(b?.label ?? "").slice(0, 20),
        ...(b?.url ? { url: String(b.url).slice(0, 500) } : {}),
      }))
      .filter((b) => b.label);

    // endereço inválido vira "sem mídia": a mensagem continua saindo, só sem o
    // anexo — melhor do que recusar o fluxo inteiro na importação
    const midia = normalizarMidia(n.mediaKind, n.mediaUrl);

    nodes.push({
      id: n.id,
      kind: n.kind,
      x: Number.isFinite(n.x) ? Math.round(Number(n.x)) : 0,
      y: Number.isFinite(n.y) ? Math.round(Number(n.y)) : 0,
      ...(n.text ? { text: String(n.text).slice(0, 900) } : {}),
      ...(n.kind === "message"
        ? { buttonMode: n.buttonMode === "url" ? ("url" as const) : ("reply" as const), buttons }
        : {}),
      ...(midia ? { mediaKind: midia.kind, mediaUrl: midia.url } : {}),
      ...(n.kind === "delay"
        ? { minutes: Math.min(20 * 60, Math.max(1, Math.round(Number(n.minutes) || 60))) }
        : {}),
      ...(n.buttonLabel ? { buttonLabel: String(n.buttonLabel).slice(0, 20) } : {}),
      ...(n.kind === "tag" ? { tag: String(n.tag ?? "").slice(0, 40).trim() } : {}),
    });
  }

  // garante o gatilho: sem ele o fluxo não tem por onde começar
  if (!nodes.some((n) => n.kind === "start")) {
    nodes.unshift({ id: START_NODE_ID, kind: "start", x: 60, y: 140 });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  const ocupados = new Set<string>();
  for (const e of Array.isArray(entrada.edges) ? entrada.edges : []) {
    if (!e || !ids.has(e.from) || !ids.has(e.to)) continue;
    if (e.from === e.to) continue;
    const handle = String(e.handle || "next");
    // uma saída leva a um lugar só: a última ligação feita no editor vence
    const chave = `${e.from}|${handle}`;
    if (ocupados.has(chave)) continue;
    ocupados.add(chave);
    edges.push({ from: e.from, handle, to: e.to });
  }

  return { nodes, edges };
}

// Um fluxo pronto (importado de um pacote) chega com marcações entre colchetes
// — [SEU LINK], [NOME DO MATERIAL] — no lugar do que é de cada negócio. Contar
// quantas sobraram é o que permite avisar antes de a pessoa ativar um fluxo que
// oferece um e-book que não existe.
const MARCA_DE_EXEMPLO = /\[[^\]]+\]|exemplo\.com/i;

export function contarPendencias(graph: FlowGraph): number {
  let total = 0;
  for (const n of graph.nodes) {
    if (n.text && MARCA_DE_EXEMPLO.test(n.text)) total++;
    for (const b of n.buttons ?? []) {
      if (MARCA_DE_EXEMPLO.test(b.label) || (b.url && MARCA_DE_EXEMPLO.test(b.url))) total++;
    }
  }
  return total;
}

// Problemas que fariam o fluxo parar no meio sem ninguém entender por quê.
// Aparecem como aviso no editor — não impedem salvar, porque um fluxo pela
// metade é um estado normal de quem está montando.
export function avisosDoGrafo(graph: FlowGraph, trigger?: string): string[] {
  const avisos: string[] = [];
  const start = graph.nodes.find((n) => n.kind === "start");
  if (start && !proximoNo(graph, start.id)) {
    avisos.push("O gatilho não está ligado a nenhum bloco — o fluxo nunca começa.");
  }

  // No gatilho de comentário, a primeira mensagem é uma RESPOSTA PRIVADA — o
  // único tipo de mensagem que fura a janela de 24h, e que a Meta aceita
  // somente com texto. Anexo nela é simplesmente descartado no envio, então é
  // melhor dizer isso aqui do que deixar a pessoa achando que mandou o vídeo.
  if (trigger === "comment" && start) {
    const primeiro = acharNo(graph, proximoNo(graph, start.id));
    if (primeiro?.mediaUrl) {
      avisos.push(
        "A primeira mensagem depois de um comentário não aceita anexo (é uma resposta privada). Ponha a mídia num bloco seguinte."
      );
    }
  }
  const alcancaveis = new Set<string>();
  const fila = start ? [start.id] : [];
  while (fila.length) {
    const atual = fila.shift()!;
    if (alcancaveis.has(atual)) continue;
    alcancaveis.add(atual);
    for (const e of graph.edges.filter((e) => e.from === atual)) fila.push(e.to);
  }
  const soltos = graph.nodes.filter((n) => !alcancaveis.has(n.id));
  if (soltos.length) {
    avisos.push(
      `${soltos.length} bloco(s) não recebem ligação nenhuma e nunca vão ser executados.`
    );
  }
  for (const n of graph.nodes) {
    if (n.kind === "message" && !n.text?.trim()) {
      avisos.push("Tem bloco de mensagem sem texto.");
      break;
    }
  }
  // Bloco sem "próximo" é fim de fluxo, e isso é normal. Já uma RAMIFICAÇÃO
  // sem destino é sempre defeito: a pessoa entra por ali e não acontece nada.
  for (const n of graph.nodes) {
    if (!ramifica(n)) continue;
    for (const s of saidasDoNo(n)) {
      if (!proximoNo(graph, n.id, s.handle)) {
        avisos.push(
          `A saída “${s.label}” do bloco “${NODE_LABEL[n.kind]}” não leva a lugar nenhum.`
        );
        return avisos; // um aviso desses por vez já basta
      }
    }
  }
  for (const n of graph.nodes) {
    if (n.kind === "tag" && !n.tag?.trim()) {
      avisos.push("Tem bloco de etiqueta sem nome — ele não vai marcar ninguém.");
      break;
    }
  }
  const pendentes = contarPendencias(graph);
  if (pendentes) {
    avisos.push(
      `${pendentes} texto(s) ou link(s) de exemplo ainda estão entre colchetes — troque pelos seus antes de ativar.`
    );
  }
  return avisos;
}
