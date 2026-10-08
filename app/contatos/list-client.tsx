"use client";
import { useMemo, useState, useTransition } from "react";
import { apagarContato } from "./actions";
import { muted, tableWrap, thead, rowDivide, input, badgeAccent, badgeNeutral, emptyWrap } from "../ui";
import Avatar from "../avatar";

export type ContactRow = {
  ig_id: string;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  email: string | null;
  first_contact_at: string;
  last_reply_at: string | null;
  automation_name: string | null;
  janelaAberta: boolean;
  // etiquetas postas pelos blocos "Etiquetar" dos fluxos
  tags: string[];
};

type Filtro = "todos" | "com-email" | "sem-email";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function ContactsList({ contatos }: { contatos: ContactRow[] }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  // etiqueta selecionada (null = todas). Vem dos fluxos, então a lista de
  // opções é o que existe de fato nos contatos, sem cadastro à parte.
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const [apagando, setApagando] = useState<string | null>(null);

  const contagem = useMemo(
    () => ({
      todos: contatos.length,
      "com-email": contatos.filter((c) => c.email).length,
      "sem-email": contatos.filter((c) => !c.email).length,
    }),
    [contatos]
  );

  // Etiquetas existentes, em ordem alfabética — a lista sai dos próprios
  // contatos, não de um cadastro à parte.
  const etiquetas = useMemo(
    () => [...new Set(contatos.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)),
    [contatos]
  );

  // Filtragem no cliente: resposta instantânea a cada tecla, sem ida ao servidor.
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contatos.filter((c) => {
      if (filtro === "com-email" && !c.email) return false;
      if (filtro === "sem-email" && c.email) return false;
      // etiqueta escolhida no chip: mostra só quem a tem
      if (etiqueta && !c.tags.includes(etiqueta)) return false;
      if (!termo) return true;
      return [c.name, c.username, c.email, c.ig_id, ...c.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [contatos, busca, filtro, etiqueta]);

  function apagar(c: ContactRow) {
    const quem = c.name ?? (c.username ? `@${c.username}` : c.ig_id);
    if (!confirm(`Apagar ${quem} da sua lista? Esta ação não pode ser desfeita.`)) return;
    setApagando(c.ig_id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("ig_id", c.ig_id);
      await apagarContato(fd);
      setApagando(null);
    });
  }

  const FILTROS: { id: Filtro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "com-email", label: "Com e-mail" },
    { id: "sem-email", label: "Sem e-mail" },
  ];

  return (
    <div className="space-y-4">
      {/* busca + filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, @ ou e-mail…"
            className={`${input} pl-9`}
            aria-label="Buscar contatos"
          />
        </div>
        <div
          role="tablist"
          aria-label="Filtrar contatos"
          className="inline-flex shrink-0 rounded-xl border border-zinc-200 bg-zinc-100/70 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/70"
        >
          {FILTROS.map((f) => {
            const ativo = filtro === f.id;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={ativo}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  ativo
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {f.label}
                <span className="ml-1.5 text-[11px] text-zinc-400">{contagem[f.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Etiquetas: só aparecem quando algum fluxo já marcou alguém, então a
          barra não fica ocupada por um filtro vazio. */}
      {etiquetas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">Etiquetas:</span>
          {etiquetas.map((t) => {
            const ativa = etiqueta === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setEtiqueta(ativa ? null : t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  ativa
                    ? "bg-fuchsia-600 text-white"
                    : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:bg-fuchsia-950 dark:text-fuchsia-300"
                }`}
              >
                {t}
              </button>
            );
          })}
          {etiqueta && (
            <button
              type="button"
              onClick={() => setEtiqueta(null)}
              className="text-[11px] font-medium text-zinc-500 hover:underline"
            >
              limpar
            </button>
          )}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className={emptyWrap}>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nenhum contato encontrado
          </p>
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setFiltro("todos");
              setEtiqueta(null);
            }}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}>
              <tr>
                <th className="px-4 py-3">Pessoa</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Primeiro contato</th>
                <th className="px-4 py-3">Última resposta</th>
                <th className="px-4 py-3">Janela 24h</th>
                <th className="px-4 py-3">Automação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className={rowDivide}>
              {visiveis.map((c) => (
                <tr
                  key={c.ig_id}
                  className={pendente && apagando === c.ig_id ? "opacity-50" : undefined}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={c.profile_pic}
                        name={c.name ?? c.username ?? "?"}
                        className="h-9 w-9"
                        textClassName="text-xs"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {c.name ?? (c.username ? `@${c.username}` : c.ig_id)}
                        </p>
                        {c.name && c.username && (
                          <p className="truncate text-xs text-zinc-500">@{c.username}</p>
                        )}
                        {c.tags.length > 0 && (
                          <p className="mt-0.5 flex flex-wrap gap-1">
                            {c.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-fuchsia-50 px-1.5 py-px text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300"
                              >
                                {t}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                    {c.email ?? <span className={muted}>—</span>}
                  </td>
                  <td className={`px-4 py-2.5 ${muted}`}>{fmt(c.first_contact_at)}</td>
                  <td className={`px-4 py-2.5 ${muted}`}>{fmt(c.last_reply_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={c.janelaAberta ? badgeAccent : badgeNeutral}>
                      {c.janelaAberta ? "aberta" : "fechada"}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 ${muted}`}>{c.automation_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={pendente && apagando === c.ig_id}
                      onClick={() => apagar(c)}
                      title="Apagar contato"
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      Apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
