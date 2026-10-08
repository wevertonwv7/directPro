import { NextRequest, NextResponse } from "next/server";
import { listPosts, listStories, findPostByUrl } from "@/lib/messaging";
import { getSelectedAccount } from "@/lib/account";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

// Quantos posts por lote. Um número alto deixa a primeira abertura lenta; este
// aqui enche a grade e o resto vem no "Carregar mais".
const LOTE = 24;

// Lista posts/reels (padrão) ou stories ativos (?type=stories) da conta
// selecionada no painel, para o seletor visual do formulário.
//
// Também atende dois pedidos que o seletor faz:
// - ?after=CURSOR → próxima página (botão "Carregar mais")
// - ?url=LINK     → acha o post correspondente ao link colado
export async function GET(req: NextRequest) {
  if (!isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  try {
    const account = await getSelectedAccount();
    if (!account) {
      return NextResponse.json({ error: "Conecte uma conta primeiro" }, { status: 400 });
    }
    const params = req.nextUrl.searchParams;

    const url = params.get("url");
    if (url) {
      const encontrado = await findPostByUrl(account, url);
      if (!encontrado) {
        return NextResponse.json(
          {
            error:
              "Não achei esse post nesta conta. Confira se o link é de um post publicado por ela (e não de outro perfil ou de um story).",
          },
          { status: 404 }
        );
      }
      return NextResponse.json({ media: [encontrado], after: null });
    }

    if (params.get("type") === "stories") {
      return NextResponse.json({ media: await listStories(account), after: null });
    }

    const page = await listPosts(account, LOTE, params.get("after"));
    return NextResponse.json(page);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro" },
      { status: 500 }
    );
  }
}
