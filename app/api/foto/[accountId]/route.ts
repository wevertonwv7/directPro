import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/db";
import { fotoDaConta } from "@/lib/messaging";

export const dynamic = "force-dynamic";

// ============================================================
// Foto de perfil sempre viva de uma conta conectada
//
// Mesma história das miniaturas de post: a URL da foto é ASSINADA pela Meta e
// vence. Ela é guardada no banco quando a conta é conectada e, semanas depois,
// para de abrir — o painel inteiro passa a mostrar só a inicial.
//
// Aqui o endereço é pedido de novo à Meta na hora, a partir do id da conta (que
// não muda), e devolvido como redirecionamento. O valor novo também volta para
// o banco, então as outras telas já pegam a foto boa sem nova ida à Meta.
// ============================================================
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params; // Next 16: params é assíncrono
  if (!/^[0-9]{1,32}$/.test(accountId)) return new NextResponse("not found", { status: 404 });

  try {
    // Só contas conectadas neste painel: o id vem da URL e não pode virar um
    // pedido a uma conta qualquer da Meta.
    const conta = (await listAccounts()).find((a) => a.ig_user_id === accountId);
    if (!conta) return new NextResponse("not found", { status: 404 });

    const url = await fotoDaConta(conta);
    if (!url) return new NextResponse("not found", { status: 404 });
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "cache-control": "private, max-age=3600" },
    });
  } catch {
    // Banco fora do ar, acesso do app bloqueado, token vencido, Meta instável:
    // 404 em vez de 500. Isto aqui é o src de uma <img> — quem chamou só
    // precisa saber que não veio foto, para mostrar a inicial.
    return new NextResponse("not found", { status: 404 });
  }
}
