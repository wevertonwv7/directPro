import { createHmac, timingSafeEqual } from "node:crypto";

export function signatureMatches(body: string, header: string | null, secret: string): boolean {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const a = createHmac("sha256", secret).update(body, "utf8").digest();
  const b = Buffer.from(header.slice(7), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEvent = {
  accountId: string;
  kind: "comment" | "facebook_feed" | "message";
  platform: "instagram" | "facebook";
  value: Record<string, unknown>;
};
export type WebhookBody = {
  object?: string;
  entry?: {
    id?: string;
    changes?: { field?: string; value?: Record<string, unknown> }[];
    messaging?: Record<string, unknown>[];
  }[];
};

export function webhookEvents(body: WebhookBody): { key: string; event: WebhookEvent }[] {
  if (!["instagram", "page"].includes(body.object ?? "")) return [];
  const facebook = body.object === "page";
  const result: { key: string; event: WebhookEvent }[] = [];
  for (const entry of body.entry ?? []) {
    if (!entry?.id) continue;
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      if (facebook && change.field === "feed" && value.item === "comment" && value.verb === "add" && value.comment_id) {
        result.push({ key: `facebook:${entry.id}:comment:${value.comment_id}`,
          event: { accountId: entry.id, kind: "facebook_feed", platform: "facebook", value } });
      } else if (!facebook && change.field === "comments" && value.id && (!value.verb || value.verb === "add")) {
        result.push({ key: `instagram:${entry.id}:comment:${value.id}`,
          event: { accountId: entry.id, kind: "comment", platform: "instagram", value } });
      }
    }
    for (const value of entry.messaging ?? []) {
      const message = value?.message as { mid?: string; is_echo?: boolean } | undefined;
      if (!message?.mid || message.is_echo) continue;
      const platform = facebook ? "facebook" : "instagram";
      result.push({ key: `${platform}:${entry.id}:message:${message.mid}`,
        event: { accountId: entry.id, kind: "message", platform, value } });
    }
  }
  return result;
}
