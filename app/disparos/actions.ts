"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql, ensureSchema, getConfig } from "@/lib/db";
import { getSelectedAccountId } from "@/lib/account";
import { scheduleTick } from "@/lib/qstash";

// Margem igual à do motor (lib/engine.ts → windowOpen): 5 min antes das 24h,
// para não enfileirar quem vai expirar no caminho.
const JANELA = "23 hours 55 minutes";

function erro(msg: string): never {
  redirect(`/disparos?erro=${encodeURIComponent(msg)}`);
}

export async function enviarDisparo(formData: FormData): Promise<void> {
  await ensureSchema();
  const accountId = await getSelectedAccountId();
  if (!accountId) erro("Conecte uma conta do Instagram antes.");

  const texto = String(formData.get("text") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const botao = String(formData.get("button_label") ?? "").trim();
  // getAll: a lista vem de checkboxes com o mesmo name
  const escolhidos = formData.getAll("ig_ids").map(String).filter(Boolean);

  if (!texto) erro("Escreva a mensagem do disparo.");
  if (!escolhidos.length) erro("Selecione pelo menos um contato.");

  // A lista do cliente é só uma intenção: quem decide é o banco. Reconsultar
  // aqui impede disparar para janela fechada (ou para contato de outra conta)
  // mesmo que o formulário venha adulterado ou velho.
  const validos = (await sql().query(
    `select ig_id from contacts
      where account_id = $1
        and ig_id = any($2::text[])
        and last_reply_at is not null
        and last_reply_at > now() - interval '${JANELA}'`,
    [accountId, escolhidos]
  )) as { ig_id: string }[];

  if (!validos.length)
    erro("Nenhum dos contatos escolhidos ainda está com a janela de 24h aberta.");

  const bc = (await sql().query(
    `insert into broadcasts (account_id, text, button_label, url, total)
     values ($1, $2, $3, $4, $5) returning id`,
    [accountId, texto, botao, url, validos.length]
  )) as { id: string }[];
  const broadcastId = bc[0].id;

  // Ordem de envio: quem está mais perto de expirar sai primeiro. O dreno
  // ordena por created_at, e um insert em lote daria o mesmo timestamp para
  // todo mundo — o offset em milissegundos desempata sem jogar nada para o
  // futuro. O ritmo em si (GAP_MS, BATCH_SIZE, teto horário) é do motor.
  await sql().query(
    `insert into queue (account_id, kind, contact_ig_id, payload, dedupe_key, created_at)
     select $1, 'dm_broadcast', c.ig_id,
            jsonb_build_object('text', $2::text, 'button_label', $3::text, 'url', $4::text),
            'bc:' || $5::text || ':' || c.ig_id,
            now() + (row_number() over (order by c.last_reply_at asc)) * interval '1 millisecond'
       from contacts c
      where c.account_id = $1
        and c.ig_id = any($6::text[])
     on conflict (dedupe_key) do nothing`,
    [
      accountId,
      texto,
      botao,
      url,
      broadcastId,
      validos.map((v) => v.ig_id),
    ]
  );

  // Acorda a fila agora; o próprio dreno reagenda enquanto sobrar pendente.
  const config = await getConfig();
  await scheduleTick(config.app_url ?? "", 1);

  revalidatePath("/disparos");
  redirect(`/disparos?enviados=${validos.length}`);
}
