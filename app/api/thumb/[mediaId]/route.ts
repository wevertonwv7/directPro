import { NextResponse } from "next/server";
import { getSelectedAccount } from "@/lib/account";
import { findMediaById } from "@/lib/messaging";

export const dynamic = "force-dynamic";

// ============================================================
// Miniatura sempre viva de um post ou story
//
// As URLs de imagem da Meta são ASSINADAS E EXPIRAM (algumas semanas). O
// painel guardava a URL no momento em que a pessoa escolhia o post, então
// automações antigas iam ficando com a miniatura quebrada — a imagem existia,
// o endereço é que tinha vencido.
//
// Aqui o endereço é resolvido na hora, a partir do id do post (que não muda), e
// respondido como redirecionamento. O cache curto evita bater na Meta a cada
// linha da lista, sem segurar um endereço vencido por muito tempo.
// ============================================================
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params; // Next 16: params é assíncrono
  if (!/^[0-9_]{1,64}$/.test(mediaId)) return new NextResponse("not found", { status: 404 });

  const account = await getSelectedAccount();
  if (!account) return new NextResponse("no account", { status: 404 });

  try {
    const url = await findMediaById(account, mediaId);
    if (!url) return new NextResponse("not found", { status: 404 });
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "cache-control": "private, max-age=600" },
    });
  } catch {
    // post apagado, sem permissão, Meta fora do ar: quem chamou mostra o
    // espaço reservado em vez de um ícone de imagem quebrada
    return new NextResponse("not found", { status: 404 });
  }
}
