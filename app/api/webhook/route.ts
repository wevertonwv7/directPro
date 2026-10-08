import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  drainQueue,
  logEvent,
} from "@/lib/engine";
import { getConfig } from "@/lib/db";
import { metaCredentials } from "@/lib/meta-config";
import { signatureMatches, type WebhookBody } from "@/lib/webhook-events";
import { saveWebhookEvents } from "@/lib/webhook-inbox";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ============================================================
// GET — handshake de verificação da Meta
//
// Este endpoint precisa responder o hub.challenge mesmo em condições ruins:
// se ele devolver 500 (por exemplo, banco ainda não provisionado), a Meta
// mostra apenas "não foi possível validar a URL de callback ou o token de
// verificação", sem dizer o motivo. Por isso aqui: nada de exceção vazando,
// fallback do token por variável de ambiente e motivo explícito no corpo da
// resposta quando recusamos.
// ============================================================
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  // Chamada que não é handshake (teste no navegador, monitor de uptime):
  // responde 200 para deixar claro que a rota está no ar e acessível.
  if (q.get("hub.mode") !== "subscribe") {
    return new NextResponse("webhook no ar", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const received = q.get("hub.verify_token") ?? "";
  const challenge = q.get("hub.challenge") ?? "";

  let esperado: string | null = null;
  let erroBanco: string | null = null;
  try {
    esperado = (await getConfig()).webhook_verify_token;
  } catch {
    erroBanco = "confira a configuração e disponibilidade do banco no servidor";
  }
  // Fallback: permite validar mesmo se o banco estiver indisponível no momento
  // exato do handshake (a Meta valida na hora em que o usuário clica em salvar).
  const doAmbiente = process.env.WEBHOOK_VERIFY_TOKEN || null;

  const bate =
    Boolean(received) &&
    Boolean(
      (esperado && safeEqual(received, esperado)) ||
        (doAmbiente && safeEqual(received, doAmbiente))
    );

  if (bate) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Recusado: explica o motivo. Isso aparece no diagnóstico do /setup e
  // transforma o erro genérico da Meta em algo acionável.
  const motivo = erroBanco
    ? `banco indisponível (${erroBanco}) e WEBHOOK_VERIFY_TOKEN não definido`
    : !esperado
      ? "nenhum token de verificação configurado neste install"
      : !received
        ? "a requisição não trouxe hub.verify_token"
        : "o token enviado não confere com o deste install";

  // best-effort: deixa rastro para o usuário ver em /eventos
  try {
    await logEvent(null, "webhook_verify_failed", { motivo });
  } catch {
    // banco fora do ar: o motivo ainda vai no corpo da resposta
  }

  return new NextResponse(`verificação recusada: ${motivo}`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Confirma a assinatura antes de gravar. ACK só depois da persistência;
// processamento e envio ficam no worker, recuperados por QStash/cron.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  let config;
  try { config = await getConfig(); }
  catch { return new NextResponse("banco indisponível", { status: 503 }); }
  const secret = metaCredentials(config).appSecret;
  const keys = [secret, config.instagram_app_secret].filter((key): key is string => Boolean(key));
  if (!keys.some((key) => signatureMatches(rawBody, signature, key))) {
    try { await logEvent(null, "signature_mismatch", { motivo: "Assinatura inválida; confira a chave do app principal.", tem_header: Boolean(signature) }); } catch {}
    return new NextResponse("invalid signature", { status: 401 });
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || !Array.isArray(body.entry)) throw new Error("invalid payload");
    for (const entry of body.entry) {
      if (!entry || typeof entry !== "object" || (entry.changes && !Array.isArray(entry.changes)) || (entry.messaging && !Array.isArray(entry.messaging))) throw new Error("invalid entry");
    }
  } catch { return new NextResponse("bad json", { status: 400 }); }
  try { await saveWebhookEvents(body); }
  catch { return new NextResponse("evento não persistido", { status: 503 }); }
  after(async () => { try { await drainQueue(); } catch {} });
  return new NextResponse("ok", { status: 200 });
}
