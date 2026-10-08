import { skeleton } from "../../ui";

// O editor ocupa a tela inteira, então o esqueleto dele precisa ocupar também:
// barra de cima + paleta + área do mapa. É a tela que mais demorava a aparecer,
// porque é a que carrega o desenho inteiro do fluxo.
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-live="polite">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className={`${skeleton} h-8 w-8`} />
        <div className={`${skeleton} h-9 w-full max-w-xs`} />
        <div className={`${skeleton} ml-auto h-9 w-28`} />
      </div>
      <div className="relative min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-950">
        <div className="absolute left-3 top-3 flex gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`${skeleton} h-7 w-24`} />
          ))}
        </div>
        {/* dois cartões ligados: dá a forma do mapa antes de ele existir */}
        <div className="absolute left-[60px] top-[140px] flex items-center gap-[60px]">
          <div className={`${skeleton} h-24 w-[240px]`} />
          <div className={`${skeleton} h-28 w-[240px]`} />
        </div>
      </div>
    </div>
  );
}
