"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { importarFluxo } from "../actions";
import { ErroDeImportacao, lerTexto, resumirFluxo, type ResumoDeFluxo } from "@/lib/flow-io";
import {
  card,
  muted,
  hint,
  label,
  btnPrimary,
  btnSecondary,
  alertError,
  alertInfo,
  badgeNeutral,
  badgeWarn,
} from "../../ui";
import { IconAlert, IconFlow, IconX } from "../../icons";

// A leitura do arquivo acontece AQUI, no navegador, e não no servidor: assim a
// pessoa vê o que vai entrar (nome, gatilho, quantos blocos, quanta coisa falta
// trocar) antes de gravar qualquer linha no banco. O mesmo lerTexto roda de
// novo no servidor na hora de salvar — a prévia é conforto, não é segurança.
export default function ImportForm() {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<ResumoDeFluxo[] | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function analisar(conteudo: string, nomeDoArquivo?: string) {
    setTexto(conteudo);
    setArquivo(nomeDoArquivo ?? null);
    if (!conteudo.trim()) {
      setPrevia(null);
      setErro(null);
      return;
    }
    try {
      setPrevia(lerTexto(conteudo).map(resumirFluxo));
      setErro(null);
    } catch (e) {
      setPrevia(null);
      setErro(e instanceof ErroDeImportacao ? e.message : "Não consegui ler esse arquivo.");
    }
  }

  async function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    analisar(await f.text(), f.name);
  }

  function limpar() {
    setTexto("");
    setPrevia(null);
    setErro(null);
    setArquivo(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const aTrocar = previa?.reduce((s, f) => s + f.aTrocar, 0) ?? 0;

  return (
    <form action={importarFluxo} className="space-y-5">
      <input type="hidden" name="json" value={texto} readOnly />

      <div className={`space-y-4 p-5 ${card}`}>
        <div>
          <span className={label}>1. Escolha o arquivo do fluxo</span>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={escolherArquivo}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 sm:w-auto dark:text-zinc-400 dark:file:bg-indigo-950/60 dark:file:text-indigo-300"
            />
            {arquivo && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                {arquivo}
                <button
                  type="button"
                  onClick={limpar}
                  title="Tirar este arquivo"
                  className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
          <p className={hint}>
            Arquivo .json exportado deste painel ou recebido num pacote de fluxos prontos.
          </p>
        </div>

        <div>
          <label htmlFor="colar" className={label}>
            …ou cole o conteúdo aqui
          </label>
          <textarea
            id="colar"
            rows={5}
            value={texto}
            onChange={(e) => analisar(e.target.value)}
            placeholder={'{ "formato": 1, "fluxos": [ … ] }'}
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:ring-indigo-950"
          />
        </div>
      </div>

      {erro && (
        <div className={alertError}>
          <IconAlert className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {previa && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            2. Confira o que vai entrar ({previa.length}{" "}
            {previa.length === 1 ? "fluxo" : "fluxos"})
          </h2>
          <ul className="space-y-2">
            {previa.map((f, i) => (
              <li key={`${f.nome}-${i}`} className={`flex gap-3 p-4 ${card}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-950/60">
                  <IconFlow className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{f.nome}</p>
                  {f.descricao && (
                    <p className={`mt-0.5 text-xs ${muted}`}>{f.descricao}</p>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={badgeNeutral}>{f.gatilho}</span>
                    <span className={badgeNeutral}>{f.blocos} blocos</span>
                    <span className={`text-xs ${muted}`}>· {f.palavras}</span>
                    {f.aTrocar > 0 && (
                      <span className={badgeWarn}>{f.aTrocar} para personalizar</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className={alertInfo}>
            <div className="space-y-1">
              <p className="font-medium">
                Tudo entra pausado — nada é enviado até você ativar.
              </p>
              <p>
                {aTrocar > 0 ? (
                  <>
                    Há <strong>{aTrocar}</strong> texto(s) e link(s) de exemplo (entre colchetes)
                    para trocar pelos seus. Abra cada fluxo, ajuste e ative.
                  </>
                ) : (
                  <>Abra cada fluxo, confira o gatilho e ative quando quiser.</>
                )}{" "}
                O post do gatilho não vem no arquivo: escolha o seu dentro do fluxo.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!previa} className={btnPrimary}>
          {previa
            ? `Importar ${previa.length} ${previa.length === 1 ? "fluxo" : "fluxos"}`
            : "Importar"}
        </button>
        <Link href="/fluxos" className={btnSecondary}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
