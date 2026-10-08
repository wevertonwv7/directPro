import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, exchangeForLongLivedToken, listInstagramPages, grantedPermissions, tokenExpiration, INSTAGRAM_FB_SCOPES } from "@/lib/fb";
import { subscribeToWebhooks } from "@/lib/ig-facebook";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { getConfig, upsertAccount } from "@/lib/db";
import { metaCredentials } from "@/lib/meta-config";
import { consumeOAuthState, stateMatches, OAUTH_COOKIE } from "@/lib/oauth";
import { ACCOUNT_COOKIE } from "@/lib/account";
import { logEvent } from "@/lib/engine";
import { redactSecrets } from "@/lib/secrets";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, req.nextUrl.origin));
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/oauth", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return response;
  };
  const fail = (reason: string) => finish(`/setup?erro=${encodeURIComponent(reason)}`);
  try {
    const session = req.cookies.get(SESSION_COOKIE)?.value;
    const state = q.get("state");
    if (!isValidSession(session) || !stateMatches(state, req.cookies.get(OAUTH_COOKIE)?.value)) {
      return fail("Sessão ou state inválido. Entre no painel e reinicie a conexão.");
    }
    const redirectUri = await consumeOAuthState(state!, session!);
    if (!redirectUri) return fail("A autorização expirou ou já foi utilizada. Reinicie a conexão.");
    if (q.get("error")) return fail("Autorização cancelada ou negada no Facebook. Reinicie a conexão e conceda as permissões.");
    const code = q.get("code");
    if (!code) return fail("O Facebook não retornou um código de autorização.");
    const config = await getConfig();
    const { appId, appSecret } = metaCredentials(config);
    if (!appId || !appSecret) return fail("Credenciais do app principal da Meta ausentes.");
    const short = await exchangeCodeForToken({ appId, appSecret, redirectUri, code });
    const long = await exchangeForLongLivedToken(appId, appSecret, short.access_token);
    const granted = await grantedPermissions(long.access_token);
    const missing = INSTAGRAM_FB_SCOPES.filter((scope) => !granted.includes(scope));
    if (missing.length) return fail(`Permissões não concedidas: ${missing.join(", ")}. Confira o acesso no app da Meta e reconecte.`);
    const pages = await listInstagramPages(long.access_token);
    if (!pages.length) return fail("Nenhuma Página foi autorizada. No Facebook, selecione a Página vinculada ao Instagram e confira seu acesso a ela.");
    const linked = pages.filter((p) => p.instagram_business_account?.id && p.access_token);
    if (!linked.length) return fail("As Páginas autorizadas não têm Instagram profissional vinculado. Vincule sua conta profissional à Página nas configurações do Facebook.");
    const warnings: string[] = [];
    const connected: string[] = [];
    for (const page of linked) {
      const ig = page.instagram_business_account!;
      try {
        const expiresAt = await tokenExpiration(page.access_token, appId, appSecret);
        await upsertAccount({
          ig_user_id: ig.id, platform: "instagram", auth_provider: "facebook_login",
          facebook_page_id: page.id, facebook_page_name: page.name ?? null,
          username: ig.username ?? null, name: ig.name ?? null, profile_picture_url: ig.profile_picture_url ?? null,
          access_token: page.access_token, token_expires_at: expiresAt,
        });
        connected.push(ig.id);
        try { await subscribeToWebhooks(page.id, page.access_token); }
        catch (err) {
          warnings.push(`@${ig.username ?? ig.id}: conta salva; assinatura falhou. Use Reassinar webhooks.`);
          await logEvent(ig.id, "subscribe_failed", { message: redactSecrets(err) });
        }
      } catch (err) {
        warnings.push(`Página ${page.name ?? page.id}: ${redactSecrets(err).slice(0, 180)}`);
      }
    }
    if (!connected.length) return fail(warnings.join("\n") || "Não foi possível conectar as contas autorizadas.");
    const res = finish(warnings.length
      ? `/setup?erro=${encodeURIComponent(`${connected.length} conta(s) conectada(s).\n${warnings.join("\n")}`)}`
      : `/setup?salvo=${encodeURIComponent(`${connected.length} Instagram(s) conectado(s) via Facebook.`)}`);
    res.cookies.set(ACCOUNT_COOKIE, connected[0], { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return res;
  } catch (err) {
    return fail(redactSecrets(err).slice(0, 350));
  }
}
