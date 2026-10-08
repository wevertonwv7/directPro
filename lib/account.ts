import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { listAccounts, Account } from "./db";

// Conta atualmente selecionada no painel. O valor vive num cookie; se estiver
// ausente ou apontar para uma conta que não existe mais, cai na primeira.
export const ACCOUNT_COOKIE = "many_account";

// A lista de contas é pedida DUAS vezes em toda navegação do painel: uma pelo
// layout (para o seletor da barra lateral) e outra pela página (para saber em
// qual conta ela está). São a mesma consulta, no mesmo instante, com a mesma
// resposta — cache() faz a segunda aproveitar a primeira e corta uma ida ao
// banco de cada tela. Fica aqui, e não em lib/db, porque o motor da fila roda
// fora de uma requisição e precisa continuar consultando o banco de verdade.
export const contasDoPainel = cache(listAccounts);

export async function getSelectedAccount(): Promise<Account | null> {
  const accounts = await contasDoPainel();
  if (!accounts.length) return null;
  const id = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  return accounts.find((a) => a.ig_user_id === id) ?? accounts[0];
}

export async function getSelectedAccountId(): Promise<string | null> {
  return (await getSelectedAccount())?.ig_user_id ?? null;
}
