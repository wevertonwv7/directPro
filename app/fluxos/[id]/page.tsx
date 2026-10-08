import { notFound } from "next/navigation";
import { sql, ensureSchema, type Flow } from "@/lib/db";
import { getSelectedAccount } from "@/lib/account";
import { normalizarGrafo } from "@/lib/flow";
import FlowEditor, { type Account, type FlowData } from "../editor";

export const dynamic = "force-dynamic";

export default async function EditarFluxoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 16: params é assíncrono
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await ensureSchema();
  const selected = await getSelectedAccount();
  if (!selected) notFound();

  // só abre fluxo da conta selecionada
  const rows = (await sql().query(`select * from flows where id = $1 and account_id = $2`, [
    id,
    selected.ig_user_id,
  ])) as Flow[];
  const flow = rows[0];
  if (!flow) notFound();

  const dados: FlowData = {
    id: flow.id,
    name: flow.name,
    active: flow.active,
    trigger: flow.trigger,
    keywords: flow.keywords,
    match_type: flow.match_type,
    media_id: flow.media_id,
    media_thumbnail_url: flow.media_thumbnail_url,
    media_caption: flow.media_caption,
    media_permalink: flow.media_permalink,
    story_id: flow.story_id,
    story_thumbnail_url: flow.story_thumbnail_url,
    public_replies: flow.public_replies,
    // normaliza na entrada: o desenho salvo pode ser de uma versão anterior
    graph: normalizarGrafo({ nodes: flow.nodes, edges: flow.edges }),
  };

  const account: Account = { username: selected.username, platform: selected.platform };

  return <FlowEditor flow={dados} account={account} />;
}
