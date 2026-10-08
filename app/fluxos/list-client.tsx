"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { alternarFluxo, apagarFluxo, duplicarFluxo } from "./actions";
import {
  card,
  cardHover,
  muted,
  badgeOk,
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  emptyWrap,
} from "../ui";
import { IconComment, IconStory, IconSend, IconZap } from "../icons";
import Thumb from "../thumb";

export type FlowRow = {
  id: string;
  name: string;
  active: boolean;
  trigger: string;
  keywords: string[];
  blocos: number;
  thumb: string | null;
  mediaId: string | null;
};

const GATILHO: Record<
  string,
  { label: string; icon: (p: { className?: string }) => React.ReactNode }
> = {
  comment: { label: "Comentário", icon: IconComment },
  story: { label: "Story", icon: IconStory },
  dm: { label: "Mensagem", icon: IconSend },
};

export default function FlowsList({ flows }: { flows: FlowRow[] }) {
  const [pendente, startTransition] = useTransition();
  const [agindo, setAgindo] = useState<string | null>(null);

  function executar(id: string, fn: () => Promise<void>) {
    setAgindo(id);
    startTransition(async () => {
      await fn();
      setAgindo(null);
    });
  }

  return (
    <ul className="space-y-3">
      {flows.map((f) => {
        const meta = GATILHO[f.trigger] ?? GATILHO.comment;
        const Icone = meta.icon;
        const ocupado = pendente && agindo === f.id;
        return (
          <li key={f.id} className={`flex flex-wrap items-center gap-3 p-4 ${card} ${cardHover}`}>
            {f.thumb || f.mediaId ? (
              <Thumb src={f.thumb} mediaId={f.mediaId} />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-950/60">
                <IconZap className="h-5 w-5" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/fluxos/${f.id}`}
                  className="truncate font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                >
                  {f.name}
                </Link>
                <span className={f.active ? badgeOk : badgeNeutral}>
                  {f.active ? "ativo" : "pausado"}
                </span>
              </div>
              <p className={`mt-0.5 flex flex-wrap items-center gap-1.5 text-xs ${muted}`}>
                <Icone className="h-3.5 w-3.5" />
                {meta.label}
                {f.keywords.length > 0 && <>· {f.keywords.join(", ")}</>}
                <>· {f.blocos} blocos</>
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-xs">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => executar(f.id, () => alternarFluxo(f.id, !f.active))}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {f.active ? "Pausar" : "Ativar"}
              </button>
              {/* Link comum, não ação: o download precisa de uma navegação de
                  verdade para o navegador salvar o arquivo. */}
              <a
                href={`/fluxos/${f.id}/exportar`}
                download
                title="Baixar este fluxo como arquivo .json"
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Exportar
              </a>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => executar(f.id, () => duplicarFluxo(f.id))}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Duplicar
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => {
                  if (confirm(`Apagar o fluxo “${f.name}”? Não dá para desfazer.`)) {
                    executar(f.id, () => apagarFluxo(f.id));
                  }
                }}
                className="rounded-lg border border-red-300 px-2.5 py-1.5 font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Apagar
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ListaVazia() {
  return (
    <div className={emptyWrap}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 dark:bg-indigo-950/60">
        <IconZap className="h-6 w-6" />
      </span>
      <div>
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Nenhum fluxo ainda</p>
        <p className={`mt-1 max-w-sm text-sm ${muted}`}>
          O fluxo é a automação em forma de mapa: blocos ligados por setas, em que cada opção de
          resposta leva a um caminho diferente. Para um caminho único e direto, a automação
          simples resolve.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/fluxos/novo" className={btnPrimary}>
          Criar meu primeiro fluxo
        </Link>
        <Link href="/fluxos/importar" className={btnSecondary}>
          Importar um fluxo pronto
        </Link>
      </div>
    </div>
  );
}
