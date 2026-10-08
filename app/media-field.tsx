"use client";
import { useState } from "react";
import {
  MEDIA_INFO,
  MEDIA_LABEL,
  avisoDaMidia,
  tipoPelaUrl,
  type MediaKind,
} from "@/lib/media";
import { hint, label as labelCls, muted } from "./ui";
import { IconImage, IconMic, IconVideo, IconX, IconAlert } from "./icons";

const ICONE: Record<MediaKind, (p: { className?: string }) => React.ReactNode> = {
  image: IconImage,
  audio: IconMic,
  video: IconVideo,
};

const TIPOS: MediaKind[] = ["image", "audio", "video"];

// ============================================================
// Anexo de uma mensagem (imagem, áudio ou vídeo)
//
// A Meta não recebe arquivo: ela recebe um ENDEREÇO e busca o arquivo nos
// servidores dela na hora de entregar. Por isso o campo é um link, e por isso
// a prévia aqui importa tanto — ela carrega a URL do mesmo jeito que a Meta
// vai carregar. Se não aparecer aqui, não vai chegar no direct.
// ============================================================
export default function MediaField({
  kind,
  url,
  onChange,
  titulo = "Anexo",
  aviso,
}: {
  kind: MediaKind | null;
  url: string;
  onChange: (kind: MediaKind | null, url: string) => void;
  titulo?: string;
  // Aviso de contexto vindo de fora (ex.: "resposta privada não aceita anexo").
  aviso?: string;
}) {
  const [aberto, setAberto] = useState(Boolean(url));
  // A extensão do endereço só manda enquanto a pessoa não escolher um tipo à
  // mão. Sem esta marca, colar um .mp3 depois de um .mp4 mantinha "Vídeo" —
  // porque já havia um tipo definido e ele nunca era reconsiderado.
  const [escolhaManual, setEscolhaManual] = useState(false);
  const tipo = kind ?? tipoPelaUrl(url) ?? "image";
  const problema = avisoDaMidia(kind, url);
  const info = MEDIA_INFO[tipo];

  function limpar() {
    onChange(null, "");
    setEscolhaManual(false);
    setAberto(false);
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400"
      >
        <IconImage className="h-3.5 w-3.5" />
        Anexar imagem, áudio ou vídeo
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`${labelCls} mb-0`}>{titulo}</span>
        <button
          type="button"
          onClick={limpar}
          title="Tirar o anexo"
          className="rounded p-0.5 text-zinc-400 transition-colors hover:text-red-500"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex gap-1.5">
        {TIPOS.map((t) => {
          const Icone = ICONE[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setEscolhaManual(true);
                onChange(t, url);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                tipo === t
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              <Icone className="h-3.5 w-3.5" />
              {MEDIA_LABEL[t]}
            </button>
          );
        })}
      </div>

      <input
        value={url}
        onChange={(e) => {
          const novo = e.target.value.trim();
          // colar um .mp3 já marca "Áudio": obrigar a escolher de novo o que o
          // próprio endereço diz seria trabalho à toa
          const detectado = tipoPelaUrl(novo);
          onChange(escolhaManual ? tipo : (detectado ?? kind ?? tipo), novo);
        }}
        placeholder={`https://seusite.com/${info.exemplo}`}
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:ring-indigo-950"
      />

      {problema && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {problema}
        </p>
      )}
      {aviso && !problema && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {aviso}
        </p>
      )}

      {/* A prévia é o teste de verdade: ela busca o endereço igual a Meta vai
          buscar. Não apareceu aqui, não chega no direct. */}
      {/* key pela URL: trocar de endereço precisa zerar o estado de erro da
          prévia, senão um link bom fica marcado como quebrado. */}
      {url && !problema && <Previa key={url} kind={tipo} url={url} />}

      <p className={hint}>
        {info.formatos.join(", ")} · até {info.limiteMb} MB. O link precisa abrir sem login.
      </p>
    </div>
  );
}

function Previa({ kind, url }: { kind: MediaKind; url: string }) {
  const [erro, setErro] = useState(false);

  if (erro) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Não consegui abrir esse endereço. A Meta também não vai conseguir — confira se o link é
        direto para o arquivo e se ele é público.
      </p>
    );
  }

  const comum = "mt-2 w-full rounded-lg";
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="Prévia do anexo"
        onError={() => setErro(true)}
        className={`${comum} max-h-40 object-contain`}
      />
    );
  }
  if (kind === "audio") {
    return <audio src={url} controls onError={() => setErro(true)} className={`${comum} h-10`} />;
  }
  return (
    <video src={url} controls onError={() => setErro(true)} className={`${comum} max-h-40`} />
  );
}

export function ResumoDaMidia({ kind, url }: { kind: MediaKind | null; url: string }) {
  if (!url || !kind) return null;
  const Icone = ICONE[kind];
  return (
    <span className={`flex items-center gap-1 text-[10px] ${muted}`}>
      <Icone className="h-3 w-3" />
      {MEDIA_LABEL[kind]}
    </span>
  );
}
