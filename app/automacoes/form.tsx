"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Automation } from "@/lib/db";
import { saveAutomation } from "./actions";
import MessageField from "./variable-picker";
import MediaField from "../media-field";
import type { MediaKind } from "@/lib/media";
import MediaPicker, { type Picked, type Platform } from "../media-picker";
import Thumb from "../thumb";
import Avatar from "../avatar";
import {
  card,
  input,
  label,
  hint,
  btnPrimary,
  btnSecondary,
  alertError,
  muted,
  sectionTitle,
  badgeAccent,
  badgeNeutral,
} from "../ui";
import {
  IconComment,
  IconStory,
  IconSend,
  IconCamera,
  IconImage,
  IconMic,
  IconSmile,
  IconPhone,
  IconVideo,
  IconChevronLeft,
  IconWifi,
  IconClock,
  IconTap,
} from "../icons";

type TriggerKind = "comment" | "story" | "dm";

// As etapas do formulário têm um nome próprio porque a PRÉVIA precisa saber
// qual delas você está mexendo: é isso que liga o campo à bolha correspondente
// no celular, em vez de deixar a prévia como um enfeite ao lado.
type EtapaId =
  | "identificacao"
  | "gatilho"
  | "resposta-publica"
  | "boas-vindas"
  | "condicoes"
  | "link"
  | "acompanhamento";
export type { Platform };

export type Account = {
  username: string | null;
  avatar: string | null;
  // Id da conta conectada: com ele a prévia consegue pedir a foto nova quando
  // o endereço guardado vence (as URLs da Meta são assinadas e expiram).
  id?: string | null;
  platform: Platform;
};

const inputCls = input;
const labelCls = label;
const hintCls = hint;

type TriggerOption = {
  value: TriggerKind;
  icon: (props: { className?: string }) => React.ReactNode;
  title: string;
  desc: string;
};

// Os gatilhos não são os mesmos nos dois lugares: a página do Facebook não
// entrega resposta a story pela API, então oferecer a opção só produziria
// automação que nunca dispara.
const TRIGGER_OPTIONS: Record<Platform, TriggerOption[]> = {
  instagram: [
    {
      value: "comment",
      icon: IconComment,
      title: "Comentário em post/reels",
      desc: "Alguém comenta a palavra-chave e recebe sua DM.",
    },
    {
      value: "story",
      icon: IconStory,
      title: "Resposta a story",
      desc: "Alguém responde seu story com a palavra-chave.",
    },
    {
      value: "dm",
      icon: IconSend,
      title: "DM recebida",
      desc: "Alguém manda a palavra-chave direto na sua DM.",
    },
  ],
  facebook: [
    {
      value: "comment",
      icon: IconComment,
      title: "Comentário em post da página",
      desc: "Alguém comenta a palavra-chave e recebe sua mensagem.",
    },
    {
      value: "dm",
      icon: IconSend,
      title: "Mensagem no Messenger",
      desc: "Alguém manda a palavra-chave no Messenger da página.",
    },
  ],
};

const KEYWORD_HINT: Record<TriggerKind, string> = {
  comment: "O que a pessoa precisa comentar no post.",
  story: "O que a pessoa precisa responder no seu story.",
  dm: "O que a pessoa precisa mandar na sua mensagem.",
};

// Cada etapa é um "nó" do fluxo: bolinha numerada + trilho conectando ao nó
// seguinte, para a automação ser lida de cima para baixo como uma sequência —
// e não como um formulário longo de campos soltos.
function Section({
  id,
  step,
  title,
  subtitle,
  kind = "acao",
  opcional,
  aoFocar,
  ativa,
  children,
}: {
  id: EtapaId;
  step: number;
  title: string;
  subtitle?: string;
  kind?: "gatilho" | "acao";
  opcional?: boolean;
  aoFocar: (id: EtapaId) => void;
  ativa: boolean;
  children: React.ReactNode;
}) {
  const isGatilho = kind === "gatilho";
  return (
    <section
      id={`etapa-${id}`}
      // focusin sobe até aqui, então basta um ouvinte por etapa para saber
      // onde a pessoa está — sem instrumentar campo por campo
      onFocusCapture={() => aoFocar(id)}
      onPointerDown={() => aoFocar(id)}
      className="relative scroll-mt-6 pl-10 sm:pl-12"
    >
      {/* trilho vertical do fluxo */}
      <span
        aria-hidden
        className="absolute left-[15px] top-10 bottom-[-20px] w-px bg-zinc-200 dark:bg-zinc-800"
      />
      <span
        aria-hidden
        className={`absolute left-0 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
          isGatilho
            ? "bg-indigo-500 text-white shadow-[0_0_0_4px_rgba(99,102,241,0.12)]"
            : ativa
              ? "border border-indigo-400 bg-indigo-500 text-white"
              : "border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
      >
        {step}
      </span>

      <div
        className={`${card} p-5 transition-shadow ${
          ativa ? "border-indigo-300 shadow-md dark:border-indigo-800" : ""
        }`}
      >
        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={isGatilho ? badgeAccent : badgeNeutral}>
              {isGatilho ? "Gatilho" : "Ação"}
            </span>
            {opcional && <span className={badgeNeutral}>opcional</span>}
          </div>
          <h2 className={`${sectionTitle} mt-2 text-[15px]`}>{title}</h2>
          {subtitle && <p className={`mt-1 text-xs ${muted}`}>{subtitle}</p>}
        </header>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}

// ---------- Pré-visualização em celular (inspirada no ManyChat) ----------

// A prévia mostra a foto da conta em todo balão. Era uma cópia do Avatar sem
// a queda para a inicial — e sem o pedido da foto nova. Agora usa o mesmo
// componente, que já sabe a escada inteira: guardado → ao vivo → inicial.
function MiniAvatar({ account, size = "h-5 w-5" }: { account: Account | null; size?: string }) {
  return (
    <Avatar
      src={account?.avatar ?? null}
      accountId={account?.id ?? null}
      name={account?.username ?? "S"}
      className={`${size} border-0`}
      textClassName="text-[9px]"
    />
  );
}

// Miniatura do story na prévia. Mesmo motivo do MiniAvatar: o endereço da
// imagem vem assinado pela Meta e vence.
function FotoDoStory({ src }: { src: string | null }) {
  const [quebrou, setQuebrou] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) setQuebrou(true);
  }, []);
  if (src && !quebrou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={src}
        alt=""
        onError={() => setQuebrou(true)}
        className="block h-20 w-12 rounded-[10px] object-cover"
      />
    );
  }
  return (
    <span className="flex h-20 w-12 items-center justify-center rounded-[10px] bg-zinc-900 text-zinc-500">
      <IconCamera className="h-4 w-4" />
    </span>
  );
}

function Incoming({
  account,
  dim,
  children,
}: {
  account: Account | null;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex max-w-[85%] items-end gap-1.5 self-start ${dim ? "opacity-50" : ""}`}>
      <MiniAvatar account={account} />
      <div className="min-w-0 overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800 text-[11px] leading-snug text-zinc-100">
        {children}
      </div>
    </div>
  );
}

function Outgoing({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-[#3797f0] px-3 py-1.5 text-[11px] leading-snug text-white">
      {children}
    </div>
  );
}

function ChatCaption({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="my-0.5 flex items-center gap-1 self-center text-[9px] text-zinc-600">
      {icon}
      {children}
    </p>
  );
}

// Envolve um trecho da conversa e o liga a uma etapa do formulário. O que não
// está sendo editado desbota; o que está ganha um anel. É o que transforma a
// prévia de enfeite em resposta: você mexe no campo e vê QUAL mensagem muda.
// Etapas que têm uma mensagem correspondente na conversa. Nas outras
// (identificação, resposta pública) não há o que acender — e aí a prévia fica
// inteira acesa, em vez de apagar tudo sem motivo.
const ETAPAS_DA_CONVERSA: EtapaId[] = [
  "gatilho",
  "boas-vindas",
  "condicoes",
  "link",
  "acompanhamento",
];

function Destacavel({
  etapa,
  ativa,
  children,
}: {
  etapa: EtapaId;
  ativa: EtapaId;
  children: React.ReactNode;
}) {
  const aceso = ativa === etapa;
  const atenuar = !aceso && ETAPAS_DA_CONVERSA.includes(ativa);
  return (
    <div
      data-etapa={etapa}
      className={`flex flex-col gap-1.5 rounded-xl px-1.5 py-1.5 transition-all duration-200 ${
        aceso ? "bg-[#3797f0]/10 ring-1 ring-[#3797f0]/50" : atenuar ? "opacity-50" : ""
      }`}
    >
      {children}
    </div>
  );
}

// Índice das etapas: fica fixo à esquerda e mostra a automação inteira de uma
// vez. O formulário tem mais de 2500px de altura, e a régua numerada que
// existia era só um fio — dava para rolar bastante sem saber em que ponto da
// sequência você estava, nem quanto faltava.
function IndiceDasEtapas({
  etapas,
  ativa,
}: {
  etapas: { id: EtapaId; numero: number; titulo: string; preenchida: boolean; opcional?: boolean }[];
  ativa: EtapaId;
}) {
  return (
    <nav aria-label="Etapas da automação" className="sticky top-6 hidden xl:block">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        A automação
      </p>
      <ol className="space-y-0.5">
        {etapas.map((e) => {
          const acesa = ativa === e.id;
          return (
            <li key={e.id}>
              <a
                href={`#etapa-${e.id}`}
                className={`group flex items-center gap-2.5 rounded-lg py-1.5 pl-1 pr-2 text-xs transition-colors ${
                  acesa
                    ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                    acesa
                      ? "bg-indigo-500 text-white"
                      : e.preenchida
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "border border-zinc-300 text-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  {e.preenchida && !acesa ? "✓" : e.numero}
                </span>
                <span className="truncate">{e.titulo}</span>
                {e.opcional && (
                  <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-zinc-400">
                    opc.
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Placeholder({ text }: { text: string }) {
  return <span className="italic text-zinc-500">{text}</span>;
}

function PhonePreview(props: {
  account: Account | null;
  trigger: TriggerKind;
  post: Picked | null;
  story: Picked | null;
  keyword: string;
  publicReply: string | undefined;
  welcomeText: string;
  quickReplyLabel: string;
  linkText: string;
  linkButtonLabel: string;
  linkUrl: string;
  followupText: string;
  followupDelay: number;
  followupUrl: string;
  followupButtonLabel: string;
  requireFollow: boolean;
  followText: string;
  followButtonLabel: string;
  askEmail: boolean;
  emailText: string;
  storyReaction: string;
  etapaAtiva: EtapaId;
}) {
  const { account, trigger, post, story } = props;
  const facebook = account?.platform === "facebook";
  const username = account?.username ?? (facebook ? "Sua página" : "sua_conta");
  const arroba = facebook ? "" : "@";

  return (
    <div>
      {/* Cena do comentário: acontece no post, fora da DM */}
      {trigger === "comment" && (
        <div
          className={`mx-auto mb-3 w-[300px] p-3 transition-all duration-200 ${card} ${
            props.etapaAtiva === "gatilho" || props.etapaAtiva === "resposta-publica"
              ? "border-indigo-300 shadow-md dark:border-indigo-700"
              : ETAPAS_DA_CONVERSA.includes(props.etapaAtiva)
                ? "opacity-50"
                : ""
          }`}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {facebook ? "No post da página" : "No post"}
          </p>
          <div className="flex gap-2.5">
            <Thumb src={post?.thumb ?? null} mediaId={post?.id ?? null} className="h-12 w-12" />
            <div className="min-w-0 text-[11px] leading-snug text-zinc-700 dark:text-zinc-300">
              <p>
                <span className="font-semibold">{facebook ? "Ana Souza" : "@visitante"}</span>{" "}
                {props.keyword}
              </p>
              {props.publicReply && (
                <p className="mt-1 border-l border-zinc-300 pl-2 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {arroba}
                    {username}
                  </span>{" "}
                  {props.publicReply}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Celular com a DM */}
      <div className="mx-auto w-[300px] overflow-hidden rounded-[2.4rem] border-[5px] border-zinc-800 bg-black shadow-2xl">
        {/* Barra de status */}
        <div className="relative flex items-center justify-between px-5 pb-1 pt-2 text-[9px] font-semibold text-zinc-200">
          <span>9:41</span>
          <span className="absolute left-1/2 top-1.5 h-4 w-16 -translate-x-1/2 rounded-full bg-zinc-900" />
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-[2px]">
              <span className="h-1 w-[2.5px] rounded-sm bg-zinc-200" />
              <span className="h-1.5 w-[2.5px] rounded-sm bg-zinc-200" />
              <span className="h-2 w-[2.5px] rounded-sm bg-zinc-200" />
              <span className="h-2.5 w-[2.5px] rounded-sm bg-zinc-500" />
            </span>
            <IconWifi className="h-3 w-3" />
            <span className="flex h-2.5 w-[18px] items-center rounded-[3px] border border-zinc-500 p-[1.5px]">
              <span className="h-full w-3/4 rounded-[1px] bg-zinc-200" />
            </span>
          </span>
        </div>

        {/* Cabeçalho da DM */}
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
          <IconChevronLeft className="h-4 w-4 text-zinc-300" />
          <span
            className={`rounded-full p-[2px] ${
              facebook
                ? "bg-gradient-to-tr from-sky-500 to-indigo-500"
                : "bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600"
            }`}
          >
            <span className="block rounded-full bg-black p-[2px]">
              <MiniAvatar account={account} size="h-6 w-6" />
            </span>
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-semibold text-zinc-100">{username}</p>
            <p className="text-[9px] text-zinc-500">{facebook ? "Messenger" : "Instagram"}</p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-zinc-300">
            <IconPhone className="h-4 w-4" />
            <IconVideo className="h-4 w-4" />
          </div>
        </div>

        {/* Conversa */}
        <div className="flex min-h-[340px] flex-col gap-1.5 px-3 py-3">
          <ChatCaption>Hoje</ChatCaption>

          {trigger === "story" && (
            <Destacavel etapa="gatilho" ativa={props.etapaAtiva}>
            <div className="flex flex-col items-end gap-1 self-end">
              <p className="text-[9px] text-zinc-500">Respondeu ao seu story</p>
              {props.storyReaction && (
                <span className="order-last -mt-1 mr-1 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px]">
                  {props.storyReaction}
                </span>
              )}
              <span className="rounded-xl bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
                <FotoDoStory src={story?.thumb ?? null} />
              </span>
              <Outgoing>{props.keyword}</Outgoing>
            </div>
            </Destacavel>
          )}
          {trigger === "dm" && (
            <Destacavel etapa="gatilho" ativa={props.etapaAtiva}>
              <Outgoing>{props.keyword}</Outgoing>
            </Destacavel>
          )}

          <Destacavel etapa="boas-vindas" ativa={props.etapaAtiva}>
          <Incoming account={account}>
            <p className="whitespace-pre-wrap px-3 py-1.5">
              {props.welcomeText || <Placeholder text="Sua DM de boas-vindas…" />}
            </p>
          </Incoming>

          {props.quickReplyLabel && (
            <>
              <span className="mt-0.5 self-center rounded-full border border-[#3797f0]/60 bg-[#3797f0]/10 px-3 py-1 text-[10px] font-medium text-[#3797f0]">
                {props.quickReplyLabel}
              </span>
              <ChatCaption icon={<IconTap className="h-2.5 w-2.5" />}>
                quando a pessoa toca no botão
              </ChatCaption>
              <Outgoing>{props.quickReplyLabel}</Outgoing>
            </>
          )}
          </Destacavel>

          {(props.requireFollow || props.askEmail) && (
            <Destacavel etapa="condicoes" ativa={props.etapaAtiva}>
          {props.requireFollow && (
            <>
              <ChatCaption>quem ainda não segue vê isto</ChatCaption>
              <Incoming account={account}>
                <p className="whitespace-pre-wrap px-3 py-1.5">
                  {props.followText || (
                    <Placeholder text="Antes de te mandar o link, me segue lá 🙏" />
                  )}
                </p>
              </Incoming>
              <span className="mt-0.5 self-center rounded-full border border-[#3797f0]/60 bg-[#3797f0]/10 px-3 py-1 text-[10px] font-medium text-[#3797f0]">
                {props.followButtonLabel || "Já sigo! ✅"}
              </span>
            </>
          )}

          {props.askEmail && (
            <>
              <Incoming account={account}>
                <p className="whitespace-pre-wrap px-3 py-1.5">
                  {props.emailText || <Placeholder text="Me manda seu melhor e-mail 👇" />}
                </p>
              </Incoming>
              <Outgoing>ana@email.com</Outgoing>
            </>
          )}
            </Destacavel>
          )}

          <Destacavel etapa="link" ativa={props.etapaAtiva}>
          <Incoming account={account}>
            <p className="whitespace-pre-wrap px-3 py-1.5">
              {props.linkText || <Placeholder text="Sua mensagem com o link…" />}
            </p>
            {props.linkUrl && (
              <p className="border-t border-zinc-700 px-3 py-1.5 text-center font-semibold text-[#3797f0]">
                {props.linkButtonLabel || "Abrir link"}
              </p>
            )}
          </Incoming>
          </Destacavel>

          {props.followupText && (
            <Destacavel etapa="acompanhamento" ativa={props.etapaAtiva}>
              <ChatCaption icon={<IconClock className="h-2.5 w-2.5" />}>
                {props.followupDelay} min depois, para todos
              </ChatCaption>
              <Incoming account={account}>
                <p className="whitespace-pre-wrap px-3 py-1.5">{props.followupText}</p>
                {props.followupUrl && (
                  <p className="border-t border-zinc-700 px-3 py-1.5 text-center font-semibold text-[#3797f0]">
                    {props.followupButtonLabel || "Abrir link"}
                  </p>
                )}
              </Incoming>
            </Destacavel>
          )}
        </div>

        {/* Barra de mensagem */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#3797f0] text-white">
            <IconCamera className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 rounded-full border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
            Mensagem…
          </span>
          <span className="flex items-center gap-2.5 text-zinc-400">
            <IconMic className="h-4 w-4" />
            <IconImage className="h-4 w-4" />
            <IconSmile className="h-4 w-4" />
          </span>
        </div>
        <div className="pb-1.5">
          <div className="mx-auto h-1 w-24 rounded-full bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}

// ---------- Formulário ----------

export default function AutomationForm({
  automation,
  account,
}: {
  automation: Automation | null;
  account: Account | null;
}) {
  const a = automation;
  // Sem conta conectada ainda, o formulário assume Instagram — é o caminho
  // padrão do app e nada aqui depende de token para renderizar.
  const platform: Platform = account?.platform ?? "instagram";
  const facebook = platform === "facebook";
  const triggerOptions = TRIGGER_OPTIONS[platform];

  // Gatilho único (automações antigas com vários gatilhos assumem o primeiro)
  const salvo: TriggerKind = a
    ? a.triggers.includes("comment")
      ? "comment"
      : a.triggers.includes("story")
        ? "story"
        : "dm"
    : "comment";
  // gatilho que não existe nesta plataforma (story numa página) cai no primeiro
  const initialTrigger: TriggerKind = triggerOptions.some((o) => o.value === salvo)
    ? salvo
    : triggerOptions[0].value;

  // Controlado (era defaultValue) para o índice lateral saber se a etapa 1 já
  // está resolvida — sem isso ela nunca marcava como preenchida.
  const [nome, setNome] = useState(a?.name ?? "");
  const [trigger, setTrigger] = useState<TriggerKind>(initialTrigger);
  const [keywords, setKeywords] = useState(a?.keywords.join(", ") ?? "");
  const [matchType, setMatchType] = useState(a?.match_type ?? "contains");
  const [publicReplies, setPublicReplies] = useState(a?.public_replies.join("\n") ?? "");
  const [welcomeText, setWelcomeText] = useState(a?.welcome_text ?? "");
  // Anexo por etapa. A Meta busca a URL na hora do envio, então o que se guarda
  // é sempre um endereço.
  const [welcomeMedia, setWelcomeMedia] = useState<{ kind: MediaKind | null; url: string }>({
    kind: (a?.welcome_media_type as MediaKind) ?? null,
    url: a?.welcome_media_url ?? "",
  });
  const [linkMedia, setLinkMedia] = useState<{ kind: MediaKind | null; url: string }>({
    kind: (a?.link_media_type as MediaKind) ?? null,
    url: a?.link_media_url ?? "",
  });
  const [followupMedia, setFollowupMedia] = useState<{ kind: MediaKind | null; url: string }>({
    kind: (a?.followup_media_type as MediaKind) ?? null,
    url: a?.followup_media_url ?? "",
  });
  const [quickReplyLabel, setQuickReplyLabel] = useState(a?.quick_reply_label ?? "Quero o link! 🔗");
  const [linkText, setLinkText] = useState(a?.link_text ?? "");
  const [linkButtonLabel, setLinkButtonLabel] = useState(a?.link_button_label ?? "Abrir link");
  const [linkUrl, setLinkUrl] = useState(a?.link_url ?? "");
  // Enviar o link é opcional; automações antigas seguem enviando (default true).
  const [sendLink, setSendLink] = useState(a?.send_link ?? true);
  // Automação já existente sem a coluna ainda: se tem texto de acompanhamento,
  // é porque estava ligada — o backfill do banco faz o mesmo raciocínio.
  const [sendFollowup, setSendFollowup] = useState(
    a?.send_followup ?? Boolean(a?.followup_text)
  );
  const [followupText, setFollowupText] = useState(a?.followup_text ?? "");
  // 1200 min = 20h. O padrão TEM que caber no teto: quando o limite caiu de 24h
  // para 20h (para a mensagem ainda pegar a janela da Meta), este padrão ficou
  // em 1440 e toda automação nova nascia com um valor que o próprio navegador
  // recusava — travando o salvamento numa etapa que é opcional.
  const [followupDelay, setFollowupDelay] = useState(String(a?.followup_delay_minutes ?? 1200));
  const [followupUrl, setFollowupUrl] = useState(a?.followup_url ?? "");
  const [followupButtonLabel, setFollowupButtonLabel] = useState(
    a?.followup_button_label ?? ""
  );
  const [formError, setFormError] = useState("");

  // Etapas opcionais entre o botão e o link
  const [requireFollow, setRequireFollow] = useState(a?.require_follow ?? false);
  const [followText, setFollowText] = useState(a?.follow_text ?? "");
  const [followButtonLabel, setFollowButtonLabel] = useState(
    a?.follow_button_label ?? "Já sigo! ✅"
  );
  const [askEmail, setAskEmail] = useState(a?.ask_email ?? false);
  const [emailText, setEmailText] = useState(a?.email_text ?? "");
  const [storyReaction, setStoryReaction] = useState(a?.story_reaction ?? "");

  const [post, setPost] = useState<Picked | null>(
    a?.media_id
      ? {
          id: a.media_id,
          thumb: a.media_thumbnail_url ?? "",
          caption: a.media_caption ?? "",
          permalink: a.media_permalink ?? "",
        }
      : null
  );
  const [story, setStory] = useState<Picked | null>(
    a?.story_id
      ? { id: a.story_id, thumb: a.story_thumbnail_url ?? "", caption: "", permalink: "" }
      : null
  );

  function pickTrigger(t: TriggerKind) {
    setTrigger(t);
    // troca de gatilho leva junto o que só existia por causa dele
    if (t !== "comment") setPost(null);
    if (t !== "story") setStory(null);
  }

  function validate(e: React.FormEvent<HTMLFormElement>) {
    if (matchType !== "any" && !keywords.trim()) {
      e.preventDefault();
      setFormError("Informe as palavras-chave (ou mude para “Qualquer texto”).");
      return;
    }
    setFormError("");
  }

  const previewKeyword =
    matchType === "any"
      ? trigger === "comment"
        ? "adorei esse post!"
        : "oi!"
      : keywords.split(",")[0]?.trim() || "palavra-chave";
  const isComment = trigger === "comment";
  // Qual etapa está sendo editada agora. Alimenta o destaque na prévia e o
  // índice lateral — a prévia deixa de ser um enfeite e passa a mostrar
  // exatamente a mensagem que você tem sob os dedos.
  const [etapaAtiva, setEtapaAtiva] = useState<EtapaId>("identificacao");

  // "Preenchida" é o sinal do índice: o que já tem conteúdo de verdade, não o
  // que foi só visitado. Etapa opcional desligada conta como resolvida.
  const etapas: {
    id: EtapaId;
    numero: number;
    titulo: string;
    preenchida: boolean;
    opcional?: boolean;
  }[] = [
    { id: "identificacao", numero: 1, titulo: "Identificação", preenchida: Boolean(nome.trim()) },
    {
      id: "gatilho",
      numero: 2,
      titulo: "Quando alguém…",
      preenchida: matchType === "any" || Boolean(keywords.trim()),
    },
    ...(isComment
      ? ([
          {
            id: "resposta-publica" as const,
            numero: 3,
            titulo: "Responder no comentário",
            preenchida: Boolean(publicReplies.trim()),
            opcional: true,
          },
        ] as const)
      : []),
    {
      id: "boas-vindas",
      numero: isComment ? 4 : 3,
      titulo: facebook ? "Mensagem de boas-vindas" : "DM de boas-vindas",
      preenchida: Boolean(welcomeText.trim()),
    },
    {
      id: "condicoes",
      numero: isComment ? 5 : 4,
      titulo: "Condições",
      preenchida: requireFollow || askEmail,
      opcional: true,
    },
    {
      id: "link",
      numero: isComment ? 6 : 5,
      titulo: "Mensagem final",
      preenchida: Boolean(linkText.trim()) || Boolean(linkUrl.trim()),
    },
    {
      id: "acompanhamento",
      numero: isComment ? 7 : 6,
      titulo: "Acompanhamento",
      preenchida: sendFollowup && Boolean(followupText.trim()),
      opcional: true,
    },
  ];

  return (
    <form
      action={saveAutomation}
      onSubmit={validate}
      className="grid items-start gap-6 xl:grid-cols-[180px_minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <IndiceDasEtapas etapas={etapas} ativa={etapaAtiva} />

      <div className="space-y-5">
        <input type="hidden" name="id" defaultValue={a?.id ?? ""} />
        <input type="hidden" name="media_id" value={post?.id ?? ""} readOnly />
        <input type="hidden" name="media_thumbnail_url" value={post?.thumb ?? ""} readOnly />
        <input type="hidden" name="media_caption" value={post?.caption ?? ""} readOnly />
        <input type="hidden" name="media_permalink" value={post?.permalink ?? ""} readOnly />
        <input type="hidden" name="story_id" value={story?.id ?? ""} readOnly />
        <input type="hidden" name="story_thumbnail_url" value={story?.thumb ?? ""} readOnly />

        {formError && <div className={alertError}>{formError}</div>}

        <Section
          id="identificacao"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "identificacao"}
          step={1}
          title="Identificação"
          subtitle="Como você vai reconhecer esta automação na sua lista."
        >
          <div>
            <label className={labelCls}>Nome da automação</label>
            <input
              name="name"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              className={inputCls}
              placeholder="Ex.: Link do e-book"
            />
            <p className={hintCls}>Só você vê esse nome, na lista de automações.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="active"
              defaultChecked={a?.active ?? true}
              className="h-4 w-4 accent-indigo-500"
            />
            Ativa
          </label>
        </Section>

        <Section
          id="gatilho"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "gatilho"}
          step={2}
          kind="gatilho"
          title="Quando alguém…"
          subtitle="O que dispara a automação. Escolha o canal e as palavras que ativam."
        >
          <div
            className={`grid gap-3 ${
              triggerOptions.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            }`}
          >
            {triggerOptions.map((o) => {
              const selected = trigger === o.value;
              const Icon = o.icon;
              return (
                <label
                  key={o.value}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    selected
                      ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500"
                      : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="trigger"
                    value={o.value}
                    checked={selected}
                    onChange={() => pickTrigger(o.value)}
                    className="sr-only"
                  />
                  <Icon
                    className={`h-5 w-5 ${
                      selected
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  />
                  <p
                    className={`mt-2 text-sm font-semibold ${
                      selected
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-zinc-800 dark:text-zinc-200"
                    }`}
                  >
                    {o.title}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{o.desc}</p>
                </label>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Palavras-chave (separadas por vírgula)</label>
              <input
                name="keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                required={matchType !== "any"}
                className={inputCls}
                placeholder="quero, link, eu quero"
              />
              <p className={hintCls}>
                {KEYWORD_HINT[trigger]} Sem diferença de maiúsculas ou acentos.
              </p>
            </div>
            <div>
              <label className={labelCls}>Tipo de correspondência</label>
              <select
                name="match_type"
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as typeof matchType)}
                className={inputCls}
              >
                <option value="contains">Contém a palavra</option>
                <option value="exact">Texto exato</option>
                <option value="any">Qualquer texto</option>
              </select>
            </div>
          </div>
          {trigger === "comment" && (
            <div>
              <span className={labelCls}>Post específico (opcional)</span>
              <MediaPicker kind="posts" selected={post} onSelect={setPost} platform={platform} />
              <p className={hintCls}>Sem post escolhido, vale para todos os posts.</p>
            </div>
          )}
          {trigger === "story" && (
            <div>
              <span className={labelCls}>Story específico (opcional)</span>
              <MediaPicker kind="stories" selected={story} onSelect={setStory} platform={platform} />
              <p className={hintCls}>
                Só stories no ar aparecem aqui (duram 24h). Sem story escolhido, vale para todos.
              </p>
            </div>
          )}
        </Section>

        {isComment && (
          <Section
            id="resposta-publica"
            aoFocar={setEtapaAtiva}
            ativa={etapaAtiva === "resposta-publica"}
            step={3}
            opcional
            title="Responder no comentário"
            subtitle="Resposta pública no post, visível para todos. Ajuda no alcance."
          >
            <MessageField
              name="public_replies"
              label="Variações (uma por linha — sorteia uma)"
              value={publicReplies}
              onChange={setPublicReplies}
              rows={3}
              placeholder={"Te chamei na DM! 📩\nAcabei de te mandar mensagem 😉"}
              hint="Aparece no post, abaixo do comentário da pessoa."
            />
          </Section>
        )}

        <Section
          id="boas-vindas"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "boas-vindas"}
          step={isComment ? 4 : 3}
          title={facebook ? "Enviar a mensagem de boas-vindas" : "Enviar a DM de boas-vindas"}
          subtitle="A primeira mensagem no privado, antes do link."
        >
          <div>
            <MessageField
              name="welcome_text"
              label="Mensagem"
              value={welcomeText}
              onChange={setWelcomeText}
              rows={3}
              required
              placeholder="Oi {{first_name}}! Que bom te ver por aqui 😊 Toca no botão aqui embaixo que eu te mando o link."
            />
            <p className={hintCls}>
              {isComment
                ? `Enviada como resposta privada ao comentário${
                    facebook ? " no Messenger" : ""
                  } (fura a janela de 24h).`
                : facebook
                  ? "Enviada no Messenger, na conversa que a pessoa abriu."
                  : "Enviada como DM direta, na conversa que a pessoa abriu."}
            </p>
          </div>

          {/* No gatilho de comentário esta mensagem é uma resposta privada, e a
              Meta só aceita texto nela. Em vez de oferecer um campo que não
              seria entregue, o anexo aparece só nos outros gatilhos — nas
              etapas seguintes ele funciona em todos. */}
          {!isComment && (
            <>
              <input type="hidden" name="welcome_media_type" value={welcomeMedia.kind ?? ""} />
              <input type="hidden" name="welcome_media_url" value={welcomeMedia.url} />
              <MediaField
                kind={welcomeMedia.kind}
                url={welcomeMedia.url}
                onChange={(kind, url) => setWelcomeMedia({ kind, url })}
              />
            </>
          )}
          <div>
            <label className={labelCls}>Texto do botão de resposta rápida</label>
            <input
              name="quick_reply_label"
              value={quickReplyLabel}
              onChange={(e) => setQuickReplyLabel(e.target.value)}
              maxLength={20}
              className={inputCls}
            />
            <p className={hintCls}>
              Quando a pessoa toca, abre a janela de 24h e o link é enviado. Máx. 20 caracteres.
            </p>
          </div>
        </Section>

        <Section
          id="condicoes"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "condicoes"}
          step={isComment ? 5 : 4}
          opcional
          title="Condições antes de entregar"
          subtitle="Peça para seguir ou colete o e-mail antes de liberar o link."
        >
          {facebook ? (
            <p className={`text-xs ${muted}`}>
              Exigir que a pessoa siga a página não é possível no Facebook: a API não informa
              quem curtiu ou segue. Dá para pedir na mensagem, mas o sistema não tem como
              conferir — por isso a opção não aparece aqui.
            </p>
          ) : (
          <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="require_follow"
              checked={requireFollow}
              onChange={(e) => setRequireFollow(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span>
              Só entregar o link para quem segue seu perfil
              <span className={`mt-0.5 block text-xs font-normal ${muted}`}>
                O sistema confere na hora. Quem já segue nem vê esse pedido; quem não segue
                só avança depois que passar a seguir de verdade.
              </span>
            </span>
          </label>
          )}
          {!facebook && requireFollow && (
            <div className="space-y-4 border-l-2 border-indigo-500/30 pl-4">
              <MessageField
                name="follow_text"
                label="Mensagem do pedido"
                value={followText}
                onChange={setFollowText}
                rows={2}
                placeholder="Antes de te mandar o link, me segue lá no perfil 🙏"
              />
              <div>
                <label className={labelCls}>Texto do botão</label>
                <input
                  name="follow_button_label"
                  value={followButtonLabel}
                  onChange={(e) => setFollowButtonLabel(e.target.value)}
                  maxLength={20}
                  className={inputCls}
                />
                <p className={hintCls}>
                  A cada toque no botão (ou mensagem tipo “já segui”), o sistema consulta o
                  Instagram de novo. O link só sai quando a resposta confirmar. Depois de 5
                  tentativas ele para de insistir para não virar spam — mas continua
                  conferindo, e libera assim que ela seguir.
                </p>
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="ask_email"
              checked={askEmail}
              onChange={(e) => setAskEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span>
              Pedir o e-mail antes do link
              <span className={`mt-0.5 block text-xs font-normal ${muted}`}>
                A pessoa digita o e-mail na DM e ele fica salvo na sua lista de contatos.
              </span>
            </span>
          </label>
          {askEmail && (
            <div className="space-y-4 border-l-2 border-indigo-500/30 pl-4">
              <MessageField
                name="email_text"
                label="Mensagem do pedido"
                value={emailText}
                onChange={setEmailText}
                rows={2}
                placeholder="Me manda seu melhor e-mail que eu te envio o link 👇"
                hint="Se vier algo que não parece e-mail, o sistema pede de novo uma vez."
              />
            </div>
          )}

          {trigger === "story" && (
            <div>
              <label className={labelCls}>Reagir à resposta do story</label>
              <div className="flex flex-wrap gap-2">
                {["", "❤️", "🔥", "😍", "👏", "🙌"].map((emoji) => (
                  <label
                    key={emoji || "off"}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-lg transition-colors ${
                      storyReaction === emoji
                        ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500"
                        : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    <input
                      type="radio"
                      name="story_reaction"
                      value={emoji}
                      checked={storyReaction === emoji}
                      onChange={() => setStoryReaction(emoji)}
                      className="sr-only"
                    />
                    {emoji || <span className="text-xs text-zinc-500">sem reação</span>}
                  </label>
                ))}
              </div>
              <p className={hintCls}>
                O robô reage à mensagem da pessoa, igual quando você toca e segura na DM.
              </p>
            </div>
          )}
        </Section>

        <Section
          id="link"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "link"}
          step={isComment ? 6 : 5}
          title="Enviar a mensagem final"
          subtitle="A entrega: uma mensagem, com ou sem botão de link."
        >
          <MessageField
            name="link_text"
            label="Mensagem"
            value={linkText}
            onChange={setLinkText}
            rows={2}
            placeholder="Aqui está, {{first_name}}! 👇 Aproveita 😉"
          />

          <input type="hidden" name="link_media_type" value={linkMedia.kind ?? ""} />
          <input type="hidden" name="link_media_url" value={linkMedia.url} />
          <MediaField
            kind={linkMedia.kind}
            url={linkMedia.url}
            onChange={(kind, url) => setLinkMedia({ kind, url })}
          />

          <label className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
            sendLink
              ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30"
              : "border-zinc-200 dark:border-zinc-800"
          }`}>
            <input
              type="checkbox"
              name="send_link"
              checked={sendLink}
              onChange={(e) => setSendLink(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                Incluir botão com link
              </span>
              <span className={`mt-0.5 block text-xs ${muted}`}>
                Desmarcado, a automação envia só a mensagem — sem botão e sem levar ninguém para
                fora do Instagram.
              </span>
            </span>
          </label>

          {sendLink && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Rótulo do botão</label>
              <input
                name="link_button_label"
                value={linkButtonLabel}
                onChange={(e) => setLinkButtonLabel(e.target.value)}
                maxLength={20}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>URL</label>
              <input
                name="link_url"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className={inputCls}
                placeholder="https://seulink.com"
              />
            </div>
          </div>
          )}
        </Section>

        <Section
          id="acompanhamento"
          aoFocar={setEtapaAtiva}
          ativa={etapaAtiva === "acompanhamento"}
          step={isComment ? 7 : 6}
          opcional
          title="Mensagem de acompanhamento"
          subtitle="Uma segunda mensagem depois do prazo, com link e botão próprios."
        >
          <label
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
              sendFollowup
                ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <input
              type="checkbox"
              name="send_followup"
              checked={sendFollowup}
              onChange={(e) => setSendFollowup(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                Enviar uma segunda mensagem depois
              </span>
              <span className={`mt-0.5 block text-xs ${muted}`}>
                Desmarcado, a automação termina na mensagem anterior e nada mais é enviado. O que
                você escrever aqui fica salvo para quando quiser religar.
              </span>
            </span>
          </label>

          {sendFollowup && (
          <>
          <MessageField
            name="followup_text"
            label="Mensagem de acompanhamento"
            value={followupText}
            onChange={setFollowupText}
            rows={2}
            placeholder="E aí, {{first_name}}, conseguiu dar uma olhada? Separei mais uma coisa pra você 👇"
            hint="Sai para todo mundo que passou pelo fluxo (a API não informa quem clicou no link). Precisa caber na janela de 24h."
          />

          <input type="hidden" name="followup_media_type" value={followupMedia.kind ?? ""} />
          <input type="hidden" name="followup_media_url" value={followupMedia.url} />
          <MediaField
            kind={followupMedia.kind}
            url={followupMedia.url}
            onChange={(kind, url) => setFollowupMedia({ kind, url })}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>URL do botão (opcional)</label>
              <input
                name="followup_url"
                type="url"
                value={followupUrl}
                onChange={(e) => setFollowupUrl(e.target.value)}
                className={inputCls}
                placeholder="https://outrolink.com"
              />
              <p className={`mt-1 text-xs ${muted}`}>
                Pode ser um link diferente do passo anterior. Em branco, a mensagem vai só como
                texto.
              </p>
            </div>
            <div>
              <label className={labelCls}>Texto do botão</label>
              <input
                name="followup_button_label"
                value={followupButtonLabel}
                onChange={(e) => setFollowupButtonLabel(e.target.value)}
                className={inputCls}
                placeholder="Abrir link"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Atraso (minutos)</label>
            {/* Sem min/max nativos de propósito: esta etapa é OPCIONAL e um
                campo dela não pode impedir de salvar o resto com um "o valor
                deve ser igual ou menor a 1200". O ajuste acontece ao sair do
                campo, à vista, e o servidor confere de novo. */}
            <input
              name="followup_delay_minutes"
              type="number"
              inputMode="numeric"
              value={followupDelay}
              onChange={(e) => setFollowupDelay(e.target.value)}
              onBlur={(e) => {
                const n = Number(e.target.value);
                setFollowupDelay(String(Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(1200, Math.round(n))) : 1200));
              }}
              className={inputCls}
            />
            <p className={`mt-1 text-xs ${muted}`}>
              Contado a partir da entrega do link. De 5 a 1200 minutos (20h) — passou disso, a
              janela de 24h da Meta já fechou e a mensagem não sai.
            </p>
          </div>
          </>
          )}
        </Section>

        {/* Barra de ações fixa: o formulário é longo e, com o botão só no fim,
            era preciso rolar tudo para salvar. O respiro embaixo existe porque
            a barra flutua sobre o conteúdo — sem ele, a última etapa ficava
            escondida atrás dela. */}
        <div className="h-2" />
        <div className="sticky bottom-0 z-20 -mx-1 mt-2 border-t border-zinc-200/80 bg-white/85 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-zinc-800 dark:bg-zinc-950/85 supports-[backdrop-filter]:dark:bg-zinc-950/70">
          <div className="flex items-center gap-3">
            <button className={btnPrimary}>Salvar automação</button>
            <Link href="/automacoes" className={btnSecondary}>
              Cancelar
            </Link>
            <span className={`ml-auto hidden text-xs sm:block ${muted}`}>
              A prévia ao lado acende a mensagem que você está editando
            </span>
          </div>
        </div>
      </div>

      {/* Pré-visualização ao vivo, do ponto de vista de quem interage */}
      <aside className="lg:sticky lg:top-6">
        <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Como a pessoa vê
        </p>
        <PhonePreview
          account={account}
          trigger={trigger}
          post={post}
          story={story}
          keyword={previewKeyword}
          publicReply={publicReplies.split("\n")[0]?.trim() || undefined}
          welcomeText={welcomeText}
          quickReplyLabel={quickReplyLabel}
          linkText={linkText}
          linkButtonLabel={linkButtonLabel}
          linkUrl={linkUrl}
          followupText={followupText}
          followupDelay={Number(followupDelay) || 1200}
          followupUrl={followupUrl}
          followupButtonLabel={followupButtonLabel}
          requireFollow={requireFollow}
          followText={followText}
          followButtonLabel={followButtonLabel}
          askEmail={askEmail}
          emailText={emailText}
          storyReaction={storyReaction}
          etapaAtiva={etapaAtiva}
        />
      </aside>
    </form>
  );
}
