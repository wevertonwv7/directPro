"use client";
import { useEffect, useState } from "react";
import Thumb from "./thumb";
import { btnGhost, btnPrimary, input, link } from "./ui";
import { IconCheck, IconImage, IconSearch, IconStory, IconX } from "./icons";

export type Media = {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  permalink?: string;
};

// O post/story escolhido, do jeito que o formulário e o editor de fluxo
// guardam: id para casar com o evento, miniatura e link para a pessoa
// reconhecer qual post é.
export type Picked = { id: string; thumb: string; caption: string; permalink: string };

export type Platform = "instagram" | "facebook";

function toPicked(m: Media): Picked {
  return {
    id: m.id,
    thumb: m.thumbnail_url ?? m.media_url ?? "",
    caption: (m.caption ?? "").slice(0, 120),
    permalink: m.permalink ?? "",
  };
}

// Seletor visual de posts/reels ou stories da conta conectada.
//
// É um diálogo em tela cheia (e não mais uma caixinha embutida) porque escolher
// o post é uma decisão visual: a pessoa reconhece a publicação pela imagem, não
// pelo id. Miniaturas grandes, a escolha destacada e um botão de confirmar —
// para dar tempo de conferir a legenda antes de fechar.
//
// Dois caminhos para chegar no mesmo post, porque quem publica muito não achava
// o post antigo numa grade de um lote só:
// 1. rolar a grade e pedir mais lotes ("Carregar mais", via cursor da Meta);
// 2. colar o link do post — o app procura e traz o post certo, com a miniatura.
export default function MediaPicker({
  kind,
  selected,
  onSelect,
  platform,
}: {
  kind: "posts" | "stories";
  selected: Picked | null;
  onSelect: (m: Picked | null) => void;
  platform: Platform;
}) {
  const [media, setMedia] = useState<Media[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkColado, setLinkColado] = useState("");
  const [buscandoLink, setBuscandoLink] = useState(false);
  const [erroLink, setErroLink] = useState("");
  // Destaque dentro do diálogo, antes de confirmar. Só ao clicar em "Usar" é
  // que a escolha sai para o formulário — assim dá para conferir a legenda.
  const [rascunho, setRascunho] = useState<Media | null>(null);
  const isStories = kind === "stories";
  const rotulo = isStories ? "story" : "post";

  const exemploDeLink =
    platform === "facebook"
      ? "https://www.facebook.com/suapagina/posts/123456789"
      : "https://www.instagram.com/p/Cxxxxxxxxxx/";

  async function carregar(after?: string | null) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (isStories) params.set("type", "stories");
      if (after) params.set("after", after);
      const res = await fetch(`/api/media${params.size ? `?${params}` : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "erro ao buscar mídias");
      setMedia((atual) => (after ? [...atual, ...(json.media ?? [])] : (json.media ?? [])));
      setCursor(json.after ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setLoading(false);
    }
  }

  function abrir() {
    setOpen(true);
    setRascunho(null);
    if (!media.length) void carregar();
  }

  function fechar() {
    setOpen(false);
    setRascunho(null);
    setErroLink("");
  }

  function confirmar() {
    if (!rascunho) return;
    onSelect(toPicked(rascunho));
    fechar();
  }

  // Esc fecha o diálogo, como em qualquer modal.
  useEffect(() => {
    if (!open) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    window.addEventListener("keydown", aoTeclar);
    // trava a rolagem do fundo enquanto o diálogo está aberto
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = "";
    };
  }, [open]);

  // Busca o post pelo link colado. O servidor é quem procura: só ele tem o
  // token, e o post precisa ser desta conta para o gatilho funcionar.
  async function buscarPeloLink() {
    const url = linkColado.trim();
    if (!url) return;
    setBuscandoLink(true);
    setErroLink("");
    try {
      const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "não achei esse post");
      const achado = json.media?.[0] as Media | undefined;
      if (!achado) throw new Error("não achei esse post");
      // link colado já é uma escolha explícita: confirma direto
      onSelect(toPicked(achado));
      setLinkColado("");
      fechar();
    } catch (err) {
      setErroLink(err instanceof Error ? err.message : "erro");
    } finally {
      setBuscandoLink(false);
    }
  }

  // ---------- estado recolhido: já tem um post escolhido ----------
  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <Thumb
          src={selected.thumb || null}
          mediaId={selected.id}
          className="h-16 w-16 border border-zinc-200 dark:border-zinc-700"
          rounded="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {selected.caption || `Seu ${rotulo} selecionado`}
          </p>
          {selected.permalink && (
            <a
              href={selected.permalink}
              target="_blank"
              rel="noreferrer"
              className={`mt-0.5 inline-block text-xs ${link}`}
            >
              Ver publicação ↗
            </a>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={abrir} className={btnGhost}>
            Trocar
          </button>
          <button type="button" onClick={() => onSelect(null)} className={btnGhost}>
            Remover
          </button>
        </div>
        {open && dialogo()}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={abrir}
        className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-indigo-500"
      >
        {isStories ? <IconStory className="h-4 w-4" /> : <IconImage className="h-4 w-4" />}
        {isStories ? "Escolher um story" : "Escolher um post"}
      </button>
      {open && dialogo()}
    </div>
  );

  // ---------- o diálogo ----------
  function dialogo() {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={fechar}
        role="dialog"
        aria-modal="true"
        aria-label={`Escolher ${rotulo}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[85vh] sm:rounded-2xl dark:bg-zinc-900"
        >
          {/* cabeçalho */}
          <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-950/60">
              {isStories ? <IconStory className="h-5 w-5" /> : <IconImage className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {isStories ? "Escolher um story" : "Escolher um post"}
              </h2>
              <p className="text-xs text-zinc-500">
                {isStories
                  ? "Só stories no ar aparecem (duram 24h)."
                  : "Toque no post e confirme embaixo."}
              </p>
            </div>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          {/* colar link (só posts) */}
          {!isStories && (
            <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950/60">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <IconSearch className="h-3.5 w-3.5" />
                Já tem o link do post? Cole aqui para achar direto
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="url"
                  value={linkColado}
                  onChange={(e) => setLinkColado(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void buscarPeloLink();
                    }
                  }}
                  placeholder={exemploDeLink}
                  className={`${input} min-w-0 flex-1 py-1.5 text-xs`}
                />
                <button
                  type="button"
                  onClick={buscarPeloLink}
                  disabled={buscandoLink || !linkColado.trim()}
                  className={`${btnGhost} disabled:opacity-50`}
                >
                  {buscandoLink ? "Procurando…" : "Buscar"}
                </button>
              </div>
              {erroLink && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{erroLink}</p>}
            </div>
          )}

          {/* grade */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading && !media.length && (
              <div
                className={`grid gap-3 ${
                  isStories ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
                }`}
              >
                {Array.from({ length: isStories ? 8 : 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800 ${
                      isStories ? "aspect-[9/16]" : "aspect-square"
                    }`}
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </div>
            )}

            {!loading && !error && media.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                  {isStories ? <IconStory className="h-6 w-6" /> : <IconImage className="h-6 w-6" />}
                </span>
                <p className="text-sm text-zinc-500">
                  {isStories
                    ? "Nenhum story no ar agora. Publique um story e ele aparece aqui."
                    : "Nenhum post encontrado nesta conta."}
                </p>
              </div>
            )}

            <div
              className={`grid gap-3 ${
                isStories ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
              }`}
            >
              {media.map((m) => {
                const escolhido = rascunho?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setRascunho(m)}
                    onDoubleClick={() => {
                      onSelect(toPicked(m));
                      fechar();
                    }}
                    title={m.caption ?? undefined}
                    className={`group relative overflow-hidden rounded-xl border-2 text-left transition-all ${
                      escolhido
                        ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900"
                        : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    <Thumb
                      src={m.thumbnail_url ?? m.media_url ?? null}
                      mediaId={m.id}
                      className={`w-full ${isStories ? "aspect-[9/16]" : "aspect-square"}`}
                      rounded="rounded-[10px]"
                    />
                    {/* marca de selecionado */}
                    {escolhido && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-white shadow-md">
                        <IconCheck className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {/* legenda no rodapé da miniatura, para diferenciar posts parecidos */}
                    {m.caption && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-[10px] leading-tight text-white">
                        {m.caption}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {cursor && !isStories && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => void carregar(cursor)}
                  disabled={loading}
                  className={`${btnGhost} disabled:opacity-50`}
                >
                  {loading ? "Carregando…" : "Carregar mais posts"}
                </button>
              </div>
            )}
          </div>

          {/* rodapé: o que está escolhido + confirmar */}
          <div className="flex shrink-0 items-center gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {rascunho ? (
                <>
                  Escolhido:{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {rascunho.caption || `um ${rotulo}`}
                  </span>
                </>
              ) : media.length ? (
                // "storys" é plural errado; para story diz só "no ar"
                isStories
                  ? `${media.length} no ar · toque em um para escolher`
                  : `${media.length} posts · toque em um para escolher`
              ) : (
                ""
              )}
            </p>
            <button type="button" onClick={fechar} className={btnGhost}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={!rascunho}
              className={`${btnPrimary} disabled:opacity-40`}
            >
              Usar este {rotulo}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
