import Link from "next/link";
import { getSelectedAccount } from "@/lib/account";
import { ensureSchema } from "@/lib/db";
import { nomeDaConta } from "@/lib/format";
import ImportForm from "./import-client";
import { card, muted, alertError, link, pageTitle, pageSubtitle } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ImportarFluxoPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const sp = await searchParams; // Next 16: searchParams é assíncrono
  await ensureSchema();
  const account = await getSelectedAccount();

  return (
    <div className="space-y-6">
      {sp.erro && <div className={alertError}>{sp.erro}</div>}

      <div>
        <h1 className={pageTitle}>Importar fluxo</h1>
        <p className={pageSubtitle}>
          {account ? (
            <>
              Os fluxos vão para <span className="font-medium">{nomeDaConta(account)}</span> e
              chegam pausados.
            </>
          ) : (
            "Conecte uma conta para importar fluxos"
          )}
        </p>
      </div>

      {!account ? (
        <div className={`p-8 text-center text-sm ${card} ${muted}`}>
          Conecte uma conta em{" "}
          <Link href="/setup" className={link}>
            Configuração
          </Link>{" "}
          antes de importar.
        </div>
      ) : (
        <ImportForm />
      )}
    </div>
  );
}
