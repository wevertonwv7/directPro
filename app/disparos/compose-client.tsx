"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { enviarDisparo } from "./actions";
import MessageField from "../automacoes/variable-picker";
import Avatar from "../avatar";
import {
  card,
  input,
  label as labelCls,
  muted,
  btnPrimary,
  btnGhost,
  hint,
  sectionTitle,
  badgeNeutral,
  alertWarn,
} from "../ui";

export type Alvo = {
  ig_id: string;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  horasRestantes: number;
};

function restante(h: number): { texto: string; urgente: boolean } {
  if (h < 1) return { texto: `${Math.max(1, Math.round(h * 60))} min`, urgente: true };
  return { texto: `${Math.floor(h)} h`, urgente: h < 3 };
}

function Enviar({ total }: { total: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || total === 0} className={btnPrimary}>
      {pending ? "Enfileirando…" : total === 0 ? "Selecione alguém" : `Disparar para ${total}`}
    </button>
  );
}

export default function Compose({ alvos }: { alvos: Alvo[] }) {
  const [texto, setTexto] = useState("");
  const [url, setUrl] = useState("");
  const [botao, setBotao] = useState("");
  const [busca, setBusca] = useState("");
  // Ninguém vem marcado: disparo em massa é opt-in, escolha a escolha.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return alvos;
    return alvos.filter((a) =>
      [a.name, a.username, a.ig_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo))
    );
  }, [alvos, busca]);

  function alternar(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Marca/desmarca só o que está visível no filtro atual — o contrário
  // surpreenderia quem buscou por alguém e clicou em "todos".
  function marcarVisiveis(marcar: boolean) {
    setMarcados((prev) => {
      const next = new Set(prev);
      for (const a of visiveis) {
        if (marcar) next.add(a.ig_id);
        else next.delete(a.ig_id);
      }
      return next;
    });
  }

  const todosVisiveisMarcados =
    visiveis.length > 0 && visiveis.every((a) => marcados.has(a.ig_id));

  function confirmar(e: React.FormEvent<HTMLFormElement>) {
    if (
      !confirm(
        `Enviar esta mensagem para ${marcados.size} ${
          marcados.size === 1 ? "pessoa" : "pessoas"
        }?\n\nOs envios saem aos poucos para respeitar o limite da Meta.`
      )
    ) {
      e.preventDefault();
    }
  }

  return (
    <form action={enviarDisparo} onSubmit={confirmar} className="space-y-5">
      {/* 1. Mensagem */}
      <section className={`${card} p-5`}>
        <h2 className={`${sectionTitle} mb-4 text-[15px]`}>1. A mensagem</h2>
        <div className="space-y-4">
          <MessageField
            name="text"
            label="Texto"
            value={texto}
            onChange={setTexto}
            rows={4}
            required
            placeholder="Oi {{first_name}}! Separei uma novidade que combina com o que você pediu 👇"
            hint="Vale para quem já falou com você nas últimas 24h. Escreva como se fosse uma conversa — é isso que ela é."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Link do botão (opcional)</label>
              <input
                name="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={input}
                placeholder="https://seulink.com"
              />
              <p className={hint}>Em branco, a mensagem vai só como texto.</p>
            </div>
            <div>
              <label className={labelCls}>Texto do botão</label>
              <input
                name="button_label"
                value={botao}
                onChange={(e) => setBotao(e.target.value)}
                className={input}
                placeholder="Abrir link"
              />
            </div>
          </div>

          {/* Prévia: mesma bolha do preview das automações, com as quebras de
              linha respeitadas como foram digitadas. */}
          <div>
            <p className={labelCls}>Prévia</p>
            <div className="rounded-xl bg-zinc-900 p-3">
              <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-[#262626] text-[11px] leading-snug text-zinc-100">
                <p className="whitespace-pre-wrap px-3 py-1.5">
                  {texto || <span className="italic text-zinc-500">Sua mensagem…</span>}
                </p>
                {url && (
                  <p className="border-t border-zinc-700 px-3 py-1.5 text-center font-semibold text-[#3797f0]">
                    {botao || "Abrir link"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Destinatários */}
      <section className={`${card} p-5`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${sectionTitle} text-[15px]`}>2. Para quem</h2>
          <span className={badgeNeutral}>
            {marcados.size} de {alvos.length} {alvos.length === 1 ? "selecionado" : "selecionados"}
          </span>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou @…"
            className={`${input} flex-1`}
            aria-label="Buscar contatos"
          />
          <button
            type="button"
            onClick={() => marcarVisiveis(!todosVisiveisMarcados)}
            className={btnGhost}
          >
            {todosVisiveisMarcados ? "Desmarcar" : "Marcar"}
            {busca.trim() ? ` ${visiveis.length} do filtro` : " todos"}
          </button>
        </div>

        <div className="max-h-[26rem] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {visiveis.map((a) => {
              const marcado = marcados.has(a.ig_id);
              const r = restante(a.horasRestantes);
              return (
                <li key={a.ig_id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                      marcado
                        ? "bg-indigo-50/60 dark:bg-indigo-950/20"
                        : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="ig_ids"
                      value={a.ig_id}
                      checked={marcado}
                      onChange={() => alternar(a.ig_id)}
                      className="h-4 w-4 shrink-0 accent-indigo-500"
                    />
                    <Avatar
                      src={a.profile_pic}
                      name={a.name ?? a.username ?? "?"}
                      className="h-8 w-8"
                      textClassName="text-[10px]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {a.name ?? (a.username ? `@${a.username}` : a.ig_id)}
                      </p>
                      {a.name && a.username && (
                        <p className="truncate text-xs text-zinc-500">@{a.username}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        r.urgente ? "text-amber-600 dark:text-amber-400" : muted
                      }`}
                      title="Tempo restante da janela de 24h"
                    >
                      {r.texto}
                    </span>
                  </label>
                </li>
              );
            })}
            {visiveis.length === 0 && (
              <li className={`px-3 py-6 text-center text-sm ${muted}`}>
                Ninguém encontrado com esse termo.
              </li>
            )}
          </ul>
        </div>

        <p className={`${hint} mt-2`}>
          A coluna da direita mostra quanto falta para a janela de cada pessoa fechar. Quem está
          mais perto de expirar é disparado primeiro.
        </p>
      </section>

      {marcados.size > 50 && (
        <p className={alertWarn}>
          Você selecionou {marcados.size} pessoas. O envio é distribuído ao longo do tempo para
          respeitar o limite da Meta (~190/hora por conta), então listas grandes levam horas para
          terminar — e quem tiver a janela fechada até lá é pulado automaticamente.
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Enviar total={marcados.size} />
      </div>
    </form>
  );
}
