import { NextRequest, NextResponse } from "next/server";
import { instagramAuthorizeUrl } from "@/lib/fb";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { getConfig } from "@/lib/db";
import { canonicalAppUrl } from "@/lib/app-url";
import { metaCredentials } from "@/lib/meta-config";
import { createOAuthState, OAUTH_COOKIE, OAUTH_MAX_AGE } from "@/lib/oauth";
import { encryptionKey, redactSecrets } from "@/lib/secrets";

export async function GET(req: NextRequest) {
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!isValidSession(session)) return NextResponse.redirect(new URL("/entrar", req.url));
  try {
    const config = await getConfig();
    const appUrl = canonicalAppUrl(config.app_url, req.nextUrl.origin);
    if (new URL(appUrl).origin !== req.nextUrl.origin) {
      return NextResponse.redirect(`${appUrl}/api/oauth/login`);
    }
    const { appId, appSecret, configId } = metaCredentials(config);
    if (!appId || !appSecret) throw new Error("Cadastre as credenciais do app principal da Meta no passo 2.");
    encryptionKey();
    const redirectUri = `${appUrl}/api/oauth/callback`;
    const state = await createOAuthState(session!, redirectUri);
    const res = NextResponse.redirect(instagramAuthorizeUrl(appId, redirectUri, state, configId));
    res.cookies.set(OAUTH_COOKIE, state, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      maxAge: OAUTH_MAX_AGE, path: "/api/oauth",
    });
    return res;
  } catch (err) {
    return NextResponse.redirect(new URL(`/setup?erro=${encodeURIComponent(redactSecrets(err))}`, req.url));
  }
}
