"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// Foto de perfil de uma conta conectada
//
// As URLs de foto da Meta são ASSINADAS e VENCEM. A do banco foi guardada
// quando a conta foi conectada, então semanas depois ela para de abrir e o
// painel inteiro passa a mostrar só a inicial — que é melhor do que um ícone
// quebrado, mas ainda é a foto sumida.
//
// Por isso a escada de três degraus, igual à das miniaturas de post:
//   1. endereço guardado  → instantâneo, e na maioria das vezes ainda vale
//   2. /api/foto/<id>     → pede o endereço novo à Meta e grava de volta
//   3. inicial            → quando nem a Meta responde (acesso do app
//                           bloqueado, token vencido)
// ============================================================
export default function Avatar({
  src,
  name,
  accountId,
  className = "h-10 w-10",
  textClassName = "text-sm",
}: {
  src: string | null;
  name: string;
  // Sem ele não há como pedir a foto nova: fica só guardado → inicial.
  accountId?: string | null;
  className?: string;
  textClassName?: string;
}) {
  const [tentativa, setTentativa] = useState<"guardado" | "aovivo" | "inicial">(
    src ? "guardado" : accountId ? "aovivo" : "inicial"
  );
  const endereco =
    tentativa === "guardado" ? src : tentativa === "aovivo" ? `/api/foto/${accountId}` : null;

  const ref = useRef<HTMLImageElement>(null);
  const falhou = useCallback(
    () => setTentativa((t) => (t === "guardado" && accountId ? "aovivo" : "inicial")),
    [accountId]
  );
  // onError sozinho não basta: a imagem vem no HTML do servidor e pode falhar
  // ANTES de o React hidratar — aí o handler nunca chega a ser chamado.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) falhou();
  }, [endereco, falhou]);

  if (endereco) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={endereco}
        alt=""
        onError={falhou}
        className={`${className} shrink-0 rounded-full border border-zinc-200 object-cover dark:border-zinc-700`}
      />
    );
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 font-bold text-white ${textClassName}`}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
