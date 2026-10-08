import "server-only";
import type { Account } from "./db";
import { salvarFotoDaConta } from "./db";
import type { OutgoingMessage, Recipient } from "./graph";
import * as ig from "./ig";
import * as fb from "./fb";

// ============================================================
// Uma conta, duas plataformas
//
// O motor (lib/engine.ts) não deve saber se está falando com o Instagram ou
// com uma página do Facebook: as regras do fluxo — palavra-chave, resposta
// privada ao comentário, janela de 24h, fila, acompanhamento — são idênticas
// nos dois. O que muda é só QUAL API chamar. Toda essa decisão fica aqui.
//
// Onde a plataforma realmente diverge, a função devolve um valor neutro em vez
// de um erro (stories e reação só existem no Instagram; conferir seguidor não
// existe no Facebook), para o fluxo seguir em vez de morrer no meio.
// ============================================================

export function isFacebook(account: Pick<Account, "platform">): boolean {
  return account.platform === "facebook";
}

export const PLATFORM_LABEL: Record<Account["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};

// Formato único que o seletor de posts do formulário entende, venha a mídia do
// Instagram (media) ou do Facebook (published_posts).
export type PickerMedia = {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  permalink?: string;
};

function fromFbPost(p: fb.FbPost): PickerMedia {
  return {
    id: p.id,
    media_type: p.full_picture ? "IMAGE" : "STATUS",
    media_url: p.full_picture,
    thumbnail_url: p.full_picture,
    caption: p.message,
    permalink: p.permalink_url,
  };
}

// ---------- Leitura de posts e stories ----------

export async function listPosts(
  account: Account,
  limit = 30,
  after?: string | null
): Promise<{ media: PickerMedia[]; after: string | null }> {
  if (isFacebook(account)) {
    const page = await fb.getPagePosts(account.ig_user_id, account.access_token, limit, after);
    return { media: page.posts.map(fromFbPost), after: page.after };
  }
  const page = await ig.getMedia(account.ig_user_id, account.access_token, limit, after);
  return { media: page.media as PickerMedia[], after: page.after };
}

// Stories só existem no Instagram — no Facebook a lista vem vazia e o
// formulário nem oferece o gatilho.
export async function listStories(account: Account): Promise<PickerMedia[]> {
  if (isFacebook(account)) return [];
  return (await ig.getStories(account.ig_user_id, account.access_token)) as PickerMedia[];
}

// Endereço ATUAL da imagem de um post/story, a partir do id. As URLs da Meta
// são assinadas e expiram; guardá-las no banco funciona por algumas semanas e
// depois vira miniatura quebrada. Com o id (que não muda) dá para pedir o
// endereço de novo na hora de mostrar.
export async function findMediaById(account: Account, mediaId: string): Promise<string | null> {
  if (isFacebook(account)) {
    const json = (await fb.getPostPicture(mediaId, account.access_token)) as {
      full_picture?: string;
    };
    return json.full_picture ?? null;
  }
  const json = (await ig.getMediaById(
    mediaId,
    account.access_token,
    "thumbnail_url,media_url"
  )) as { thumbnail_url?: string; media_url?: string };
  // vídeo/reels tem thumbnail; foto só tem media_url
  return json.thumbnail_url ?? json.media_url ?? null;
}

// Endereço ATUAL da foto de perfil da conta conectada. Guarda o valor novo no
// banco: assim a próxima tela já pega a foto boa direto, sem outra ida à Meta.
export async function fotoDaConta(account: Account): Promise<string | null> {
  const url = isFacebook(account)
    ? ((await fb.getPageProfile(account.ig_user_id, account.access_token)).picture ?? null)
    : ((await ig.getProfile(account.access_token)).profile_picture_url ?? null);
  if (url) await salvarFotoDaConta(account.ig_user_id, url);
  return url;
}

// ---------- Achar um post pelo link colado ----------

// Instagram: o que identifica o post no link é o código curto.
// https://www.instagram.com/p/CODIGO/ · /reel/CODIGO/ · /tv/CODIGO/
function instagramShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Facebook: o link tem vários formatos. O que serve para reconhecer o post é o
// identificador no fim (numérico ou pfbid), que também aparece no permalink_url
// devolvido pela API e no id do post (no formato PAGINA_POST).
function facebookPostIds(url: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\/posts\/([A-Za-z0-9]+)/i,
    /story_fbid=([A-Za-z0-9]+)/i,
    /\/videos\/(?:[^/]+\/)?(\d+)/i,
    /\/photos\/[^/]+\/(\d+)/i,
    /\/permalink\/(\d+)/i,
    /\/reel\/(\d+)/i,
    /fbid=(\d+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

// Quantas páginas de mídia varremos procurando o link colado. 8 × 50 = 400
// posts: cobre com folga quem cola o link de um post antigo, sem transformar
// um erro de digitação numa varredura infinita na API da Meta.
const MAX_PAGINAS_BUSCA = 8;

// Acha o post correspondente ao link que a pessoa colou. Devolve null quando o
// link não é desta conta (ou é antigo demais) — quem chama transforma isso numa
// mensagem clara, em vez de gravar um post_id que nunca vai casar com evento
// nenhum.
export async function findPostByUrl(
  account: Account,
  rawUrl: string
): Promise<PickerMedia | null> {
  const url = rawUrl.trim();
  if (!url) return null;

  const facebook = isFacebook(account);
  const code = facebook ? null : instagramShortcode(url);
  const ids = facebook ? facebookPostIds(url) : [];
  if (!facebook && !code) return null;
  if (facebook && !ids.length) return null;

  let after: string | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS_BUSCA; pagina++) {
    const lote: { media: PickerMedia[]; after: string | null } = await listPosts(
      account,
      50,
      after
    );
    for (const m of lote.media) {
      const permalink = m.permalink ?? "";
      if (facebook) {
        const idDoPost = m.id.includes("_") ? m.id.split("_")[1] : m.id;
        if (ids.some((id) => id === idDoPost || permalink.includes(id))) return m;
      } else if (code && permalink.includes(`/${code}`)) {
        return m;
      }
    }
    if (!lote.after) break;
    after = lote.after;
  }
  return null;
}

// ---------- Envio ----------

export async function sendMessage(
  account: Account,
  recipient: Recipient,
  message: OutgoingMessage
): Promise<unknown> {
  if (isFacebook(account)) {
    return fb.sendMessage(account.ig_user_id, account.access_token, recipient, message);
  }
  return ig.sendMessage(account.ig_user_id, account.access_token, recipient, message);
}

export async function replyToComment(
  account: Account,
  commentId: string,
  text: string
): Promise<unknown> {
  if (isFacebook(account)) return fb.replyToComment(commentId, account.access_token, text);
  return ig.replyToComment(commentId, account.access_token, text);
}

// Reação (coraçãozinho) na mensagem recebida: existe só no Instagram. No
// Facebook devolve false e o motor marca o item como pulado, sem erro.
export async function reactToMessage(
  account: Account,
  contactId: string,
  messageId: string,
  emoji: string
): Promise<boolean> {
  if (isFacebook(account)) return false;
  await ig.sendReaction(account.ig_user_id, account.access_token, contactId, messageId, emoji);
  return true;
}

// ---------- Perfil e seguidores ----------

// Perfil da própria conta conectada (não de um contato). É a chamada mais
// básica de cada plataforma — usada pelo autoteste de acesso em Configuração.
export async function getAccountProfile(
  account: Account
): Promise<{ username?: string; name?: string }> {
  if (isFacebook(account)) {
    return fb.getPageProfile(account.ig_user_id, account.access_token);
  }
  return ig.getProfile(account.access_token);
}

export async function getUserProfile(
  account: Account,
  userId: string
): Promise<{ username?: string; name?: string; profile_pic?: string }> {
  if (isFacebook(account)) return fb.getUserProfile(userId, account.access_token);
  return ig.getUserProfile(userId, account.access_token);
}

// null = não deu para saber (o motor trata como "libera e registra"). No
// Facebook é sempre null: a API de páginas não informa se alguém curte/segue,
// então exigir isso deixaria a automação presa para todo mundo.
export async function followsAccount(
  account: Account,
  userId: string
): Promise<boolean | null> {
  if (isFacebook(account)) return null;
  return ig.checkFollowsAccount(userId, account.access_token);
}

// ---------- Webhooks ----------

export async function subscribeWebhooks(account: Account): Promise<unknown> {
  if (isFacebook(account)) {
    return fb.subscribePageToWebhooks(account.ig_user_id, account.access_token);
  }
  return ig.subscribeToWebhooks(account.ig_user_id, account.access_token);
}

export async function subscribedFields(account: Account): Promise<string[] | null> {
  if (isFacebook(account)) {
    return fb.getPageSubscribedFields(account.ig_user_id, account.access_token);
  }
  return ig.getSubscribedFields(account.ig_user_id, account.access_token);
}

export { linkMessage, buttonsMessage, mediaMessage } from "./graph";
export { GraphError } from "./graph";
export type { OutgoingMessage, Recipient } from "./graph";
