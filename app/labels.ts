import { diagnosticoDaMeta } from "@/lib/meta-erros";
// Tradução dos nomes internos do sistema para a linguagem de quem usa o painel.
// Ninguém deveria precisar saber o que é "dm_link" ou "story_reply".

type Badge = { label: string; className: string };

const BADGE_BASE = "rounded-full px-2 py-0.5 text-[10px] font-medium";

// ---------- O que a pessoa fez no seu Instagram ----------

const EVENT: Record<string, Badge> = {
  comment: {
    label: "Comentou no post",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-400",
  },
  message: {
    label: "Mandou mensagem",
    className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-400",
  },
  story_reply: {
    label: "Respondeu seu story",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400",
  },
  quick_reply: {
    label: "Tocou no botão",
    className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-400",
  },
  error: {
    label: "Algo deu errado",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400",
  },
  follow_check_unavailable: {
    label: "Não deu para conferir o seguidor",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400",
  },
};

const UNKNOWN: Badge = {
  label: "Interação",
  className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

export function eventBadge(type: string): Badge {
  const b = EVENT[type] ?? UNKNOWN;
  return { ...b, className: `${BADGE_BASE} ${b.className}` };
}

// ---------- O que o robô enviou ----------

const KIND: Record<string, string> = {
  private_reply: "Boas-vindas no privado",
  comment_reply: "Resposta no comentário",
  dm_welcome: "Boas-vindas na DM",
  dm_link: "DM com o seu link",
  dm_reminder: "Lembrete",
  dm_followup: "Acompanhamento",
  dm_follow_gate: "Pedido para seguir",
  dm_email_ask: "Pedido de e-mail",
  story_reaction: "Reação no story",
  dm_broadcast: "Disparo manual",
  flow_message: "Mensagem do fluxo",
  flow_resume: "Continuação do fluxo",
};

export function kindLabel(kind: string): string {
  return KIND[kind] ?? kind;
}

// ---------- Situação do envio ----------

const STATUS: Record<string, Badge> = {
  pending: {
    label: "Na fila",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
  sending: {
    label: "Enviando",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-400",
  },
  sent: {
    label: "Entregue",
    className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-400",
  },
  failed: {
    label: "Não saiu",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400",
  },
  skipped: {
    label: "Não enviada",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400",
  },
};

export function statusBadge(status: string): Badge {
  const b = STATUS[status] ?? UNKNOWN;
  return { ...b, className: `${BADGE_BASE} ${b.className}` };
}

// ---------- Erros em português de gente ----------

export function friendlyError(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes("janela de 24h"))
    return "A pessoa não respondeu dentro de 24h. A Meta só deixa enviar nesse intervalo.";
  if (raw.includes("conta não conectada"))
    return "Esta conta não está mais conectada ao painel.";
  // O código do erro da Meta diz muito mais que o status HTTP: bloqueio de
  // acesso do app e token vencido são os dois 400, mas o conserto é oposto —
  // e mandar "confira se a conta segue conectada" para quem está com o app
  // bloqueado é justamente a pista errada.
  const meta = diagnosticoDaMeta(raw);
  if (meta) return meta.resumo;
  if (/(Instagram|Facebook) API 4\d\d/.test(raw))
    return "A Meta recusou este envio. Confira em Configuração se a conta segue conectada.";
  if (/(Instagram|Facebook) API 5\d\d/.test(raw))
    return "A Meta ficou instável na hora. O sistema tenta de novo sozinho.";
  return "Não conseguimos enviar desta vez. O sistema tenta de novo automaticamente.";
}

// ---------- Quem falou e o que disse ----------

type EventPayload = {
  text?: string;
  from?: { id?: string; username?: string };
  sender?: { id?: string };
  message?: { text?: string; quick_reply?: { payload?: string } };
};

// Texto que a pessoa escreveu (o botão de resposta rápida não tem texto útil:
// o payload dele é um identificador interno da automação)
export function eventText(payload: unknown, type: string): string | null {
  if (type === "quick_reply") return null;
  const p = (payload ?? {}) as EventPayload;
  const t = p.text ?? p.message?.text;
  return t?.trim() ? t.trim() : null;
}

// @ de quem interagiu, quando o próprio evento carrega (comentários trazem)
export function eventUsername(payload: unknown): string | null {
  const p = (payload ?? {}) as EventPayload;
  return p.from?.username ?? null;
}
