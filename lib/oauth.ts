import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ensureSchema, sql } from "./db";

export const OAUTH_COOKIE = "many_oauth_state";
export const OAUTH_MAX_AGE = 600;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function stateMatches(state: string | null, cookie: string | undefined): boolean {
  if (!state || !cookie || !/^[a-f0-9]{64}$/.test(state)) return false;
  const a = Buffer.from(state), b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createOAuthState(session: string, redirectUri: string): Promise<string> {
  await ensureSchema();
  const state = randomBytes(32).toString("hex");
  await sql().query(`delete from oauth_states where expires_at < now()`);
  await sql().query(
    `insert into oauth_states (state_hash, session_hash, redirect_uri, expires_at)
     values ($1, $2, $3, now() + interval '10 minutes')`,
    [hash(state), hash(session), redirectUri]
  );
  return state;
}

export async function consumeOAuthState(state: string, session: string): Promise<string | null> {
  await ensureSchema();
  const rows = await sql().query(
    `delete from oauth_states where state_hash = $1 and session_hash = $2 and expires_at > now()
     returning redirect_uri`, [hash(state), hash(session)]
  ) as { redirect_uri: string }[];
  return rows[0]?.redirect_uri ?? null;
}
