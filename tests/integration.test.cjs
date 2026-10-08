const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createHmac } = require("node:crypto");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const { NextRequest, NextResponse } = require("next/server");

// PostgreSQL real em memória; somente a rede da Meta e o agendador são simulados.
// O adaptador reproduz a interface lazy/transaction do driver Neon.
const pg = new PGlite();
const root = path.resolve(__dirname, "..");
const cache = new Map();
const jobs = [];
let handler = () => { throw new Error("Unexpected network call"); };
const originalFetch = global.fetch;
function query(text, params = []) {
  return { text, params, then(resolve, reject) { return pg.query(text, params).then((r) => r.rows).then(resolve, reject); } };
}
function sql(strings, ...params) {
  return query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), params);
}
sql.query = query;
sql.transaction = (queries) => pg.transaction(async (tx) => {
  const results = [];
  for (const q of queries) results.push((await tx.query(q.text, q.params)).rows);
  return results;
});
const mocks = {
  "server-only": {},
  "@neondatabase/serverless": { neon: () => sql },
  "next/server": { NextRequest, NextResponse, after: (callback) => jobs.push(callback) },
};
function load(name, parent = path.join(root, "placeholder.ts")) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
  let filename = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(parent), name);
  if (!filename.endsWith(".ts")) filename += ".ts";
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (request) => load(request, filename);
  cache.set(filename, mod);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  mod._compile(source, filename);
  return mod.exports;
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const request = (url, cookies = "") => new NextRequest(url, { headers: { cookie: cookies } });
let db, engine, inbox, auth, oauth, fb, ig, secrets, deliveries;
const account = {
  ig_user_id: "ig-1", platform: "instagram", auth_provider: "facebook_login",
  facebook_page_id: "page-1", facebook_page_name: "Página de teste", username: "empresa",
  name: "Empresa", profile_picture_url: null, access_token: "page-token",
  token_expires_at: null,
};
before(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-only";
  process.env.DATABASE_URL = "postgresql://test.invalid/test";
  process.env.CREDENTIALS_ENCRYPTION_KEY = "ab".repeat(32);
  delete process.env.QSTASH_TOKEN;
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  delete process.env.FACEBOOK_LOGIN_CONFIG_ID;
  global.fetch = (...args) => handler(...args);
  db = load("@/lib/db"); engine = load("@/lib/engine"); inbox = load("@/lib/webhook-inbox");
  auth = load("@/lib/auth"); oauth = load("@/lib/oauth"); fb = load("@/lib/fb");
  ig = load("@/lib/ig-facebook"); secrets = load("@/lib/secrets"); deliveries = load("@/lib/delivery");
  await db.ensureSchema();
  await db.updateConfig({ meta_app_id: "123", meta_app_secret: "test-app-secret", app_url: "https://app.example.com", webhook_verify_token: "verify-test" });
  await db.upsertAccount(account);
});
after(async () => { global.fetch = originalFetch; await pg.close(); });

test("schema, credenciais cifradas e leitura compatível", async () => {
  const rows = (await pg.query("select access_token from accounts")).rows;
  assert.match(rows[0].access_token, /^enc:v1:/);
  assert.equal((await db.getAccount("ig-1")).access_token, "page-token");
  const config = (await pg.query("select meta_app_secret from config")).rows[0];
  assert.match(config.meta_app_secret, /^enc:v1:/);
  assert.equal((await db.getConfig()).meta_app_secret, "test-app-secret");
  const cipher = secrets.encryptSecret("secret-value");
  assert.equal(secrets.decryptSecret(cipher), "secret-value");
  assert.notEqual(cipher, secrets.encryptSecret("secret-value"));
  assert.equal(secrets.decryptSecret("legacy-value"), "legacy-value");
  const bytes = Buffer.from(cipher.slice(7), "base64"); bytes[20] ^= 1;
  assert.throws(() => secrets.decryptSecret("enc:v1:" + bytes.toString("base64")));
});

test("OAuth exige painel autenticado, usa Facebook e state com uso único/expiração", async () => {
  const login = load("@/app/api/oauth/login/route");
  const callback = load("@/app/api/oauth/callback/route");
  const anon = await login.GET(request("https://app.example.com/api/oauth/login"));
  assert.equal(new URL(anon.headers.get("location")).pathname, "/entrar");
  const session = auth.sessionValue();
  const start = await login.GET(request("https://app.example.com/api/oauth/login", `many_session=${session}`));
  const url = new URL(start.headers.get("location"));
  assert.equal(url.hostname, "www.facebook.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/api/oauth/callback");
  assert.ok(!url.searchParams.get("scope").includes("instagram_business_"));
  const state = url.searchParams.get("state");
  assert.equal(state.length, 64);
  const cookies = `many_session=${session}; many_oauth_state=${state}`;
  const invalid = await callback.GET(request(`https://app.example.com/api/oauth/callback?code=x&state=${"0".repeat(64)}`, cookies));
  assert.match(invalid.headers.get("location"), /erro=/);
  let call = 0;
  handler = (raw, init) => {
    const u = new URL(raw); call++;
    if (u.pathname.endsWith("/oauth/access_token")) return response({ access_token: "user-token", expires_in: 5184000 });
    if (u.pathname.endsWith("/me/permissions")) return response({ data: fb.INSTAGRAM_FB_SCOPES.map((permission) => ({ permission, status: "granted" })) });
    if (u.pathname.endsWith("/me/accounts")) return response({ data: [{ id: "page-1", name: "Página de teste", access_token: "page-token", instagram_business_account: { id: "ig-1", username: "empresa" } }] });
    if (u.pathname.endsWith("/debug_token")) return response({ data: { is_valid: true, app_id: "123", expires_at: 0, data_access_expires_at: 0 } });
    if (u.pathname.endsWith("/page-1/subscribed_apps")) {
      assert.equal(init.method, "POST");
      assert.match(String(init.body), /comments/);
      return response({ success: true });
    }
    throw new Error("Unexpected OAuth request: " + u.pathname);
  };
  const success = await callback.GET(request(`https://app.example.com/api/oauth/callback?code=x&state=${state}`, cookies));
  assert.match(success.headers.get("location"), /salvo=/);
  assert.equal(success.cookies.get("many_account").value, "ig-1");
  const count = call;
  const replay = await callback.GET(request(`https://app.example.com/api/oauth/callback?code=x&state=${state}`, cookies));
  assert.match(replay.headers.get("location"), /erro=/);
  assert.equal(call, count);
  const expired = await oauth.createOAuthState(session, "https://app.example.com/api/oauth/callback");
  await pg.query("update oauth_states set expires_at = now() - interval '1 minute'");
  assert.equal(await oauth.consumeOAuthState(expired, session), null);
});

test("OAuth reporta permissão negada, Página ausente e vínculo ausente", async () => {
  const callback = load("@/app/api/oauth/callback/route");
  for (const scenario of ["denied", "missing_scope", "no_page", "no_instagram"]) {
    const session = auth.sessionValue();
    const state = await oauth.createOAuthState(session, "https://app.example.com/api/oauth/callback");
    handler = (raw) => {
      const u = new URL(raw);
      if (u.pathname.endsWith("/oauth/access_token")) return response({ access_token: "user" });
      if (u.pathname.endsWith("/me/permissions")) return response({ data: (scenario === "missing_scope" ? [] : fb.INSTAGRAM_FB_SCOPES).map((permission) => ({ permission, status: "granted" })) });
      if (u.pathname.endsWith("/me/accounts")) return response({ data: scenario === "no_page" ? [] : [{ id: "page-x", access_token: "token" }] });
      throw new Error("Unexpected request");
    };
    const url = `https://app.example.com/api/oauth/callback?state=${state}&${scenario === "denied" ? "error=access_denied" : "code=x"}`;
    const res = await callback.GET(request(url, `many_session=${session}; many_oauth_state=${state}`));
    const error = new URL(res.headers.get("location")).searchParams.get("erro");
    assert.match(error, { denied: /negada/, missing_scope: /Permissões/, no_page: /Nenhuma Página/, no_instagram: /não têm Instagram/ }[scenario]);
  }
});

test("páginas paginadas, token expirável e chamadas na Graph correta", async () => {
  let n = 0;
  handler = (raw, init) => {
    const url = new URL(raw);
    assert.equal(url.hostname, "graph.facebook.com");
    assert.match(url.pathname, /^\/v26\.0\//);
    if (url.pathname.endsWith("/me/accounts")) {
      n++;
      return response(n === 1 ? { data: [{ id: "page-a" }], paging: { next: "ignored", cursors: { after: "next-cursor" } } } : { data: [{ id: "page-b" }] });
    }
    if (url.pathname.endsWith("/debug_token")) return response({ data: { is_valid: true, app_id: "123", expires_at: 0, data_access_expires_at: 2000000000 } });
    if (url.pathname.endsWith("/ig-1/messages")) {
      assert.equal(init.headers.Authorization, "Bearer page-token");
      assert.deepEqual(JSON.parse(init.body).recipient, { comment_id: "comment-x" });
      return response({ message_id: "mid" });
    }
    if (url.pathname.endsWith("/ig-1/media")) return response({ data: [{ id: "reel-1", media_type: "VIDEO" }] });
    throw new Error("Unexpected request");
  };
  assert.deepEqual((await fb.listInstagramPages("user")).map((p) => p.id), ["page-a", "page-b"]);
  assert.equal((await fb.tokenExpiration("page-token", "123", "secret")).getTime(), 2000000000000);
  await ig.sendMessage("ig-1", "page-token", { comment_id: "comment-x" }, { text: "link" });
  assert.equal((await load("@/lib/messaging").listPosts(await db.getAccount("ig-1"))).media[0].id, "reel-1");
});

test("webhook: desafio, assinatura válida, rejeição de corpo alterado", async () => {
  const route = load("@/app/api/webhook/route");
  const res = await route.GET(request("https://app.example.com/api/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=42"));
  assert.equal(res.status, 200); assert.equal(await res.text(), "42");
  assert.equal((await route.GET(request("https://app.example.com/api/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"))).status, 403);
  const raw = JSON.stringify({ object: "instagram", entry: [] });
  const signature = "sha256=" + createHmac("sha256", "test-app-secret").update(raw).digest("hex");
  const post = (text, sig) => new NextRequest("https://app.example.com/api/webhook", { method: "POST", body: text, headers: { "x-hub-signature-256": sig } });
  assert.equal((await route.POST(post(raw, signature))).status, 200);
  assert.equal((await route.POST(post(raw + " ", signature))).status, 401);
  assert.equal((await route.POST(post(raw, signature + "garbage"))).status, 401);
  jobs.length = 0;
});

test("comentário QUERO no Reels gera uma resposta privada, duplicatas e contas desconhecidas não disparam", async () => {
  await pg.query("insert into automations(account_id, name, keywords, match_type, media_id, welcome_text, quick_reply_label) values ('ig-1','Reels teste',ARRAY['QUERO'],'exact','reel-1','Aqui está o link: https://exemplo.com','')");
  const payload = { object: "instagram", entry: [{ id: "ig-1", changes: [{ field: "comments", value: { id: "comment-1", from: { id: "person-1", username: "seguidor" }, media: { id: "reel-1" }, text: "quero" } }] }] };
  let sent = 0;
  handler = (raw, init) => {
    const u = new URL(raw);
    if (u.pathname.endsWith("/comment-1")) return response({ timestamp: new Date().toISOString() });
    if (u.pathname.endsWith("/ig-1/messages")) {
      sent++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body.recipient, { comment_id: "comment-1" });
      assert.equal(body.message.text, "Aqui está o link: https://exemplo.com");
      assert.equal(body.message.quick_replies, undefined);
      return response({ message_id: "sent-1" });
    }
    throw new Error("Unexpected network call: " + u.pathname);
  };
  await Promise.all([inbox.saveWebhookEvents(payload), inbox.saveWebhookEvents(payload)]);
  await engine.drainQueue();
  await inbox.saveWebhookEvents(payload); await engine.drainQueue();
  assert.equal(sent, 1);
  assert.equal((await pg.query("select count(*)::int n from webhook_receipts where event_key like '%comment-1'")).rows[0].n, 1);
  assert.equal((await pg.query("select count(*)::int n from queue where comment_id='comment-1'")).rows[0].n, 1);
  const contact = (await pg.query("select last_reply_at from contacts where ig_id='person-1'")).rows[0];
  assert.equal(contact.last_reply_at, null);
  for (const [id, text, media] of [["comment-2", "não", "reel-1"], ["comment-3", "QUERO", "another-reel"]]) {
    await engine.handleCommentEvent("ig-1", { id, from: { id: "person-1" }, text, media: { id: media } });
  }
  await engine.handleCommentEvent("unknown-account", { id: "comment-4", from: { id: "person-1" }, text: "QUERO", media: { id: "reel-1" } });
  assert.equal((await pg.query("select count(*)::int n from queue")).rows[0].n, 1);
});

test("resposta privada após sete dias é pulada; janela de 24h não abre pelo comentário", async () => {
  await engine.handleCommentEvent("ig-1", { id: "expired-comment", from: { id: "person-old" }, text: "QUERO", media: { id: "reel-1" } });
  handler = (raw) => {
    assert.ok(new URL(raw).pathname.endsWith("/expired-comment"));
    return response({ timestamp: new Date(Date.now() - 8 * 86400000).toISOString() });
  };
  const result = await engine.drainQueue();
  assert.equal(result.skipped, 1);
  await pg.query("insert into queue(account_id,kind,contact_ig_id,payload,dedupe_key) values ('ig-1','dm_followup','person-old','{\"text\":\"não pode enviar\"}','window-closed')");
  assert.equal((await engine.drainQueue()).skipped, 1);
});

test("resposta recebida abre a janela sem renovar por duplicata ou evento antigo", async () => {
  let sent = 0;
  handler = (raw, init) => {
    const u = new URL(raw);
    if (u.pathname.endsWith("/person-old")) return response({ username: "pessoa" });
    if (u.pathname.endsWith("/ig-1/messages")) {
      assert.deepEqual(JSON.parse(init.body).recipient, { id: "person-old" });
      sent++;
      return response({ message_id: "reply-window" });
    }
    throw new Error("Unexpected network call: " + u.pathname);
  };
  const timestamp = Date.now() - 1000;
  const payload = { object: "instagram", entry: [{ id: "ig-1", messaging: [{ sender: { id: "person-old" }, timestamp, message: { mid: "incoming-reply", text: "obrigado" } }] }] };
  await inbox.saveWebhookEvents(payload); await engine.drainQueue();
  await pg.query("insert into queue(account_id,kind,contact_ig_id,payload,dedupe_key) values ('ig-1','dm_followup','person-old','{\"text\":\"agora pode\"}','window-open')");
  await engine.drainQueue();
  assert.equal(sent, 1);
  await inbox.saveWebhookEvents(payload); await engine.drainQueue();
  await engine.handleMessagingEvent("ig-1", { sender: { id: "person-old" }, timestamp: timestamp - 86400000, message: { mid: "older-reply", text: "obrigado" } });
  const row = (await pg.query("select last_reply_at from contacts where ig_id='person-old'")).rows[0];
  assert.equal(new Date(row.last_reply_at).getTime(), timestamp);
  assert.equal(sent, 1);
  await engine.logEvent("ig-1", "redaction-test", { access_token: "secret-token", url: 'https://example.com/?access_token=secret-value', text: 'quote " with slash \\' });
  const event = (await pg.query("select payload from events where type='redaction-test'")).rows[0].payload;
  assert.equal(event.access_token, "[redacted]");
  assert.ok(!event.url.includes("secret-value"));
});

test("reserva de envio impede duplicatas, recupera confirmação e diferencia rejeição transitória de timeout", async () => {
  let sent = 0;
  await deliveries.deliverOnce("delivery-success", async () => { sent++; });
  await deliveries.deliverOnce("delivery-success", async () => { sent++; });
  assert.equal(sent, 1);
  await assert.rejects(deliveries.deliverOnce("delivery-timeout", async () => { sent++; throw new Error("network timeout"); }), deliveries.UncertainDeliveryError);
  await assert.rejects(deliveries.deliverOnce("delivery-timeout", async () => { sent++; }), deliveries.UncertainDeliveryError);
  assert.equal(sent, 2);
  const { GraphError } = load("@/lib/graph");
  const transient = new GraphError(429, JSON.stringify({ error: { code: 4, is_transient: true } }));
  assert.equal(transient.retryable, true);
  await assert.rejects(deliveries.deliverOnce("delivery-transient", async () => { throw transient; }));
  await deliveries.deliverOnce("delivery-transient", async () => { sent++; });
  const outcomes = await Promise.allSettled([
    deliveries.deliverOnce("delivery-race", async () => { sent++; }),
    deliveries.deliverOnce("delivery-race", async () => { sent++; }),
  ]);
  assert.ok(outcomes.some((o) => o.status === "fulfilled"));
  assert.equal(sent, 4);
  assert.ok(!secrets.redactSecrets('https://graph.facebook.com/me?access_token=private-token&client_secret=private-secret').includes("private-token"));
});
