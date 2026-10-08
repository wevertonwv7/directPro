import { sql, ensureSchema } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { card, muted, pageTitle, pageSubtitle, alertError, alertOk, tableWrap, thead, rowDivide } from "../ui";
import { fmtDate } from "@/lib/format";
import Compose, { Alvo } from "./compose-client";

export const dynamic = "force-dynamic";

// Mesma margem do motor (lib/engine.ts → windowOpen).
const JANELA = "23 hours 55 minutes";

type LinhaContato = {
  ig_id: string;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  last_reply_at: Date;
  horas_restantes: number;
};

type LinhaDisparo = {
  id: string;
  text: string;
  url: string;
  total: number;
  created_at: Date;
  enviados: number;
  pulados: number;
  falhos: number;
  na_fila: number;
};

export default async function DisparosPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; enviados?: string }>;
}) {
  const sp = await searchParams;
  await ensureSchema();
  const account = await getSelectedAccount();

  // Só quem pode receber: janela de 24h ainda aberta, com folga de 5 min.
  const contatos = account
    ? ((await sql().query(
        `select ig_id, username, name, profile_pic, last_reply_at,
                extract(epoch from (last_reply_at + interval '24 hours' - now())) / 3600
                  as horas_restantes
           from contacts
          where account_id = $1
            and last_reply_at is not null
            and last_reply_at > now() - interval '${JANELA}'
          order by last_reply_at asc`,
        [account.ig_user_id]
      )) as LinhaContato[])
    : [];

  // Resultado dos disparos recentes. A fila não guarda o id da campanha, mas o
  // dedupe_key nasce com o prefixo 'bc:<id>:' — dá para agrupar por ele.
  const disparos = account
    ? ((await sql().query(
        `select b.id, b.text, b.url, b.total, b.created_at,
                count(q.id) filter (where q.status = 'sent')::int as enviados,
                count(q.id) filter (where q.status = 'skipped')::int as pulados,
                count(q.id) filter (where q.status = 'failed')::int as falhos,
                count(q.id) filter (where q.status in ('pending','sending'))::int as na_fila
           from broadcasts b
           left join queue q on q.dedupe_key like 'bc:' || b.id::text || ':%'
          where b.account_id = $1
          group by b.id
          order by b.created_at desc
          limit 10`,
        [account.ig_user_id]
      )) as LinhaDisparo[])
    : [];

  const alvos: Alvo[] = contatos.map((c) => ({
    ig_id: c.ig_id,
    username: c.username,
    name: c.name,
    profile_pic: c.profile_pic,
    horasRestantes: Math.max(0, Number(c.horas_restantes)),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitle}>Disparos</h1>
        <p className={pageSubtitle}>
          Mensagem manual para quem já falou com você nas últimas 24h. Fora dessa janela a Meta
          não permite enviar — por isso a lista abaixo só mostra quem ainda dá tempo.
        </p>
      </div>

      {sp.erro && <p className={alertError}>{sp.erro}</p>}
      {sp.enviados && (
        <p className={alertOk}>
          Disparo criado para {sp.enviados}{" "}
          {sp.enviados === "1" ? "contato" : "contatos"}. Os envios saem aos poucos, respeitando
          o limite da Meta — acompanhe o resultado abaixo.
        </p>
      )}

      {!account ? (
        <div className={`p-8 text-center text-sm ${card} ${muted}`}>
          Conecte uma conta do Instagram primeiro.
        </div>
      ) : alvos.length === 0 ? (
        <div className={`p-8 text-center text-sm ${card} ${muted}`}>
          Ninguém está com a janela de 24h aberta agora. Assim que alguém te mandar uma mensagem,
          essa pessoa aparece aqui.
        </div>
      ) : (
        <Compose alvos={alvos} />
      )}

      {disparos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Disparos recentes
          </h2>
          <div className={tableWrap}>
            <table className="w-full text-left text-sm">
              <thead className={thead}>
                <tr>
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Mensagem</th>
                  <th className="px-4 py-3">Alvos</th>
                  <th className="px-4 py-3">Enviados</th>
                  <th className="px-4 py-3">Na fila</th>
                  <th className="px-4 py-3">Pulados</th>
                  <th className="px-4 py-3">Falhos</th>
                </tr>
              </thead>
              <tbody className={rowDivide}>
                {disparos.map((d) => (
                  <tr key={d.id}>
                    <td className={`whitespace-nowrap px-4 py-2.5 ${muted}`}>
                      {fmtDate(d.created_at)}
                    </td>
                    <td className="max-w-xs px-4 py-2.5">
                      <p className="truncate text-zinc-800 dark:text-zinc-200">{d.text}</p>
                      {d.url && <p className="truncate text-xs text-zinc-500">{d.url}</p>}
                    </td>
                    <td className={`px-4 py-2.5 ${muted}`}>{d.total}</td>
                    <td className="px-4 py-2.5 font-medium text-emerald-600 dark:text-emerald-400">
                      {d.enviados}
                    </td>
                    <td className={`px-4 py-2.5 ${muted}`}>{d.na_fila}</td>
                    <td className={`px-4 py-2.5 ${muted}`}>{d.pulados}</td>
                    <td className={`px-4 py-2.5 ${d.falhos ? "text-red-600 dark:text-red-400" : muted}`}>
                      {d.falhos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`text-xs ${muted}`}>
            &ldquo;Pulados&rdquo; são contatos cuja janela fechou entre a criação do disparo e a
            hora do envio — o motor confere de novo antes de cada mensagem e nunca envia fora da
            janela.
          </p>
        </section>
      )}
    </div>
  );
}
