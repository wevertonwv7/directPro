// ============================================================
// Mídia anexada às mensagens (imagem, áudio e vídeo)
//
// A Meta não recebe arquivo: ela recebe uma URL PÚBLICA e busca o arquivo nos
// servidores dela. Por isso a mídia aqui é sempre um endereço — o que também
// mantém a promessa de custo mensal zero, já que o app não precisa de nenhum
// serviço de armazenamento para funcionar.
//
// Regras da Meta que moldam este arquivo:
// - Mensagem com anexo NÃO leva texto junto. São duas mensagens: primeiro a
//   mídia, depois o texto (com os botões, se houver). O motor faz isso sozinho.
// - A URL precisa abrir sem login. Link do Google Drive em modo "visualizar"
//   não serve: a Meta recebe uma página HTML, não o arquivo.
// - A primeira resposta a um comentário (resposta privada) só aceita texto.
//
// Este arquivo roda nos dois lados (o editor valida na hora da digitação), por
// isso não importa "server-only" nem toca no banco.
// ============================================================

export type MediaKind = "image" | "audio" | "video";

export const MEDIA_LABEL: Record<MediaKind, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
};

// Formatos e tamanhos aceitos pela Meta. Os limites são os documentados para a
// API de mensagens; passar deles faz a Meta recusar o envio.
export const MEDIA_INFO: Record<
  MediaKind,
  { formatos: string[]; limiteMb: number; exemplo: string }
> = {
  image: { formatos: ["jpg", "jpeg", "png", "gif"], limiteMb: 8, exemplo: "capa.jpg" },
  audio: { formatos: ["aac", "m4a", "wav", "mp3", "mp4"], limiteMb: 25, exemplo: "audio.m4a" },
  video: { formatos: ["mp4", "mov", "webm", "ogg", "avi"], limiteMb: 25, exemplo: "video.mp4" },
};

export type Media = { kind: MediaKind; url: string };

// Descobre o tipo pela extensão do endereço. Serve para o editor já marcar
// "Vídeo" quando a pessoa cola um .mp4, em vez de obrigar a escolher duas
// vezes a mesma coisa.
export function tipoPelaUrl(url: string): MediaKind | null {
  const limpo = url.split("?")[0].split("#")[0].toLowerCase();
  const ext = limpo.slice(limpo.lastIndexOf(".") + 1);
  if (!ext || ext === limpo) return null;
  for (const [kind, info] of Object.entries(MEDIA_INFO)) {
    // mp4 é áudio e vídeo ao mesmo tempo; vídeo é o palpite mais provável
    if (info.formatos.includes(ext)) return ext === "mp4" ? "video" : (kind as MediaKind);
  }
  return null;
}

export function tipoPeloContentType(contentType: string | null): MediaKind | null {
  if (!contentType) return null;
  const t = contentType.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  return null;
}

// Só http(s), e sem espaço: a Meta busca a URL do lado dela, então endereço
// local (localhost, 10.x, arquivo no computador) nunca vai funcionar — é melhor
// dizer isso na hora de colar do que deixar a mensagem falhar no envio.
export function urlDeMidiaValida(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (/\s/.test(u)) return false;
    return !/^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

// Normaliza o que vier de fora (formulário, arquivo importado, banco antigo).
// Endereço inválido vira "sem mídia", que é o comportamento seguro: a mensagem
// continua saindo, só sem o anexo.
export function normalizarMidia(kind: unknown, url: unknown): Media | null {
  const endereco = typeof url === "string" ? url.trim().slice(0, 600) : "";
  if (!endereco || !urlDeMidiaValida(endereco)) return null;
  const tipo =
    typeof kind === "string" && kind in MEDIA_LABEL
      ? (kind as MediaKind)
      : tipoPelaUrl(endereco);
  return tipo ? { kind: tipo, url: endereco } : null;
}

// Aviso escrito para quem está montando a mensagem, não para o console. Vazio
// = nada a dizer.
export function avisoDaMidia(kind: MediaKind | null, url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (!urlDeMidiaValida(u)) {
    return "O endereço precisa começar com https:// e abrir sem login — a Meta busca o arquivo do lado dela.";
  }
  const pelaUrl = tipoPelaUrl(u);
  if (kind && pelaUrl && pelaUrl !== kind && !(kind === "audio" && pelaUrl === "video")) {
    return `Esse link parece ser ${MEDIA_LABEL[pelaUrl].toLowerCase()}, e você escolheu ${MEDIA_LABEL[kind].toLowerCase()}.`;
  }
  if (/drive\.google\.com\/file\/d\//i.test(u)) {
    return "Link do Google Drive em modo visualização entrega uma página, não o arquivo. Use um link direto para o arquivo.";
  }
  if (/dropbox\.com/i.test(u) && !/(\?|&)(raw=1|dl=1)/i.test(u)) {
    return "Link do Dropbox precisa terminar com ?raw=1 para entregar o arquivo em vez da página.";
  }
  return "";
}
