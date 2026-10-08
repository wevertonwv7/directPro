import "server-only";
import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes } from "node:crypto";

// Banco Postgres (Neon, provisionado pela Vercel). Acesso só no servidor —
// a única credencial é a DATABASE_URL, que nunca chega ao navegador.
type Sql = ReturnType<typeof neon>;

let _sql: Sql | null = null;

// Aceita o banco com QUALQUER prefixo de variável (DATABASE_URL, STORAGE_URL,
// POSTGRES_URL...): o comprador não precisa acertar o "Custom Prefix" na Vercel.
function findDatabaseUrl(): string | undefined {
  const direct =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  if (direct) return direct;
  const candidates = Object.entries(process.env)
    .filter(
      ([k, v]) =>
        typeof v === "string" &&
        /^postgres(ql)?:\/\//.test(v) &&
        !/UNPOOLED|NON_?POOLING|NO_SSL/i.test(k)
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return candidates[0]?.[1];
}

export function sql(): Sql {
  if (!_sql) {
    const url = findDatabaseUrl();
    if (!url) {
      throw new Error(
        "Banco não encontrado. Na Vercel: Storage > Create Database > Neon, conecte ao projeto e faça um Redeploy."
      );
    }
    _sql = neon(url);
  }
  return _sql;
}

// ---------- Tipos ----------

// config guarda o que é da INSTÂNCIA (app da Meta, verify token, URL pública).
// Os campos de conta (ig_user_id, token…) são legados: hoje cada conta conectada
// vive na tabela `accounts`. Mantidos aqui só para a migração dos bancos antigos.
export type Config = {
  id: number;
  ig_user_id: string | null;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  access_token: string | null;
  token_expires_at: Date | null;
  connected_at: Date | null;
  instagram_app_id: string | null;
  instagram_app_secret: string | null;
  // Credenciais do APP principal (Configurações → Básico), diferentes das do
  // login do Instagram. Usadas para configurar o webhook via API.
  meta_app_id: string | null;
  meta_app_secret: string | null;
  webhook_verify_token: string | null;
  app_url: string | null;
};

// Instagram ou Facebook: o motor é o mesmo, só muda a API que entrega e envia.
export type Platform = "instagram" | "facebook";

// Uma conta conectada (perfil do Instagram ou página do Facebook). Várias podem
// coexistir na mesma instalação, de plataformas diferentes.
//
// A coluna continua se chamando ig_user_id por compatibilidade com os bancos já
// instalados: para o Facebook ela guarda o ID da PÁGINA, que é o mesmo id que a
// Meta manda em entry.id no webhook. Ou seja: em qualquer plataforma, esta é a
// chave que liga um evento à conta que deve responder.
export type Account = {
  ig_user_id: string;
  platform: Platform;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  access_token: string;
  token_expires_at: Date | null;
  connected_at: Date | null;
  created_at: Date;
};

export type Automation = {
  id: string;
  account_id: string;
  name: string;
  active: boolean;
  triggers: string[];
  keywords: string[];
  match_type: "contains" | "exact" | "any";
  media_id: string | null;
  media_thumbnail_url: string | null;
  media_caption: string | null;
  // Endereço público do post escolhido (instagram.com/p/… ou facebook.com/…).
  // Serve para abrir o post a partir do painel e para reconhecer o post quando
  // o usuário cola o link em vez de procurar na grade.
  media_permalink: string | null;
  story_id: string | null;
  story_thumbnail_url: string | null;
  public_replies: string[];
  welcome_text: string;
  // Anexo de cada etapa (imagem, áudio ou vídeo). A Meta busca a URL do lado
  // dela na hora do envio, então aqui vive o endereço, nunca o arquivo. As
  // etapas do link e do acompanhamento moram em `followups`; estas colunas são
  // a fonte que o formulário edita, igual a link_text e followup_text.
  welcome_media_type: string | null;
  welcome_media_url: string | null;
  link_media_type: string | null;
  link_media_url: string | null;
  followup_media_type: string | null;
  followup_media_url: string | null;
  quick_reply_label: string;
  link_text: string;
  link_button_label: string;
  link_url: string;
  // Colunas do antigo "Lembrar quem não clicou". A etapa foi unificada na
  // mensagem de acompanhamento (migração 2d) e não é mais lida nem escrita —
  // ficam aqui só como histórico do que já tinha sido configurado.
  reminder_text: string;
  reminder_delay_minutes: number;
  // Mensagem de acompanhamento: sai depois do prazo para todo mundo, tenha a
  // pessoa clicado no link ou não. Vazia = etapa desligada. É independente do
  // passo do link: tem a própria URL e o próprio rótulo de botão.
  followup_text: string;
  followup_delay_minutes: number;
  followup_url: string;
  followup_button_label: string;
  // Chave da etapa de acompanhamento. Desligada, nenhuma mensagem sai — e o
  // texto continua salvo, para religar sem reescrever.
  send_followup: boolean;
  // Vestigial: sobrevive só para a migração 2d saber se o lembrete antigo
  // repetia o link. O formulário hoje usa followup_url direto.
  followup_include_link: boolean;
  // etapas opcionais
  require_follow: boolean;
  follow_text: string;
  follow_button_label: string;
  ask_email: boolean;
  email_text: string;
  story_reaction: string; // emoji; vazio = não reage
  // Enviar o link é opcional: sem ele, a automação só manda a mensagem.
  send_link: boolean;
  // Histórico do lembrete antigo, como as duas colunas reminder_* acima.
  reminder_include_link: boolean;
  created_at: Date;
};

// Um fluxo: mesmo gatilho da automação simples, mas o que acontece depois é um
// mapa de blocos (lib/flow.ts) em vez de uma sequência fixa.
export type Flow = {
  id: string;
  account_id: string;
  name: string;
  active: boolean;
  trigger: "comment" | "story" | "dm";
  keywords: string[];
  match_type: "contains" | "exact" | "any";
  media_id: string | null;
  media_thumbnail_url: string | null;
  media_caption: string | null;
  media_permalink: string | null;
  story_id: string | null;
  story_thumbnail_url: string | null;
  public_replies: string[];
  nodes: unknown;
  edges: unknown;
  created_at: Date;
};

// Onde cada pessoa parou dentro de um fluxo. Uma linha por contato: a conversa
// é uma só, então entrar num fluxo novo substitui o anterior.
export type FlowRun = {
  account_id: string;
  contact_ig_id: string;
  flow_id: string;
  node_id: string | null;
  awaiting: string | null;
  updated_at: Date;
};

export type Followup = {
  id: string;
  automation_id: string;
  position: number;
  kind: "link" | "reminder" | "followup";
  text: string;
  button_label: string | null;
  url: string | null;
  media_type: string | null;
  media_url: string | null;
  delay_minutes: number;
};

export type Contact = {
  account_id: string;
  ig_id: string;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  email: string | null;
  awaiting: string | null;
  follow_attempts: number;
  // marcas postas por fluxos ("cliente", "quer o curso"…) — servem para
  // separar a lista em Contatos
  tags: string[];
  first_contact_at: Date;
  last_reply_at: Date | null;
  last_automation_id: string | null;
};

export type Broadcast = {
  id: string;
  account_id: string;
  text: string;
  button_label: string;
  url: string;
  total: number;
  created_at: Date;
};

export type QueueItem = {
  id: string;
  account_id: string | null;
  kind:
    | "private_reply"
    | "comment_reply"
    | "dm_welcome"
    | "dm_link"
    | "dm_reminder"
    | "dm_followup"
    | "dm_follow_gate"
    | "dm_email_ask"
    | "story_reaction"
    // Disparo manual para uma lista escolhida à mão, fora de qualquer automação
    | "dm_broadcast"
    // Blocos de um fluxo: a mensagem de um bloco e o "acorda e continua" que o
    // bloco de espera agenda para retomar o mapa mais tarde.
    | "flow_message"
    | "flow_resume";
  contact_ig_id: string | null;
  automation_id: string | null;
  comment_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: string;
  attempts: number;
  not_before: Date;
  claimed_at: Date | null;
  sent_at: Date | null;
  error: string | null;
  created_at: Date;
};

// ---------- Schema automático ----------
// Criado na primeira requisição: quem clona o projeto nunca roda SQL.

const DDL = [
  `create table if not exists config (
    id int primary key default 1 check (id = 1),
    ig_user_id text,
    username text,
    name text,
    profile_picture_url text,
    access_token text,
    token_expires_at timestamptz,
    connected_at timestamptz,
    instagram_app_id text,
    instagram_app_secret text,
    meta_app_id text,
    meta_app_secret text,
    webhook_verify_token text,
    app_url text,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists automations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    active boolean not null default true,
    triggers text[] not null default '{comment}',
    keywords text[] not null default '{}',
    match_type text not null default 'contains' check (match_type in ('contains','exact','any')),
    media_id text,
    media_thumbnail_url text,
    media_caption text,
    public_replies text[] not null default '{}',
    welcome_text text not null default '',
    quick_reply_label text not null default 'Quero o link! 🔗',
    link_text text not null default '',
    link_button_label text not null default 'Abrir link',
    link_url text not null default '',
    reminder_text text not null default '',
    reminder_delay_minutes int not null default 60,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists followups (
    id uuid primary key default gen_random_uuid(),
    automation_id uuid not null references automations(id) on delete cascade,
    position int not null,
    kind text not null check (kind in ('link','reminder','followup')),
    text text not null default '',
    button_label text,
    url text,
    delay_minutes int not null default 0
  )`,
  `create index if not exists followups_automation_idx on followups(automation_id, position)`,
  `create table if not exists contacts (
    ig_id text primary key,
    username text,
    first_contact_at timestamptz not null default now(),
    last_reply_at timestamptz,
    last_automation_id uuid references automations(id) on delete set null
  )`,
  `create table if not exists queue (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('private_reply','comment_reply','dm_welcome','dm_link','dm_reminder','dm_followup','dm_broadcast')),
    contact_ig_id text,
    automation_id uuid references automations(id) on delete cascade,
    comment_id text,
    payload jsonb not null default '{}',
    dedupe_key text unique,
    status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
    attempts int not null default 0,
    not_before timestamptz not null default now(),
    claimed_at timestamptz,
    sent_at timestamptz,
    error text,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists queue_pending_idx on queue(status, not_before)`,
  // Um disparo manual = uma linha aqui + N itens na fila (kind 'dm_broadcast').
  // Guardar a campanha separada é o que permite mostrar o resultado depois:
  // a fila sozinha não sabe que aqueles envios eram do mesmo disparo.
  `create table if not exists broadcasts (
    id uuid primary key default gen_random_uuid(),
    account_id text not null,
    text text not null,
    button_label text not null default '',
    url text not null default '',
    total int not null default 0,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists broadcasts_account_idx on broadcasts(account_id, created_at desc)`,
  `create table if not exists events (
    id uuid primary key default gen_random_uuid(),
    type text not null,
    payload jsonb not null default '{}',
    created_at timestamptz not null default now()
  )`,
  `create index if not exists events_created_idx on events(created_at desc)`,
  // Uma linha por conta conectada (multi-conta, multi-plataforma)
  `create table if not exists accounts (
    ig_user_id text primary key,
    platform text not null default 'instagram',
    username text,
    name text,
    profile_picture_url text,
    access_token text not null,
    token_expires_at timestamptz,
    connected_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  // Migrações leves para bancos criados antes destas colunas
  `alter table automations add column if not exists story_id text`,
  `alter table automations add column if not exists story_thumbnail_url text`,
  // Link público do post escolhido no seletor
  `alter table automations add column if not exists media_permalink text`,
  // Instagram continua sendo o padrão: quem já tinha contas conectadas não
  // precisa de nenhuma ação para elas seguirem funcionando igual.
  `alter table accounts add column if not exists platform text not null default 'instagram'`,
  `alter table contacts add column if not exists name text`,
  `alter table contacts add column if not exists profile_pic text`,
  // Vínculo com a conta dona (multi-conta)
  `alter table automations add column if not exists account_id text`,
  `alter table contacts add column if not exists account_id text`,
  `alter table queue add column if not exists account_id text`,
  `alter table events add column if not exists account_id text`,
  // Etapas opcionais do fluxo: pedir follow, pedir e-mail, reagir ao story
  `alter table automations add column if not exists require_follow boolean not null default false`,
  `alter table automations add column if not exists follow_text text not null default ''`,
  `alter table automations add column if not exists follow_button_label text not null default 'Já sigo! ✅'`,
  `alter table automations add column if not exists ask_email boolean not null default false`,
  `alter table automations add column if not exists email_text text not null default ''`,
  `alter table automations add column if not exists story_reaction text not null default ''`,
  // instalações antigas continuam com o comportamento atual (link sempre enviado,
  // lembrete repetindo o link), por isso o default é true nas duas.
  `alter table automations add column if not exists send_link boolean not null default true`,
  `alter table automations add column if not exists reminder_include_link boolean not null default true`,
  // Acompanhamento incondicional: sai para todo mundo depois do prazo, tenha a
  // pessoa clicado ou não. Nasce desligado (texto vazio) nas instalações antigas.
  `alter table automations add column if not exists followup_text text not null default ''`,
  `alter table automations add column if not exists followup_delay_minutes int not null default 1440`,
  `alter table automations add column if not exists followup_include_link boolean not null default false`,
  // O acompanhamento virou etapa independente: link e botão próprios, em vez
  // de repetir os do passo do link. URL vazia = mensagem só de texto.
  `alter table automations add column if not exists followup_url text not null default ''`,
  `alter table automations add column if not exists followup_button_label text not null default ''`,
  // Anexo (imagem, áudio ou vídeo) por etapa da automação. Guardamos o
  // endereço, não o arquivo: é a URL que a Meta busca na hora do envio.
  // O passo do link e o acompanhamento moram em `followups`, por isso a mídia
  // deles fica lá — a automação só guarda a da mensagem de boas-vindas.
  // Acompanhamento com chave própria, como o passo do link já tinha. Antes a
  // etapa era ligada só por "tem texto?", então desligá-la exigia apagar o
  // texto — e quem apagava perdia o que tinha escrito.
  //
  // O backfill roda UMA vez, junto da criação da coluna: quem já tinha
  // acompanhamento escrito continua com ele ligado. Sem essa guarda, toda vez
  // que o schema mudasse a coluna voltaria a ser marcada, reativando o
  // acompanhamento de quem tinha desligado de propósito.
  `do $$
   begin
     if not exists (
       select 1 from information_schema.columns
       where table_name = 'automations' and column_name = 'send_followup'
     ) then
       alter table automations add column send_followup boolean not null default false;
       update automations set send_followup = true where followup_text <> '';
     end if;
   end $$`,
  `alter table automations add column if not exists welcome_media_type text`,
  `alter table automations add column if not exists welcome_media_url text`,
  `alter table automations add column if not exists link_media_type text`,
  `alter table automations add column if not exists link_media_url text`,
  `alter table automations add column if not exists followup_media_type text`,
  `alter table automations add column if not exists followup_media_url text`,
  `alter table followups add column if not exists media_type text`,
  `alter table followups add column if not exists media_url text`,
  `alter table contacts add column if not exists email text`,
  // o que estamos esperando dessa pessoa na próxima mensagem ('follow' | 'email')
  `alter table contacts add column if not exists awaiting text`,
  // quantas vezes já pedimos que ela siga (evita virar spam)
  `alter table contacts add column if not exists follow_attempts int not null default 0`,
  // etiquetas postas pelo bloco "Etiquetar" dos fluxos
  `alter table contacts add column if not exists tags text[] not null default '{}'`,
  // ---------- Fluxos (automação em forma de mapa) ----------
  // O desenho vive em nodes/edges como jsonb: o editor sempre lê e grava o
  // documento inteiro, e nada no sistema consulta um bloco isolado.
  `create table if not exists flows (
    id uuid primary key default gen_random_uuid(),
    account_id text not null,
    name text not null,
    active boolean not null default true,
    trigger text not null default 'comment' check (trigger in ('comment','story','dm')),
    keywords text[] not null default '{}',
    match_type text not null default 'contains' check (match_type in ('contains','exact','any')),
    media_id text,
    media_thumbnail_url text,
    media_caption text,
    media_permalink text,
    story_id text,
    story_thumbnail_url text,
    public_replies text[] not null default '{}',
    nodes jsonb not null default '[]',
    edges jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists flows_account_idx on flows(account_id, active)`,
  // Em que ponto do fluxo cada pessoa está. A chave é (conta, contato): a
  // conversa no privado é uma só, então um fluxo novo assume o lugar do antigo.
  `create table if not exists flow_runs (
    account_id text not null,
    contact_ig_id text not null,
    flow_id uuid not null references flows(id) on delete cascade,
    node_id text,
    awaiting text,
    updated_at timestamptz not null default now(),
    primary key (account_id, contact_ig_id)
  )`,
  `create index if not exists automations_account_idx on automations(account_id)`,
  `create index if not exists queue_account_idx on queue(account_id, status)`,
  `create index if not exists events_account_idx on events(account_id, created_at desc)`,
];

// Migração de instalação single-conta → multi-conta. Idempotente: roda sem
// efeito quando já aplicada.
//
// Tudo aqui é SQL puro, sem decisão em JavaScript no meio: é o que permite
// mandar as migrações e o DDL num lote só. Cada ida ao banco custa uma
// requisição HTTP (o driver do Neon fala por HTTP), e eram 54 delas em fila
// antes de a primeira página aparecer.
const MIGRACOES = [
  // 1) Semeia a conta legada (que morava em config) na tabela accounts
  `insert into accounts (ig_user_id, username, name, profile_picture_url,
                         access_token, token_expires_at, connected_at)
   select ig_user_id, username, name, profile_picture_url,
          access_token, token_expires_at, connected_at
   from config
   where id = 1 and ig_user_id is not null and access_token is not null
   on conflict (ig_user_id) do nothing`,

  // 2) Enquanto houver exatamente UMA conta, os registros órfãos (account_id
  //    nulo) são todos dela — atribui. Com 2+ contas o backfill já aconteceu.
  //    A condição mora dentro do próprio comando: assim são quatro updates
  //    numa ida só, em vez de um select seguido de quatro round trips.
  `do $$
   declare alvo text;
   begin
     if (select count(*) from accounts) = 1 then
       select ig_user_id into alvo from accounts;
       update automations set account_id = alvo where account_id is null;
       update queue       set account_id = alvo where account_id is null;
       update events      set account_id = alvo where account_id is null;
       update contacts    set account_id = alvo where account_id is null;
     end if;
   end $$`,

  // 2b) A fila ganhou tipos novos (follow, e-mail, reação, acompanhamento). A
  //     restrição antiga barraria esses valores, então é recriada.
  `
    do $$
    begin
      if exists (
        select 1 from pg_constraint
        where conrelid = 'queue'::regclass and conname = 'queue_kind_check'
      ) then
        alter table queue drop constraint queue_kind_check;
      end if;
      alter table queue add constraint queue_kind_check check (kind in (
        'private_reply','comment_reply','dm_welcome','dm_link','dm_reminder',
        'dm_followup','dm_follow_gate','dm_email_ask','story_reaction',
        'dm_broadcast','flow_message','flow_resume'
      ));
    exception when duplicate_object then null;
    end $$`,

  // 2c) Mesma coisa para followups: o passo 'followup' (acompanhamento
  //     incondicional) não existia quando a tabela foi criada.
  `
    do $$
    begin
      if exists (
        select 1 from pg_constraint
        where conrelid = 'followups'::regclass and conname = 'followups_kind_check'
      ) then
        alter table followups drop constraint followups_kind_check;
      end if;
      alter table followups add constraint followups_kind_check check (kind in (
        'link','reminder','followup'
      ));
    exception when duplicate_object then null;
    end $$`,

  // 2d) "Lembrar quem não clicou" foi unificado na mensagem de acompanhamento.
  //     Os dois disparavam por tempo, para todo mundo (a API não informa
  //     cliques), então eram a mesma etapa com dois nomes. O que já estava
  //     configurado no lembrete vira o acompanhamento, preservando o link
  //     quando ele repetia o botão do passo anterior.
  //     Idempotente: zera reminder_text no mesmo update, então o where nunca
  //     casa de novo — e desligar o acompanhamento depois não ressuscita nada.
  `update automations
       set followup_text = reminder_text,
           followup_delay_minutes = reminder_delay_minutes,
           followup_url = case
             when reminder_include_link and send_link then link_url else '' end,
           followup_button_label = case
             when reminder_include_link and send_link then link_button_label else '' end,
           reminder_text = ''
     where reminder_text <> '' and followup_text = ''`,

  // 3) Promove a PK de contacts para (account_id, ig_id) — a mesma pessoa pode
  //    falar com duas contas conectadas. Cada passo tem sua própria guarda,
  //    então rodar de novo (ou parar no meio) nunca quebra.
  `
    do $$
    begin
      -- derruba a PK antiga (só ig_id), agora que cada linha sabe a conta
      if exists (
           select 1 from pg_constraint
           where conrelid = 'contacts'::regclass and contype = 'p'
             and array_length(conkey, 1) = 1
         )
         and not exists (select 1 from contacts where account_id is null) then
        alter table contacts drop constraint contacts_pkey;
      end if;

      -- instala a PK composta quando a tabela está sem PK e sem nulos
      if not exists (
           select 1 from pg_constraint
           where conrelid = 'contacts'::regclass and contype = 'p'
         )
         and not exists (select 1 from contacts where account_id is null) then
        alter table contacts add primary key (account_id, ig_id);
      end if;
    end $$`,
];

// Tudo que constrói o schema, na ordem: tabelas, colunas que chegaram depois e
// migrações.
const ESQUEMA = [
  ...DDL,
  // migração p/ instalações antigas: colunas do app principal (Básico)
  `alter table config add column if not exists meta_app_id text`,
  `alter table config add column if not exists meta_app_secret text`,
  ...MIGRACOES,
];

// Impressão digital do schema. Sai do próprio conteúdo, e não de um número que
// alguém precisa lembrar de aumentar: mudou qualquer comando acima, a versão
// muda sozinha e as migrações rodam de novo no próximo acesso.
const VERSAO_ESQUEMA = createHash("sha1").update(ESQUEMA.join(";")).digest("hex").slice(0, 16);

let schemaReady: Promise<void> | null = null;

// ============================================================
// Prepara o banco — no máximo uma vez por instância e, no caso comum, numa
// única ida ao banco.
//
// O driver do Neon fala HTTP: cada comando é uma requisição, e na Vercel isso
// dá uns 50 ms. Rodar os ~50 comandos do schema em fila a cada instância nova
// custava vários segundos ANTES de a primeira página aparecer — era esta a
// lentidão ao abrir um fluxo e ao voltar para a lista.
//
// Agora: uma requisição confere a impressão digital; se bate (o caso normal,
// sempre que o schema não mudou), acabou. Só quando não bate é que o lote de
// comandos é enviado — de uma vez, numa transação só.
// ============================================================
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const s = sql();
      const [, atual] = (await s.transaction([
        s.query(
          `create table if not exists schema_state (
             version text primary key,
             updated_at timestamptz not null default now()
           )`
        ),
        s.query(`select version from schema_state limit 1`),
      ])) as [unknown, { version: string }[]];

      if (atual?.[0]?.version === VERSAO_ESQUEMA) return;

      await s.transaction([
        ...ESQUEMA.map((cmd) => s.query(cmd)),
        // garante a linha única de config com um verify token já gerado
        s.query(
          `insert into config (id, webhook_verify_token) values (1, $1)
           on conflict (id) do nothing`,
          [randomBytes(16).toString("hex")]
        ),
        // uma linha só: a versão nova substitui a anterior
        s.query(`delete from schema_state`),
        s.query(`insert into schema_state (version) values ($1)`, [VERSAO_ESQUEMA]),
      ]);
    })().catch((err) => {
      schemaReady = null; // deixa a próxima requisição tentar de novo
      throw err;
    });
  }
  return schemaReady;
}

// ---------- Config ----------

export async function getConfig(): Promise<Config> {
  await ensureSchema();
  const rows = (await sql()`select * from config where id = 1`) as Config[];
  return rows[0];
}

const CONFIG_COLUMNS = new Set([
  "ig_user_id",
  "username",
  "name",
  "profile_picture_url",
  "access_token",
  "token_expires_at",
  "connected_at",
  "instagram_app_id",
  "instagram_app_secret",
  "meta_app_id",
  "meta_app_secret",
  "webhook_verify_token",
  "app_url",
]);

export async function updateConfig(fields: Partial<Config>): Promise<void> {
  await ensureSchema();
  const entries = Object.entries(fields).filter(([k]) => CONFIG_COLUMNS.has(k));
  if (!entries.length) return;
  const sets = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ");
  await sql().query(
    `update config set ${sets}, updated_at = now() where id = 1`,
    entries.map(([, v]) => v)
  );
}

export function isMetaConfigured(c: Config): boolean {
  return Boolean(c.instagram_app_id && c.instagram_app_secret);
}

// ---------- Contas ----------

export async function listAccounts(): Promise<Account[]> {
  await ensureSchema();
  return (await sql()`select * from accounts order by created_at asc`) as Account[];
}

export async function getAccount(igUserId: string): Promise<Account | undefined> {
  await ensureSchema();
  const rows = (await sql().query(`select * from accounts where ig_user_id = $1`, [
    igUserId,
  ])) as Account[];
  return rows[0];
}

export async function upsertAccount(a: {
  ig_user_id: string;
  platform?: Platform;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  access_token: string;
  token_expires_at: Date | null;
}): Promise<void> {
  await ensureSchema();
  await sql().query(
    `insert into accounts (ig_user_id, platform, username, name, profile_picture_url,
                           access_token, token_expires_at, connected_at)
     values ($1, $7, $2, $3, $4, $5, $6, now())
     on conflict (ig_user_id) do update set
       platform = excluded.platform,
       username = excluded.username,
       name = excluded.name,
       profile_picture_url = excluded.profile_picture_url,
       access_token = excluded.access_token,
       token_expires_at = excluded.token_expires_at`,
    [
      a.ig_user_id,
      a.username,
      a.name,
      a.profile_picture_url,
      a.access_token,
      a.token_expires_at?.toISOString() ?? null,
      a.platform ?? "instagram",
    ]
  );
}

// Guarda o endereço novo da foto de perfil. As URLs da Meta são assinadas e
// vencem; quando alguma tela pede a foto ao vivo, o valor bom volta para cá e
// as próximas telas já pegam direto do banco.
export async function salvarFotoDaConta(igUserId: string, url: string): Promise<void> {
  await sql().query(`update accounts set profile_picture_url = $2 where ig_user_id = $1`, [
    igUserId,
    url,
  ]);
}

export async function updateAccountToken(
  igUserId: string,
  accessToken: string,
  tokenExpiresAt: Date
): Promise<void> {
  await sql().query(
    `update accounts set access_token = $2, token_expires_at = $3 where ig_user_id = $1`,
    [igUserId, accessToken, tokenExpiresAt.toISOString()]
  );
}

// Desconecta uma conta e apaga tudo que era dela (automações em cascata levam
// followups; contatos, fila e eventos são removidos explicitamente).
export async function deleteAccount(igUserId: string): Promise<void> {
  await ensureSchema();
  for (const t of ["queue", "events", "contacts", "automations", "flow_runs", "flows"]) {
    await sql().query(`delete from ${t} where account_id = $1`, [igUserId]);
  }
  await sql().query(`delete from accounts where ig_user_id = $1`, [igUserId]);
}
