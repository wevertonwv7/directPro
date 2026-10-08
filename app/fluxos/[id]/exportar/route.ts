import { sql, ensureSchema } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { paraExportar, nomeDeArquivo, FORMATO_ATUAL, type FluxoDoBanco } from "@/lib/flow-io";

export const dynamic = "force-dynamic";

// Baixa UM fluxo como arquivo .json. A rota fica ao lado do editor (e não em
// /api) para o endereço ser adivinhável: /fluxos/<id>/exportar.
//
// O acesso já é protegido pela sessão em proxy.ts; o account_id no where é a
// segunda tranca, para um id de outra conta não virar download.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params; // Next 16: params é assíncrono
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });

  await ensureSchema();
  const account = await getSelectedAccount();
  if (!account) return new Response("no account", { status: 400 });

  const rows = (await sql().query(
    `select name, trigger, match_type, keywords, public_replies, nodes, edges
     from flows where id = $1 and account_id = $2`,
    [id, account.ig_user_id]
  )) as FluxoDoBanco[];
  if (!rows[0]) return new Response("not found", { status: 404 });

  const corpo = { formato: FORMATO_ATUAL, fluxos: [paraExportar(rows[0])] };
  return new Response(JSON.stringify(corpo, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${nomeDeArquivo(rows[0].name)}"`,
      "cache-control": "no-store",
    },
  });
}
