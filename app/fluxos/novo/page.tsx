import { getSelectedAccount } from "@/lib/account";
import FlowEditor, { type Account } from "../editor";

export const dynamic = "force-dynamic";

// Sem cabeçalho de página: o editor ocupa a tela inteira e leva a navegação
// (voltar, nome, salvar) na própria barra de cima.
export default async function NovoFluxoPage() {
  let account: Account | null = null;
  try {
    const selected = await getSelectedAccount();
    if (selected) {
      account = { username: selected.username, platform: selected.platform };
    }
  } catch {
    // sem banco/conta ainda: o editor abre em modo Instagram
  }

  return <FlowEditor flow={null} account={account} />;
}
