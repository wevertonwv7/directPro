"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSelectedAccount, getSelectedAccountId } from "@/lib/account";
import { normalizarGrafo } from "@/lib/flow";
import { lerTexto, ErroDeImportacao, type FluxoPortavel } from "@/lib/flow-io";

function splitList(raw: string, sep: RegExp): string[] {
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function salvarFluxo(formData: FormData): Promise<void> {
  await ensureSchema();
  const account = await getSelectedAccount();
  if (!account)
    redirect(
      `/fluxos?erro=${encodeURIComponent("Conecte uma conta do Instagram antes.")}`
    );

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const active = Boolean(formData.get("active"));
  const trigger = String(formData.get("trigger") ?? "comment");
  if (!["comment", "story", "dm"].includes(trigger))
    redirect(`/fluxos?erro=${encodeURIComponent("Escolha o gatilho do fluxo.")}`);
  if (trigger === "story" && account.platform === "facebook")
    redirect(
      `/fluxos?erro=${encodeURIComponent("Resposta a story só existe no Instagram. Escolha comentário ou mensagem.")}`
    );

  const keywords = splitList(String(formData.get("keywords") ?? ""), /,/);
  const matchType = String(formData.get("match_type") ?? "contains");
  if (!name) redirect(`/fluxos?erro=${encodeURIComponent("Dê um nome ao fluxo.")}`);
  if (matchType !== "any" && !keywords.length)
    redirect(`/fluxos?erro=${encodeURIComponent("Informe as palavras-chave.")}`);

  // O desenho chega como JSON de um editor que roda no navegador: normalizar
  // aqui é o que garante que o motor sempre encontre um grafo coerente.
  let grafo;
  try {
    grafo = normalizarGrafo(JSON.parse(String(formData.get("graph") ?? "{}")));
  } catch {
    redirect(`/fluxos?erro=${encodeURIComponent("Não consegui ler o desenho do fluxo.")}`);
  }

  const campos: Record<string, unknown> = {
    name,
    active,
    trigger,
    keywords,
    match_type: matchType,
    media_id: trigger === "comment" ? String(formData.get("media_id") ?? "") || null : null,
    media_thumbnail_url:
      trigger === "comment" ? String(formData.get("media_thumbnail_url") ?? "") || null : null,
    media_caption:
      trigger === "comment" ? String(formData.get("media_caption") ?? "") || null : null,
    media_permalink:
      trigger === "comment" ? String(formData.get("media_permalink") ?? "") || null : null,
    story_id: trigger === "story" ? String(formData.get("story_id") ?? "") || null : null,
    story_thumbnail_url:
      trigger === "story" ? String(formData.get("story_thumbnail_url") ?? "") || null : null,
    public_replies:
      trigger === "comment"
        ? splitList(String(formData.get("public_replies") ?? ""), /\r?\n/)
        : [],
    nodes: JSON.stringify(grafo.nodes),
    edges: JSON.stringify(grafo.edges),
  };
  const colunas = Object.keys(campos);
  const valores = Object.values(campos);

  if (id) {
    const sets = colunas.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    await sql().query(
      `update flows set ${sets}, updated_at = now()
       where id = $${colunas.length + 1} and account_id = $${colunas.length + 2}`,
      [...valores, id, account.ig_user_id]
    );
  } else {
    const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
    await sql().query(
      `insert into flows (${colunas.map((c) => `"${c}"`).join(", ")}, account_id)
       values (${placeholders}, $${colunas.length + 1})`,
      [...valores, account.ig_user_id]
    );
  }

  revalidatePath("/fluxos");
  redirect("/fluxos");
}

// ============================================================
// Importação
//
// Recebe o conteúdo de um arquivo .json (colado ou lido no navegador) e cria os
// fluxos na conta selecionada. Três decisões que valem explicação:
//
// 1. Tudo nasce PAUSADO. Um pacote de dez fluxos que entrasse ativo passaria a
//    responder comentários no mesmo segundo, com os links de exemplo dentro.
// 2. Post e story não vêm no arquivo (lib/flow-io.ts explica por quê), então o
//    fluxo importado vale para todos os posts até a pessoa escolher um.
// 3. O desenho passa por normalizarGrafo antes de virar linha no banco: o
//    arquivo é texto que veio de fora e não pode ser tratado como confiável.
// ============================================================
export async function importarFluxo(formData: FormData): Promise<void> {
  await ensureSchema();
  const account = await getSelectedAccount();
  if (!account)
    redirect(`/fluxos?erro=${encodeURIComponent("Conecte uma conta do Instagram antes.")}`);

  let fluxos: FluxoPortavel[];
  try {
    fluxos = lerTexto(String(formData.get("json") ?? ""));
  } catch (err) {
    const msg =
      err instanceof ErroDeImportacao ? err.message : "Não consegui ler o arquivo de fluxos.";
    redirect(`/fluxos/importar?erro=${encodeURIComponent(msg)}`);
  }

  const criados: string[] = [];
  for (const f of fluxos) {
    // Story só existe no Instagram: numa página do Facebook o fluxo entraria e
    // nunca dispararia. Vira gatilho de mensagem, que é o equivalente que a
    // página tem — e o aviso no fim conta o que foi trocado.
    const trigger =
      f.trigger === "story" && account.platform === "facebook" ? "dm" : f.trigger;

    const campos: Record<string, unknown> = {
      name: f.name,
      active: false,
      trigger,
      keywords: f.keywords,
      match_type: f.match_type,
      public_replies: trigger === "comment" ? f.public_replies : [],
      nodes: JSON.stringify(f.graph.nodes),
      edges: JSON.stringify(f.graph.edges),
    };
    const colunas = Object.keys(campos);
    const valores = Object.values(campos);
    const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
    const rows = (await sql().query(
      `insert into flows (${colunas.map((c) => `"${c}"`).join(", ")}, account_id)
       values (${placeholders}, $${colunas.length + 1})
       returning id`,
      [...valores, account.ig_user_id]
    )) as { id: string }[];
    criados.push(rows[0].id);
  }

  revalidatePath("/fluxos");
  // Um fluxo só: abre direto no editor, que é onde a pessoa vai trocar os
  // links. Vários: volta para a lista, com o aviso de que estão pausados.
  if (criados.length === 1) redirect(`/fluxos/${criados[0]}`);
  redirect(
    `/fluxos?salvo=${encodeURIComponent(
      `${criados.length} fluxos importados e pausados. Abra cada um, troque os links de exemplo e ative.`
    )}`
  );
}

export async function alternarFluxo(id: string, active: boolean): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;
  await sql().query(
    `update flows set active = $1, updated_at = now() where id = $2 and account_id = $3`,
    [active, id, accountId]
  );
  revalidatePath("/fluxos");
}

export async function apagarFluxo(id: string): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;
  await sql().query(`delete from flows where id = $1 and account_id = $2`, [id, accountId]);
  revalidatePath("/fluxos");
}

// Copia o fluxo inteiro, inclusive o desenho. Nasce pausado: duas versões
// disputando a mesma palavra-chave sem ninguém perceber é armadilha.
export async function duplicarFluxo(id: string): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;
  const rows = (await sql().query(`select * from flows where id = $1 and account_id = $2`, [
    id,
    accountId,
  ])) as Record<string, unknown>[];
  const original = rows[0];
  if (!original) return;

  const ignorar = new Set(["id", "created_at", "updated_at"]);
  const colunas = Object.keys(original).filter((c) => !ignorar.has(c));
  const valores = colunas.map((c) => {
    if (c === "name") return `${String(original.name ?? "Fluxo")} (cópia)`;
    if (c === "active") return false;
    if (c === "nodes" || c === "edges") return JSON.stringify(original[c]);
    return original[c];
  });
  const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
  await sql().query(
    `insert into flows (${colunas.map((c) => `"${c}"`).join(", ")}) values (${placeholders})`,
    valores
  );
  revalidatePath("/fluxos");
}
