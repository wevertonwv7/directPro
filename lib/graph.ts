import "server-only";

// Base comum das duas APIs da Meta (Instagram e Facebook). O que muda entre
// elas é o host e os endpoints; o tratamento de erro é o mesmo — e precisa ser,
// porque o motor da fila decide o que é falha permanente (4xx, não adianta
// tentar de novo) olhando para este erro.

export const API_VERSION = "v25.0";

export class GraphError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, api = "Meta") {
    super(`${api} API ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export type Json = Record<string, unknown>;

// fetch + parse com o erro certo. O corpo cru vai junto no erro: as mensagens
// da Meta são a única pista útil quando algo falha em produção.
export async function graphRequest(
  url: string,
  init: RequestInit | undefined,
  ErrorClass: new (status: number, body: string) => GraphError
): Promise<Json> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new ErrorClass(res.status, text);
  return text ? (JSON.parse(text) as Json) : {};
}

// Cursor da próxima página, ou null quando acabou. A Meta devolve cursor mesmo
// na última página, então o que vale é a existência de `next`.
export function nextCursor(json: Json): string | null {
  const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
  return paging?.next ? (paging.cursors?.after ?? null) : null;
}

// ---------- Formato das mensagens ----------
// Instagram e Messenger falam o MESMO dialeto de envio (Send API): mesmo
// destinatário, mesmo template de botão, mesmas respostas rápidas. Manter os
// tipos aqui é o que permite o motor montar a mensagem uma vez só, sem saber
// para qual das duas plataformas ela vai.

export type Recipient = { comment_id: string } | { id: string };

export type OutgoingMessage =
  | { text: string; quick_replies?: { content_type: "text"; title: string; payload: string }[] }
  | {
      attachment: {
        type: "template";
        payload: {
          template_type: "button";
          text: string;
          buttons: { type: "web_url"; url: string; title: string }[];
        };
      };
    }
  // Imagem, áudio ou vídeo. A Meta não recebe o arquivo: recebe o endereço e
  // busca do lado dela, então a URL tem que abrir sem login.
  | { attachment: { type: "image" | "audio" | "video"; payload: { url: string } } };

// Mensagem só de mídia. Anexo e texto não convivem na mesma mensagem da Meta —
// quem manda os dois é o motor, em duas mensagens seguidas.
export function mediaMessage(
  kind: "image" | "audio" | "video",
  url: string
): OutgoingMessage {
  return { attachment: { type: kind, payload: { url } } };
}

// Texto com botão de link (template de botão) ou só texto, se não houver URL.
export function linkMessage(text: string, buttonLabel: string, url: string): OutgoingMessage {
  if (!url) return { text };
  return buttonsMessage(text, [{ title: buttonLabel || "Abrir link", url }]);
}

// Vários botões de link na mesma mensagem (o fluxo permite até 3, que é o
// limite do template de botão da Meta).
export function buttonsMessage(
  text: string,
  buttons: { title: string; url: string }[]
): OutgoingMessage {
  const validos = buttons.filter((b) => b.url).slice(0, 3);
  if (!validos.length) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: validos.map((b) => ({
          type: "web_url" as const,
          url: b.url,
          title: b.title || "Abrir link",
        })),
      },
    },
  };
}
