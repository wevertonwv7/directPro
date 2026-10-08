import Link from "next/link";
import { sql, ensureSchema, type Flow } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { normalizarGrafo } from "@/lib/flow";
import { nomeDaConta } from "@/lib/format";
import FlowsList, { ListaVazia, type FlowRow } from "./list-client";
import {
  card,
  btnPrimary,
  btnSecondary,
  muted,
  alertError,
  alertOk,
  link,
  pageTitle,
  pageSubtitle,
} from "../ui";

export const dynamic = "force-dynamic";

export default async function FluxosPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; salvo?: string }>;
}) {
  const sp = await searchParams;
  await ensureSchema();
  const account = await getSelectedAccount();
  const flows = account
    ? ((await sql().query(
        `select * from flows where account_id = $1 order by created_at desc`,
        [account.ig_user_id]
      )) as Flow[])
    : [];

  const rows: FlowRow[] = flows.map((f) => ({
    id: f.id,
    name: f.name,
    active: f.active,
    trigger: f.trigger,
    keywords: f.keywords,
    // conta só os blocos de verdade: o gatilho existe em todo fluxo
    blocos: normalizarGrafo({ nodes: f.nodes, edges: f.edges }).nodes.filter(
      (n) => n.kind !== "start"
    ).length,
    thumb: f.media_thumbnail_url ?? f.story_thumbnail_url ?? null,
    // o id acompanha a miniatura: é com ele que dá para pedir um endereço novo
    // quando o guardado vencer (as URLs da Meta são assinadas e expiram)
    mediaId: f.media_id ?? f.story_id ?? null,
  }));

  return (
    <div className="space-y-6">
      {sp.erro && <div className={alertError}>{sp.erro}</div>}
      {sp.salvo && <div className={alertOk}>{sp.salvo}</div>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Fluxos</h1>
          <p className={pageSubtitle}>
            {account ? (
              <>
                {rows.length === 0 ? "Nenhum fluxo" : `${rows.length} fluxo${rows.length > 1 ? "s" : ""}`}{" "}
                em <span className="font-medium">{nomeDaConta(account)}</span>
              </>
            ) : (
              "Conecte uma conta para começar"
            )}
          </p>
        </div>
        {account && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Baixar tudo é o backup de quem montou os fluxos à mão — e o
                caminho para levá-los para outra conta sem refazer nada. */}
            <a href="/fluxos/exportar" download className={btnSecondary}>
              Exportar todos
            </a>
            <Link href="/fluxos/importar" className={btnSecondary}>
              Importar
            </Link>
            <Link href="/fluxos/novo" className={btnPrimary}>
              Novo fluxo
            </Link>
          </div>
        )}
      </div>

      {!account ? (
        <div className={`p-8 text-center text-sm ${card} ${muted}`}>
          Conecte uma conta em{" "}
          <Link href="/setup" className={link}>
            Configuração
          </Link>{" "}
          para criar fluxos.
        </div>
      ) : rows.length === 0 ? (
        <ListaVazia />
      ) : (
        <FlowsList flows={rows} />
      )}
    </div>
  );
}
