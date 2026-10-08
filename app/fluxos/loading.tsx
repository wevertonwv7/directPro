import { skeleton } from "../ui";

// Esqueleto com o mesmo desenho da lista real (título + botões + linhas). Sem
// ele, voltar do editor para a lista deixava a tela parada no editor até o
// servidor responder — e parado é indistinguível de travado.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className={`${skeleton} h-7 w-32`} />
          <div className={`${skeleton} h-4 w-48`} />
        </div>
        <div className="flex gap-2">
          <div className={`${skeleton} h-9 w-28`} />
          <div className={`${skeleton} h-9 w-24`} />
          <div className={`${skeleton} h-9 w-28`} />
        </div>
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${skeleton} h-[76px]`} />
        ))}
      </div>
    </div>
  );
}
