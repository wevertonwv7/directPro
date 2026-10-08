"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconImage } from "./icons";

// ============================================================
// Miniatura de um post ou story
//
// Duas coisas que o <img> cru não fazia:
//
// 1. Usa o id do post, não o endereço guardado. As URLs de imagem da Meta são
//    assinadas e VENCEM em algumas semanas — por isso automações antigas iam
//    ficando com a miniatura quebrada. /api/thumb/<id> resolve o endereço na
//    hora. O endereço guardado ainda serve de primeira tentativa, porque é
//    instantâneo e na maioria das vezes ainda vale.
// 2. Quando nem assim carrega (post apagado, sem permissão), mostra um espaço
//    reservado em vez do ícone de imagem quebrada do navegador.
// ============================================================
export default function Thumb({
  src,
  mediaId,
  className = "h-11 w-11",
  rounded = "rounded-lg",
}: {
  src: string | null;
  mediaId?: string | null;
  className?: string;
  rounded?: string;
}) {
  // "guardado" → "ao vivo" → desiste. A ordem importa: começar pelo endereço
  // guardado evita uma ida à Meta por linha da lista no caso comum.
  const [tentativa, setTentativa] = useState<"guardado" | "aovivo" | "desistiu">(
    src ? "guardado" : mediaId ? "aovivo" : "desistiu"
  );

  const endereco =
    tentativa === "guardado" ? src : tentativa === "aovivo" ? `/api/thumb/${mediaId}` : null;

  const ref = useRef<HTMLImageElement>(null);
  const falhou = useCallback(
    () => setTentativa((t) => (t === "guardado" && mediaId ? "aovivo" : "desistiu")),
    [mediaId]
  );
  // A imagem chega pronta no HTML do servidor e pode falhar antes da
  // hidratação — nesse caso onError já passou e só a conferência na montagem
  // percebe. É o caso comum aqui: endereço do CDN da Meta vencido.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) falhou();
  }, [endereco, falhou]);

  if (!endereco) {
    return (
      <span
        className={`${className} ${rounded} flex shrink-0 items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600`}
      >
        <IconImage className="h-4 w-4" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={endereco}
      alt=""
      onError={falhou}
      className={`${className} ${rounded} shrink-0 object-cover`}
    />
  );
}
