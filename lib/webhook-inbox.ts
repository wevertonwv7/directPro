import "server-only";
import { ensureSchema, sql, getConfig } from "./db";
import { handleCommentEvent, handleFacebookFeedChange, handleMessagingEvent, logEvent } from "./engine";
import { webhookEvents, type WebhookBody, type WebhookEvent } from "./webhook-events";
import { scheduleTick } from "./qstash";
import { redactSecrets } from "./secrets";

export async function saveWebhookEvents(body: WebhookBody): Promise<void> {
  await ensureSchema();
  const events = webhookEvents(body);
  if (!events.length) return;
  const s = sql();
  await s.transaction(events.map(({ key, event }) => s.query(
    `insert into webhook_receipts (event_key, payload) values ($1, $2)
     on conflict (event_key) do nothing`, [key, JSON.stringify(event)]
  )));
}

export async function processWebhookInbox(): Promise<void> {
  await ensureSchema();
  // Um evento por reivindicação evita que o restante do lote expire enquanto
  // o primeiro consulta a Meta. Se a instância cair, cron/QStash o recuperam.
  for (let i = 0; i < 15; i++) {
    const rows = await sql().query(
      `update webhook_receipts r set status = 'processing', claimed_at = now(), attempts = attempts + 1
       where event_key in (
         select event_key from webhook_receipts
         where status = 'pending' or (status = 'processing' and claimed_at < now() - interval '3 minutes')
         order by created_at limit 1 for update skip locked
       ) returning *`
    ) as { event_key: string; payload: WebhookEvent; attempts: number }[];
    const receipt = rows[0];
    if (!receipt) break;
    const event = receipt.payload;
    try {
      if (event.kind === "comment") await handleCommentEvent(event.accountId, event.value as never);
      else if (event.kind === "facebook_feed") await handleFacebookFeedChange(event.accountId, event.value as never);
      else await handleMessagingEvent(event.accountId, event.value as never, event.platform);
      await sql().query(`update webhook_receipts set status = 'done', error = null where event_key = $1`, [receipt.event_key]);
    } catch (err) {
      const error = redactSecrets(err).slice(0, 500);
      await sql().query(`update webhook_receipts set status = $2, error = $3 where event_key = $1`,
        [receipt.event_key, receipt.attempts >= 5 ? "failed" : "pending", error]);
      await logEvent(event.accountId, "webhook_processing_failed", { event_key: receipt.event_key, error });
      break;
    }
  }
  const pending = await sql().query(`select 1 from webhook_receipts where status in ('pending','processing') limit 1`) as unknown[];
  if (pending.length) await scheduleTick((await getConfig()).app_url ?? "", 30);
}
