import { sql, ensureSchema } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { montarPacote, type FluxoDoBanco } from "@/lib/flow-io";

export const dynamic = "force-dynamic";

// Baixa TODOS os fluxos da conta selecionada num arquivo só. É o backup do
// trabalho de quem montou dez fluxos à mão — e o caminho para levá-los para
// outra conta sem refazer nada.
export async function GET() {
  await ensureSchema();
  const account = await getSelectedAccount();
  if (!account) return new Response("no account", { status: 400 });

  const rows = (await sql().query(
    `select name, trigger, match_type, keywords, public_replies, nodes, edges
     from flows where account_id = $1 order by created_at`,
    [account.ig_user_id]
  )) as FluxoDoBanco[];

  const data = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(montarPacote(rows), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="fluxos-${data}.json"`,
      "cache-control": "no-store",
    },
  });
}
