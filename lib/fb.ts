import "server-only";
import {
  API_VERSION,
  GraphError,
  graphRequest,
  nextCursor,
  type Json,
  type OutgoingMessage,
  type Recipient,
} from "./graph";

// ============================================================
// API de Páginas do Facebook (Messenger + comentários do feed)
//
// Diferenças em relação ao Instagram que explicam este arquivo existir:
// - o login é o do Facebook (Login for Business), com o app PRINCIPAL —
//   as credenciais do "login do Instagram" não valem aqui;
// - quem responde não é o usuário, é a PÁGINA: cada página tem seu próprio
//   token, tirado do token do usuário;
// - o token da página não expira (quando vem de um token longo de usuário),
//   então não existe renovação diária como no Instagram;
// - o webhook é do objeto "page", com os campos feed (comentários) e messages.
// ============================================================

export const FB_GRAPH = "https://graph.facebook.com";
const FB_DIALOG = "https://www.facebook.com";

export class FbError extends GraphError {
  constructor(status: number, body: string) {
    super(status, body, "Facebook");
  }
}

async function fbFetch(path: string, init?: RequestInit): Promise<Json> {
  return graphRequest(`${FB_GRAPH}/${API_VERSION}${path}`, init, FbError);
}

// ---------- OAuth ----------

// Permissões pedidas, e por quê:
// - pages_show_list: listar as páginas que a pessoa administra
// - pages_read_engagement: ler os posts e os comentários da página
// - pages_manage_engagement: responder aos comentários publicamente
// - pages_manage_metadata: assinar o webhook da página
// - pages_messaging: mandar as DMs pelo Messenger
export const FB_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "pages_messaging",
];

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FB_SCOPES.join(","),
    state,
  });
  return `${FB_DIALOG}/${API_VERSION}/dialog/oauth?${p.toString()}`;
}

export async function exchangeCodeForToken(opts: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ access_token: string }> {
  const p = new URLSearchParams({
    client_id: opts.appId,
    client_secret: opts.appSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const json = await fbFetch(`/oauth/access_token?${p.toString()}`);
  return json as never;
}

// Token longo de USUÁRIO (60 dias). É dele que saem os tokens de página, e são
// esses que não expiram — por isso a troca acontece antes de listar as páginas.
export async function exchangeForLongLivedToken(
  appId: string,
  appSecret: string,
  shortToken: string
): Promise<{ access_token: string; expires_in?: number }> {
  const p = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const json = await fbFetch(`/oauth/access_token?${p.toString()}`);
  return json as never;
}

export type FbPage = {
  id: string;
  name?: string;
  username?: string;
  access_token: string;
  picture?: { data?: { url?: string } };
};

// Páginas que a pessoa autorizou na tela da Meta (ela escolhe quais).
export async function listPages(userToken: string): Promise<FbPage[]> {
  const json = await fbFetch(
    `/me/accounts?fields=id,name,username,access_token,picture{url}&limit=100` +
      `&access_token=${encodeURIComponent(userToken)}`
  );
  return (json.data as FbPage[]) ?? [];
}

// ---------- Webhooks ----------

export async function subscribePageToWebhooks(pageId: string, pageToken: string): Promise<Json> {
  const body = new URLSearchParams({
    subscribed_fields: "feed,messages,messaging_postbacks",
    access_token: pageToken,
  });
  return fbFetch(`/${pageId}/subscribed_apps`, { method: "POST", body });
}

// Diagnóstico: o que esta página está assinando hoje. null = não deu para saber.
export async function getPageSubscribedFields(
  pageId: string,
  pageToken: string
): Promise<string[] | null> {
  try {
    const json = await fbFetch(
      `/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`
    );
    const data = (json.data as { subscribed_fields?: (string | { name?: string })[] }[]) ?? [];
    // dependendo da versão, cada campo vem como string ou como {name, version}
    return data.flatMap((d) =>
      (d.subscribed_fields ?? []).map((f) => (typeof f === "string" ? f : (f.name ?? "")))
    );
  } catch {
    return null;
  }
}

// ---------- Posts ----------

export type FbPost = {
  id: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
};

export async function getPagePosts(
  pageId: string,
  pageToken: string,
  limit = 30,
  after?: string | null
): Promise<{ posts: FbPost[]; after: string | null }> {
  const json = await fbFetch(
    `/${pageId}/published_posts?fields=id,message,full_picture,permalink_url,created_time` +
      `&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}` +
      `&access_token=${encodeURIComponent(pageToken)}`
  );
  return { posts: (json.data as FbPost[]) ?? [], after: nextCursor(json) };
}

// Imagem atual de um post da página, pelo id — mesma necessidade do Instagram:
// o endereço guardado vence, o id não.
export async function getPostPicture(postId: string, pageToken: string): Promise<Json> {
  return fbFetch(`/${postId}?fields=full_picture&access_token=${encodeURIComponent(pageToken)}`);
}

// Perfil da PRÓPRIA página conectada. Serve ao autoteste de acesso: é a
// chamada mais básica que existe, então se ela falha o problema é do app, e
// não da permissão de um recurso específico.
export async function getPageProfile(
  pageId: string,
  pageToken: string
): Promise<{ username?: string; name?: string; picture?: string }> {
  const json = (await fbFetch(
    `/${pageId}?fields=name,username,picture{url}&access_token=${encodeURIComponent(pageToken)}`
  )) as { name?: string; username?: string; picture?: { data?: { url?: string } } };
  return {
    name: json.name,
    username: json.username ?? json.name,
    picture: json.picture?.data?.url,
  };
}

// ---------- Perfil de quem escreveu ----------

// O webhook entrega só o PSID. Sem esta chamada o contato fica salvo como
// número. Só funciona para quem já mandou mensagem para a página (regra da
// Meta) — quem apenas comentou pode não ter perfil disponível.
export async function getUserProfile(
  psid: string,
  pageToken: string
): Promise<{ username?: string; name?: string; profile_pic?: string }> {
  const json = (await fbFetch(
    `/${psid}?fields=name,first_name,last_name,profile_pic&access_token=${encodeURIComponent(pageToken)}`
  )) as { name?: string; first_name?: string; profile_pic?: string };
  return {
    name: json.name,
    // o Messenger não tem @: o primeiro nome é o que dá para mostrar em lista
    username: json.first_name,
    profile_pic: json.profile_pic,
  };
}

// ---------- Envio ----------

// Instagram e Messenger falam o mesmo dialeto de envio, então o formato da
// mensagem mora em graph.ts e é reexportado aqui. Já esteve duplicado: bastou
// a mídia entrar em graph.ts para o Facebook ficar para trás sem ninguém notar.
export type { Recipient, OutgoingMessage } from "./graph";

// Send API do Messenger. Com recipient.comment_id vira "resposta privada" ao
// comentário — o equivalente do que o Instagram faz para furar a janela de 24h.
export async function sendMessage(
  pageId: string,
  pageToken: string,
  recipient: Recipient,
  message: OutgoingMessage
): Promise<Json> {
  return fbFetch(`/${pageId}/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message, messaging_type: "RESPONSE" }),
  });
}

// Resposta pública, embaixo do comentário da pessoa.
export async function replyToComment(
  commentId: string,
  pageToken: string,
  text: string
): Promise<Json> {
  const body = new URLSearchParams({ message: text });
  return fbFetch(`/${commentId}/comments?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    body,
  });
}
