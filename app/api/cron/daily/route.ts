import { NextRequest, NextResponse } from "next/server";
import { drainQueue } from "@/lib/engine";
import { refreshLongLivedToken } from "@/lib/ig";
import { getUserProfile, isFacebook, fotoDaConta } from "@/lib/messaging";
import { listAccounts, updateAccountToken, sql } from "@/lib/db";

export const maxDuration = 60;

// Cron diário da Vercel (o plano grátis permite 1x/dia). Para CADA conta
// conectada:
// 1) renova o token longo do Instagram quando ele tem mais de 7 dias
// 2) renova a foto de perfil da própria conta (a URL assinada vence)
// 3) atualiza nome/foto dos contatos recentes (mesmo motivo)
// e no fim drena a fila como rede de segurança.
export async function GET(req: NextRequest) {
  // se CRON_SECRET existir, a Vercel manda "Authorization: Bearer <segredo>"
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let refreshed = 0;
  let profiles = 0;
  let fotos = 0;
  const accounts = await listAccounts();

  for (const original of accounts) {
    // o token pode ser renovado no meio do caminho; as chamadas seguintes
    // precisam usar o novo, senão a atualização de perfis falha com 401
    let account = original;

    // Página do Facebook não entra na renovação: o token dela não expira.
    if (!isFacebook(account) && account.token_expires_at) {
      const expires = new Date(account.token_expires_at).getTime();
      const ageDays = 60 - (expires - Date.now()) / 86_400_000; // token longo dura 60 dias
      if (ageDays >= 7) {
        try {
          const r = await refreshLongLivedToken(account.access_token);
          await updateAccountToken(
            account.ig_user_id,
            r.access_token,
            new Date(Date.now() + r.expires_in * 1000)
          );
          account = { ...account, access_token: r.access_token };
          refreshed++;
        } catch {
          // token com menos de 24h ou erro transitório: tenta de novo amanhã
        }
      }
    }

    // Foto da PRÓPRIA conta: uma chamada por conta, por dia. É o que mantém a
    // barra lateral, o painel e a prévia com a foto certa — o endereço
    // guardado no OAuth vence em algumas semanas.
    try {
      await fotoDaConta(account);
      fotos++;
    } catch {
      // acesso bloqueado ou Meta instável: as telas caem na inicial e o
      // endpoint ao vivo tenta de novo quando alguém abrir o painel
    }

    const contacts = (await sql().query(
      `select ig_id from contacts
       where account_id = $1
       order by coalesce(last_reply_at, first_contact_at) desc
       limit 20`,
      [account.ig_user_id]
    )) as { ig_id: string }[];

    for (const c of contacts) {
      try {
        const p = await getUserProfile(account, c.ig_id);
        await sql().query(
          `update contacts set
             username = coalesce($3, username),
             name = coalesce($4, name),
             profile_pic = coalesce($5, profile_pic)
           where account_id = $1 and ig_id = $2`,
          [account.ig_user_id, c.ig_id, p.username ?? null, p.name ?? null, p.profile_pic ?? null]
        );
        profiles++;
      } catch {
        // conta privada/apagada ou só comentou: mantém o que já temos
      }
    }
  }

  const drained = await drainQueue();
  return NextResponse.json({ accounts: accounts.length, refreshed, fotos, profiles, ...drained });
}
