"use server";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { metaCredentials } from "@/lib/meta-config";
import { encryptionKey, redactSecrets } from "@/lib/secrets";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateConfig, listAccounts, getConfig, deleteAccount } from "@/lib/db";
import { configureAppWebhook } from "@/lib/ig";
import {
  subscribeWebhooks,
  listPosts,
  listStories,
  getAccountProfile,
  PLATFORM_LABEL,
} from "@/lib/messaging";
import { diagnosticoDaMeta } from "@/lib/meta-erros";
import { canonicalAppUrl, isEphemeralUrl } from "@/lib/app-url";

async function requireAdmin() {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/entrar");
}

// Reassina os campos do webhook em todas as contas conectadas (comments e
// messages no Instagram, feed e messages na página do Facebook). A assinatura
// já acontece sozinha no OAuth, mas se falhar naquele momento nada chega e o
// painel fica mudo — este botão conserta sem precisar reconectar tudo.
export async function reassinarWebhooks(): Promise<void> {
  await requireAdmin();
  const accounts = await listAccounts();
  let ok = 0;
  const falhas: string[] = [];
  for (const a of accounts) {
    try {
      await subscribeWebhooks(a);
      ok++;
    } catch (err) {
      falhas.push(
        `${PLATFORM_LABEL[a.platform]} ${a.username ?? a.ig_user_id}: ${
          err instanceof Error ? err.message.slice(0, 80) : "erro"
        }`
      );
    }
  }
  revalidatePath("/setup");
  if (falhas.length) {
    redirect(`/setup?erro=${encodeURIComponent(falhas.join(" | "))}`);
  }
  redirect(`/setup?salvo=${encodeURIComponent(`Webhooks reassinados em ${ok} conta(s).`)}`);
}

// ============================================================
// Autoteste de acesso: faz as MESMAS chamadas que o painel faz no dia a dia —
// ler o perfil, listar posts e listar stories — e reporta o resultado real.
//
// Existe porque o erro que a Meta devolve quando o acesso do app é bloqueado
// ("API access blocked", código 200) aparecia como um JSON cru no seletor de
// post, e o palpite óbvio a partir dele — reconectar a conta — é justamente o
// palpite errado: o token está bom, quem está sem acesso é o app.
//
// A ordem das chamadas importa: perfil usa a permissão mais básica. Se ELA
// falha, não adianta olhar as outras — o problema é do app inteiro.
// ============================================================
export async function testarAcesso(): Promise<void> {
  await requireAdmin();
  const contas = await listAccounts();
  if (!contas.length) {
    redirect(`/setup?erro=${encodeURIComponent("Conecte uma conta antes de testar o acesso.")}`);
  }

  const linhas: string[] = [];
  let primeiroErro: string | null = null;

  for (const conta of contas) {
    const nome = `${PLATFORM_LABEL[conta.platform]} ${conta.username ?? conta.ig_user_id}`;
    const testes: { nome: string; executar: () => Promise<string> }[] = [
      {
        nome: "ler o perfil",
        executar: async () => {
          const p = await getAccountProfile(conta);
          return p.username ? `@${p.username}` : "ok";
        },
      },
      {
        nome: "listar posts",
        executar: async () => {
          const { media } = await listPosts(conta, 1);
          return `${media.length ? "ok" : "nenhum post"}`;
        },
      },
    ];
    // Story só existe no Instagram; no Facebook a lista vem vazia por desenho e
    // testá-la só produziria um "ok" que não quer dizer nada.
    if (conta.platform === "instagram") {
      testes.push({
        nome: "listar stories",
        executar: async () => {
          const s = await listStories(conta);
          return s.length ? "ok" : "nenhum story ativo";
        },
      });
    }

    for (const t of testes) {
      try {
        linhas.push(`${nome} · ${t.nome}: ✓ ${await t.executar()}`);
      } catch (err) {
        const cru = err instanceof Error ? err.message : String(err);
        linhas.push(`${nome} · ${t.nome}: ✗`);
        primeiroErro = primeiroErro ?? cru;
        // Falhou a chamada mais básica: as seguintes vão falhar igual e só
        // encheriam a tela com o mesmo erro repetido.
        break;
      }
    }
  }

  if (primeiroErro) {
    const d = diagnosticoDaMeta(primeiroErro);
    const detalhe = d
      ? `${d.resumo}\n\nO que conferir:\n${d.passos.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
      : `A Meta respondeu: ${primeiroErro.slice(0, 300)}`;
    redirect(`/setup?erro=${encodeURIComponent(`${linhas.join(" | ")}\n\n${detalhe}`)}`);
  }

  revalidatePath("/setup");
  redirect(`/setup?salvo=${encodeURIComponent(`Acesso em dia ✓ — ${linhas.join(" | ")}`)}`);
}

// ============================================================
// Autoteste do webhook: faz exatamente o que a Meta faz (GET com hub.mode,
// hub.verify_token e hub.challenge) contra a própria URL pública e reporta o
// resultado REAL. É isto que transforma o erro genérico da Meta
// ("não foi possível validar a URL de callback ou o token de verificação")
// num diagnóstico específico e acionável.
// ============================================================
export async function testarWebhook(): Promise<void> {
  await requireAdmin();
  const config = await getConfig();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const appUrl = canonicalAppUrl(config.app_url, host ? `${proto}://${host}` : null);

  if (!appUrl) {
    redirect(`/setup?erro=${encodeURIComponent("Não consegui detectar a URL pública do app.")}`);
  }

  const token = config.webhook_verify_token ?? process.env.WEBHOOK_VERIFY_TOKEN ?? "";
  if (!token) {
    redirect(
      `/setup?erro=${encodeURIComponent("Este install ainda não tem token de verificação.")}`
    );
  }

  const desafio = `teste${Date.now()}`;
  const url =
    `${appUrl}/api/webhook?hub.mode=subscribe` +
    `&hub.verify_token=${encodeURIComponent(token)}` +
    `&hub.challenge=${desafio}`;

  let status = 0;
  let corpo = "";
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store" });
    status = res.status;
    corpo = (await res.text()).slice(0, 400);
  } catch (err) {
    redirect(
      `/setup?erro=${encodeURIComponent(
        `Não consegui acessar ${appUrl}/api/webhook (${
          err instanceof Error ? err.message.slice(0, 120) : "erro de rede"
        }). A Meta também não vai conseguir.`
      )}`
    );
  }

  if (status === 200 && corpo.trim() === desafio) {
    revalidatePath("/setup");
    redirect(
      `/setup?salvo=${encodeURIComponent(
        `Webhook validado ✓ — ${appUrl}/api/webhook respondeu corretamente. Pode salvar na Meta com este token.`
      )}`
    );
  }

  // Traduz o que deu errado em algo que o usuário consegue resolver.
  const pareceLoginDaVercel =
    /vercel|authentication|sso|login/i.test(corpo) && (status === 401 || status === 403);
  let diagnostico: string;
  if (pareceLoginDaVercel || (status === 401 && isEphemeralUrl(appUrl))) {
    diagnostico =
      "a Vercel está exigindo login para acessar esta URL (Deployment Protection). " +
      "Desligue em Vercel → Settings → Deployment Protection, ou use o domínio de produção.";
  } else if (isEphemeralUrl(appUrl)) {
    diagnostico =
      "esta é uma URL de deployment temporária da Vercel, que muda a cada deploy e costuma " +
      "exigir login. Use o domínio de produção do projeto (ou defina a variável APP_URL).";
  } else if (status === 503) {
    diagnostico = "o banco de dados não está acessível. Conecte o Neon ao projeto e refaça o deploy.";
  } else if (status === 404) {
    diagnostico = "a rota /api/webhook não existe nesta URL — confira se o deploy é deste app.";
  } else if (status === 403) {
    diagnostico = `o app recusou a verificação: ${corpo.slice(0, 200)}`;
  } else {
    diagnostico = `resposta inesperada (HTTP ${status}): ${corpo.slice(0, 200)}`;
  }

  redirect(`/setup?erro=${encodeURIComponent(`Teste do webhook falhou — ${diagnostico}`)}`);
}

// Configura o webhook do app na Meta automaticamente (callback + verify token +
// campos comments/messages), no lugar de o usuário colar isso à mão no painel.
// Usa o App ID + Chave secreta PRINCIPAIS (Configurações → Básico) — que são
// diferentes das credenciais do login do Instagram. Se vierem no formulário,
// são salvas; senão, usa as já salvas (com fallback nas do login).
export async function configurarWebhookAuto(formData: FormData): Promise<void> {
  await requireAdmin();
  const config = await getConfig();

  const metaAppId = String(formData.get("meta_app_id") ?? "").trim();
  const metaAppSecret = String(formData.get("meta_app_secret") ?? "").trim();
  if (metaAppId || metaAppSecret) {
    await updateConfig({
      ...(metaAppId ? { meta_app_id: metaAppId } : {}),
      ...(metaAppSecret ? { meta_app_secret: metaAppSecret } : {}),
    });
  }

  const current = metaCredentials(config);
  const appId = metaAppId || current.appId;
  const appSecret = metaAppSecret || current.appSecret;
  if (!appId || !appSecret) {
    redirect(
      `/setup?erro=${encodeURIComponent(
        "Informe o App ID e a Chave secreta do app (Configurações → Básico) para a configuração automática."
      )}`
    );
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const appUrl = config.app_url ?? (host ? `${proto}://${host}` : null);
  if (!appUrl) {
    redirect(`/setup?erro=${encodeURIComponent("Não consegui detectar a URL pública do app.")}`);
  }

  try {
    await configureAppWebhook({
      appId,
      appSecret,
      callbackUrl: `${appUrl}/api/webhook`,
      verifyToken: config.webhook_verify_token ?? "",
      fields: "comments,messages,messaging_postbacks",
    });
    // As páginas do Facebook são uma assinatura separada (objeto "page"), no
    // mesmo callback. Falhar aqui não invalida a do Instagram, que já passou.
    try {
      await configureAppWebhook({
        appId,
        appSecret,
        callbackUrl: `${appUrl}/api/webhook`,
        verifyToken: config.webhook_verify_token ?? "",
        object: "page",
        fields: "feed,messages",
      });
    } catch {
      // app sem o produto Messenger/Páginas ainda: só o Instagram fica assinado
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 160) : "erro";
    redirect(
      `/setup?erro=${encodeURIComponent(
        `Não deu para configurar o webhook automaticamente (${msg}). Você ainda pode configurar manualmente no passo 3b.`
      )}`
    );
  }
  revalidatePath("/setup");
  redirect(
    `/setup?salvo=${encodeURIComponent(
      "Webhook configurado automaticamente ✓ (callback + campos comments e messages)."
    )}`
  );
}

export async function saveMetaCredentials(formData: FormData): Promise<void> {
  if (!isValidSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/entrar");
  const config = await getConfig();
  const appId = String(formData.get("meta_app_id") ?? "").trim();
  const appSecret = String(formData.get("meta_app_secret") ?? "").trim();
  const current = metaCredentials(config);
  if (!/^\d+$/.test(appId) || (!appSecret && (!current.appSecret || appId !== current.appId))) {
    redirect(`/setup?erro=${encodeURIComponent("Preencha o App ID principal e a chave secreta. Ao trocar o ID, informe a chave correspondente.")}`);
  }
  try { encryptionKey(); }
  catch (err) { redirect(`/setup?erro=${encodeURIComponent(redactSecrets(err))}`); }

  // Captura a URL pública do app. Só grava se for um endereço ESTÁVEL: gravar
  // uma URL de deployment da Vercel quebra o webhook e o OAuth no deploy
  // seguinte, porque esse endereço muda toda vez.
  const h = await headers(); // Next 16: headers() é assíncrono
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origem = host ? `${proto}://${host}` : null;
  const appUrl = canonicalAppUrl(null, origem);

  await updateConfig({
    meta_app_id: appId,
    ...(appSecret ? { meta_app_secret: appSecret } : {}),
    ...(appUrl && !isEphemeralUrl(appUrl) ? { app_url: appUrl } : {}),
  });
  revalidatePath("/setup");
  redirect("/setup?salvo=1");
}

// Desconecta uma conta (perfil do Instagram ou página do Facebook) e apaga tudo
// que era dela (automações,
// contatos, fila e eventos). Exige confirmar o @ digitado: é destrutivo e
// irreversível, então um clique acidental não pode levar os dados junto.
export async function removerConta(formData: FormData): Promise<void> {
  await requireAdmin();
  const igUserId = String(formData.get("ig_user_id") ?? "").trim();
  const confirmacao = String(formData.get("confirmacao") ?? "").trim().replace(/^@/, "");
  if (!igUserId) return;

  const contas = await listAccounts();
  const conta = contas.find((a) => a.ig_user_id === igUserId);
  if (!conta) {
    redirect(`/setup?erro=${encodeURIComponent("Conta não encontrada.")}`);
  }

  const esperado = (conta.username ?? conta.ig_user_id).toLowerCase();
  if (confirmacao.toLowerCase() !== esperado) {
    redirect(
      `/setup?erro=${encodeURIComponent(
        `Para remover, digite exatamente "${esperado}" no campo de confirmação.`
      )}`
    );
  }

  await deleteAccount(igUserId);
  revalidatePath("/setup");
  revalidatePath("/", "layout");
  redirect(
    `/setup?salvo=${encodeURIComponent(
      `${PLATFORM_LABEL[conta.platform]} ${esperado} removido, com todos os dados dele.`
    )}`
  );
}
