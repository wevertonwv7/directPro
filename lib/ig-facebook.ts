import "server-only";
import { API_VERSION, graphRequest, GraphError, nextCursor, type Json, type Recipient, type OutgoingMessage } from "./graph";
import { FB_GRAPH } from "./fb";

const request = (path: string, token: string, init?: RequestInit) => graphRequest(
  `${FB_GRAPH}/${API_VERSION}${path}`,
  { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } }, GraphError
);

export async function getProfile(id: string, token: string) {
  return await request(`/${id}?fields=id,username,name,profile_picture_url`, token) as {
    id: string; username?: string; name?: string; profile_picture_url?: string;
  };
}

export async function getMedia(id: string, token: string, limit = 30, after?: string | null) {
  const p = new URLSearchParams({ fields: "id,media_type,media_url,thumbnail_url,caption,permalink", limit: String(limit) });
  if (after) p.set("after", after);
  const result = await request(`/${id}/media?${p}`, token);
  return { media: (result.data as Json[]) ?? [], after: nextCursor(result) };
}
export function getMediaById(id: string, token: string, fields: string) {
  return request(`/${id}?fields=${encodeURIComponent(fields)}`, token);
}
export async function getStories(id: string, token: string): Promise<Json[]> {
  const result = await request(`/${id}/stories?fields=id,media_type,media_url,thumbnail_url,caption,permalink`, token);
  return (result.data as Json[]) ?? [];
}
export async function getUserProfile(id: string, token: string) {
  return await request(`/${id}?fields=username,name,profile_pic`, token) as {
    username?: string; name?: string; profile_pic?: string;
  };
}
export async function checkFollowsAccount(id: string, token: string): Promise<boolean | null> {
  try {
    const result = await request(`/${id}?fields=is_user_follow_business`, token);
    return typeof result.is_user_follow_business === "boolean" ? result.is_user_follow_business : null;
  } catch { return null; }
}
export function sendMessage(id: string, token: string, recipient: Recipient, message: OutgoingMessage) {
  return request(`/${id}/messages`, token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });
}
export function replyToComment(id: string, token: string, text: string) {
  return request(`/${id}/replies`, token, {
    method: "POST", body: new URLSearchParams({ message: text }),
  });
}
export function sendReaction(id: string, token: string, recipientId: string, messageId: string, emoji: string) {
  return request(`/${id}/messages`, token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, sender_action: "react", payload: { message_id: messageId, reaction: emoji } }),
  });
}
export function subscribeToWebhooks(id: string, token: string) {
  return request(`/${id}/subscribed_apps`, token, {
    method: "POST", body: new URLSearchParams({ subscribed_fields: "comments,messages,messaging_postbacks" }),
  });
}
export async function getSubscribedFields(id: string, token: string): Promise<string[] | null> {
  try {
    const result = await request(`/${id}/subscribed_apps`, token);
    const rows = (result.data as { subscribed_fields?: (string | { name?: string })[] }[]) ?? [];
    return rows.flatMap((r) => (r.subscribed_fields ?? []).map((f) => typeof f === "string" ? f : f.name ?? ""));
  } catch { return null; }
}
export async function commentTimestamp(id: string, token: string): Promise<number> {
  const result = await request(`/${id}?fields=id,timestamp`, token);
  const timestamp = Date.parse(String(result.timestamp ?? ""));
  if (!Number.isFinite(timestamp)) throw new Error("Não foi possível confirmar a data do comentário.");
  return timestamp;
}
