"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSelectedAccount, getSelectedAccountId } from "@/lib/account";
import { normalizarMidia } from "@/lib/media";

function splitList(raw: string, sep: RegExp): string[] {
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveAutomation(formData: FormData): Promise<void> {
  await ensureSchema();
  const account = await getSelectedAccount();
  if (!account)
    redirect(
      `/automacoes?erro=${encodeURIComponent("Conecte uma conta do Instagram antes.")}`
    );
  const accountId = account.ig_user_id;
  const id = String(formData.get("id") ?? "");
  // Gatilho único por automação (comment, story ou dm)
  const trigger = String(formData.get("trigger") ?? "");
  if (!["comment", "story", "dm"].includes(trigger))
    redirect(`/automacoes?erro=${encodeURIComponent("Escolha o gatilho da automação.")}`);
  // A página do Facebook não recebe resposta a story pela API: salvar isso
  // criaria uma automação que nunca dispara, sem nenhum aviso.
  if (trigger === "story" && account.platform === "facebook")
    redirect(
      `/automacoes?erro=${encodeURIComponent("Resposta a story só existe no Instagram. Escolha comentário ou mensagem.")}`
    );
  const triggers = [trigger];

  const name = String(formData.get("name") ?? "").trim();
  const active = Boolean(formData.get("active"));
  const keywords = splitList(String(formData.get("keywords") ?? ""), /,/);
  const matchType = String(formData.get("match_type") ?? "contains");
  // post/story/resposta pública só fazem sentido no gatilho correspondente
  const mediaId =
    trigger === "comment" ? String(formData.get("media_id") ?? "") || null : null;
  const mediaThumb =
    trigger === "comment" ? String(formData.get("media_thumbnail_url") ?? "") || null : null;
  const mediaCaption =
    trigger === "comment" ? String(formData.get("media_caption") ?? "") || null : null;
  const mediaPermalink =
    trigger === "comment" ? String(formData.get("media_permalink") ?? "") || null : null;
  const storyId = trigger === "story" ? String(formData.get("story_id") ?? "") || null : null;
  const storyThumb =
    trigger === "story" ? String(formData.get("story_thumbnail_url") ?? "") || null : null;
  const publicReplies =
    trigger === "comment" ? splitList(String(formData.get("public_replies") ?? ""), /\r?\n/) : [];
  // Anexos. normalizarMidia devolve null para endereço inválido: melhor gravar
  // "sem anexo" do que gravar um link que a Meta não consegue buscar e ver a
  // mensagem falhar só na hora do envio.
  const midia = (campo: string) =>
    normalizarMidia(formData.get(`${campo}_media_type`), formData.get(`${campo}_media_url`));
  // No gatilho de comentário a mensagem de boas-vindas é uma resposta privada,
  // que a Meta só entrega com texto — o formulário nem oferece o campo ali.
  const welcomeMedia = trigger === "comment" ? null : midia("welcome");
  const linkMedia = midia("link");
  const followupMedia = midia("followup");

  const welcomeText = String(formData.get("welcome_text") ?? "").trim();
  const quickReplyLabel =
    String(formData.get("quick_reply_label") ?? "").trim() || "Quero o link! 🔗";
  const linkText = String(formData.get("link_text") ?? "").trim();
  const linkButtonLabel = String(formData.get("link_button_label") ?? "").trim() || "Abrir link";
  const linkUrl = String(formData.get("link_url") ?? "").trim();
  // Etapas opcionais do fluxo
  const requireFollow = Boolean(formData.get("require_follow"));
  const followText = String(formData.get("follow_text") ?? "").trim();
  const followButtonLabel =
    String(formData.get("follow_button_label") ?? "").trim() || "Já sigo! ✅";
  const askEmail = Boolean(formData.get("ask_email"));
  const emailText = String(formData.get("email_text") ?? "").trim();
  // o coraçãozinho só faz sentido no gatilho de story
  const storyReaction =
    trigger === "story" ? String(formData.get("story_reaction") ?? "").trim() : "";

  // Enviar o link é opcional. Desligado, a automação entrega só a mensagem —
  // útil para quem só quer responder, sem mandar ninguém para fora.
  const sendLink = Boolean(formData.get("send_link"));

  // Acompanhamento: etapa única de mensagem por tempo — absorveu o antigo
  // "Lembrar quem não clicou" (os dois disparavam igual, para todo mundo, já
  // que a API não informa cliques). É independente do passo do link: URL e
  // rótulo de botão próprios, então dá para mandar uma segunda oferta em vez
  // de repetir a primeira. URL vazia manda só texto.
  // Chave explícita da etapa: desligada, nenhuma linha de acompanhamento é
  // criada e portanto nada é enviado — mas o texto continua salvo na automação,
  // para religar sem reescrever.
  const sendFollowup = Boolean(formData.get("send_followup"));
  const followupText = String(formData.get("followup_text") ?? "").trim();
  const followupUrl = String(formData.get("followup_url") ?? "").trim();
  const followupButtonLabel = String(formData.get("followup_button_label") ?? "").trim();
  // Teto de 20h (1200 min): a mensagem ainda precisa caber na janela de 24h da
  // Meta, contada a partir da última interação da pessoa. O padrão é o próprio
  // teto — já foi 1440, que era maior que o limite e nascia inválido.
  const followupDelay = Math.max(
    5,
    Math.min(1200, Number(formData.get("followup_delay_minutes") ?? 1200) || 1200)
  );

  if (!name) redirect(`/automacoes?erro=${encodeURIComponent("Dê um nome à automação.")}`);
  if (matchType !== "any" && !keywords.length)
    redirect(`/automacoes?erro=${encodeURIComponent("Informe as palavras-chave.")}`);
  if (!welcomeText)
    redirect(`/automacoes?erro=${encodeURIComponent("Escreva a DM de boas-vindas.")}`);

  // Colunas por NOME, não por posição: a lista de campos da automação cresce a
  // cada recurso novo, e com $1..$28 bastava inserir um campo no meio para
  // deslocar todos os outros em silêncio.
  const campos: Record<string, unknown> = {
    name,
    active,
    triggers,
    keywords,
    match_type: matchType,
    media_id: mediaId,
    media_thumbnail_url: mediaThumb,
    media_caption: mediaCaption,
    media_permalink: mediaPermalink,
    story_id: storyId,
    story_thumbnail_url: storyThumb,
    public_replies: publicReplies,
    welcome_text: welcomeText,
    welcome_media_type: welcomeMedia?.kind ?? null,
    welcome_media_url: welcomeMedia?.url ?? null,
    link_media_type: linkMedia?.kind ?? null,
    link_media_url: linkMedia?.url ?? null,
    followup_media_type: followupMedia?.kind ?? null,
    followup_media_url: followupMedia?.url ?? null,
    quick_reply_label: quickReplyLabel,
    link_text: linkText,
    link_button_label: linkButtonLabel,
    link_url: linkUrl,
    require_follow: requireFollow,
    follow_text: followText,
    follow_button_label: followButtonLabel,
    ask_email: askEmail,
    email_text: emailText,
    story_reaction: storyReaction,
    send_link: sendLink,
    followup_text: followupText,
    followup_delay_minutes: followupDelay,
    followup_url: followupUrl,
    followup_button_label: followupButtonLabel,
    send_followup: sendFollowup,
  };
  const colunas = Object.keys(campos);
  const valores = Object.values(campos);

  let automationId = id;
  if (id) {
    // o account_id no where impede editar automação de outra conta
    const sets = colunas.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    await sql().query(
      `update automations set ${sets}, updated_at = now()
       where id = $${colunas.length + 1} and account_id = $${colunas.length + 2}`,
      [...valores, id, accountId]
    );
  } else {
    const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
    const rows = (await sql().query(
      `insert into automations (${colunas.map((c) => `"${c}"`).join(", ")}, account_id)
       values (${placeholders}, $${colunas.length + 1})
       returning id`,
      [...valores, accountId]
    )) as { id: string }[];
    automationId = rows[0].id;
  }

  // regenera a sequência de follow-ups a partir da automação
  await sql().query(`delete from followups where automation_id = $1`, [automationId]);
  // url vazia faz o motor enviar apenas texto, sem botão (lib/ig.ts → linkMessage)
  await sql().query(
    `insert into followups (automation_id, position, kind, text, button_label, url, delay_minutes,
                            media_type, media_url)
     values ($1, 1, 'link', $2, $3, $4, 0, $5, $6)`,
    [
      automationId,
      linkText || "Aqui está o seu link! 👇",
      linkButtonLabel,
      sendLink ? linkUrl : "",
      linkMedia?.kind ?? null,
      linkMedia?.url ?? null,
    ]
  );
  // Acompanhamento incondicional, com link e botão próprios: o atraso conta a
  // partir da entrega do link e a mensagem sai para todo mundo que passou pelo
  // fluxo. URL vazia = só texto, mesma regra do passo do link acima.
  if (sendFollowup && followupText) {
    await sql().query(
      `insert into followups (automation_id, position, kind, text, button_label, url, delay_minutes,
                              media_type, media_url)
       values ($1, 2, 'followup', $2, $3, $4, $5, $6, $7)`,
      [
        automationId,
        followupText,
        followupButtonLabel || "Abrir link",
        followupUrl,
        followupDelay,
        followupMedia?.kind ?? null,
        followupMedia?.url ?? null,
      ]
    );
  }

  revalidatePath("/automacoes");
  redirect("/automacoes");
}

export async function toggleAutomation(id: string, active: boolean): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;
  await sql().query(
    `update automations set active = $1, updated_at = now() where id = $2 and account_id = $3`,
    [active, id, accountId]
  );
  revalidatePath("/automacoes");
}

export async function deleteAutomation(id: string): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;
  await sql().query(`delete from automations where id = $1 and account_id = $2`, [id, accountId]);
  revalidatePath("/automacoes");
}

// Duplica a automação inteira, inclusive os follow-ups. As colunas são copiadas
// por nome (em vez de listadas uma a uma) para a cópia continuar completa
// quando colunas novas forem adicionadas no futuro.
export async function duplicateAutomation(id: string): Promise<void> {
  const accountId = await getSelectedAccountId();
  if (!accountId) return;

  const rows = (await sql().query(
    `select * from automations where id = $1 and account_id = $2`,
    [id, accountId]
  )) as Record<string, unknown>[];
  const original = rows[0];
  if (!original) return;

  // colunas geradas pelo banco não entram na cópia
  const ignorar = new Set(["id", "created_at", "updated_at"]);
  const colunas = Object.keys(original).filter((c) => !ignorar.has(c));
  const valores = colunas.map((c) => {
    if (c === "name") return `${String(original.name ?? "Automação")} (cópia)`;
    // a cópia nasce pausada: evita duas automações disputando a mesma
    // palavra-chave sem o usuário perceber
    if (c === "active") return false;
    return original[c];
  });

  const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");
  const novo = (await sql().query(
    `insert into automations (${colunas.map((c) => `"${c}"`).join(", ")})
     values (${placeholders}) returning id`,
    valores
  )) as { id: string }[];

  const novoId = novo[0]?.id;
  if (novoId) {
    await sql().query(
      `insert into followups (automation_id, position, kind, text, button_label, url, delay_minutes,
                              media_type, media_url)
       select $1, position, kind, text, button_label, url, delay_minutes, media_type, media_url
       from followups where automation_id = $2`,
      [novoId, id]
    );
  }
  revalidatePath("/automacoes");
}
