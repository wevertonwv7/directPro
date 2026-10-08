import { sql, ensureSchema, Contact } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { hoursAgo, nomeDaConta } from "@/lib/format";
import { atualizarPerfis } from "./actions";
import { card, btnGhost, muted, pageTitle, pageSubtitle } from "../ui";
import ContactsList, { ContactRow } from "./list-client";

export const dynamic = "force-dynamic";

type Row = Contact & { automation_name: string | null };

export default async function ContatosPage() {
  await ensureSchema();
  const account = await getSelectedAccount();
  const rows = account
    ? ((await sql().query(
        `select c.*, a.name as automation_name
         from contacts c
         left join automations a on a.id = c.last_automation_id
         where c.account_id = $1
         order by c.first_contact_at desc
         limit 200`,
        [account.ig_user_id]
      )) as Row[])
    : [];

  const semNome = rows.filter((c) => !c.username).length;

  // Serializa para o componente cliente (datas viram string) e resolve a janela
  // de 24h no servidor, onde a regra já existe.
  const contatos: ContactRow[] = rows.map((c) => {
    const h = hoursAgo(c.last_reply_at);
    return {
      ig_id: c.ig_id,
      username: c.username,
      name: c.name,
      profile_pic: c.profile_pic,
      email: c.email,
      first_contact_at: new Date(c.first_contact_at).toISOString(),
      last_reply_at: c.last_reply_at ? new Date(c.last_reply_at).toISOString() : null,
      automation_name: c.automation_name,
      janelaAberta: h !== null && h < 24,
      tags: c.tags ?? [],
    };
  });
  const comEmail = contatos.filter((c) => c.email).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Contatos</h1>
          {account && (
            <p className={pageSubtitle}>
              de <span className="font-medium">{nomeDaConta(account)}</span> ·{" "}
              {rows.length} {rows.length === 1 ? "pessoa" : "pessoas"}
              {comEmail > 0 && ` · ${comEmail} com e-mail`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {semNome > 0 && (
            <form action={atualizarPerfis}>
              <button className={btnGhost}>Buscar nomes ({semNome} sem nome)</button>
            </form>
          )}
          {comEmail > 0 && (
            <a href="/api/contatos/csv" className={btnGhost} download>
              Exportar CSV
            </a>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={`p-8 text-center text-sm ${card} ${muted}`}>
          {account ? "Ninguém interagiu ainda." : "Conecte uma conta do Instagram primeiro."}
        </div>
      ) : (
        <ContactsList contatos={contatos} />
      )}
    </div>
  );
}
