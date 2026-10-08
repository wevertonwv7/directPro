// ============================================================
// Importar e exportar fluxos
//
// Um fluxo exportado é um arquivo .json de texto puro: dá para guardar, mandar
// por e-mail, versionar num repositório e importar em outra conta. É assim que
// um pacote de fluxos prontos chega no painel de quem comprou.
//
// O formato é deliberadamente pequeno e tolerante na LEITURA — aceita um fluxo
// solto, uma lista de fluxos ou o pacote completo — e rígido na ESCRITA, para o
// arquivo gerado hoje continuar abrindo amanhã.
//
// Este arquivo roda nos dois lados (a tela de importação mostra a prévia antes
// de gravar), por isso não importa "server-only" nem toca no banco.
// ============================================================

import { contarPendencias, normalizarGrafo, type FlowGraph } from "./flow";

export const FORMATO_ATUAL = 1;

export type FluxoPortavel = {
  name: string;
  trigger: "comment" | "story" | "dm";
  match_type: "contains" | "exact" | "any";
  keywords: string[];
  public_replies: string[];
  // Só existe no arquivo: explica para que serve o fluxo na hora de importar.
  // Não vira coluna no banco — depois de importado, quem descreve é o desenho.
  descricao?: string;
  graph: FlowGraph;
};

export type Pacote = {
  formato: number;
  gerado_em?: string;
  fluxos: FluxoPortavel[];
};

// Erro de leitura do arquivo. A mensagem é escrita para o usuário final, não
// para o console: ela aparece inteira na tela de importação.
export class ErroDeImportacao extends Error {}

// Um pacote enorme colado por engano não pode virar 400 fluxos no banco.
const MAX_FLUXOS = 30;

const TRIGGERS = ["comment", "story", "dm"] as const;
const MATCH_TYPES = ["contains", "exact", "any"] as const;

function textoCurto(v: unknown, limite: number): string {
  return typeof v === "string" ? v.trim().slice(0, limite) : "";
}

function listaDeTextos(v: unknown, maxItens: number, limite: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => textoCurto(item, limite))
    .filter(Boolean)
    .slice(0, maxItens);
}

// Aceita as três formas que um arquivo pode ter:
//   { formato: 1, fluxos: [...] }   ← pacote
//   [ {...}, {...} ]                ← lista solta
//   { name, trigger, nodes, edges } ← um fluxo só
function extrairFluxos(bruto: unknown): unknown[] {
  if (Array.isArray(bruto)) return bruto;
  if (bruto && typeof bruto === "object") {
    const obj = bruto as Record<string, unknown>;
    // "flows" em inglês também vale: é o nome que sai de exportações antigas
    const lista = obj.fluxos ?? obj.flows;
    if (Array.isArray(lista)) return lista;
    return [bruto];
  }
  throw new ErroDeImportacao("O arquivo não parece um fluxo exportado.");
}

// Normaliza UM fluxo vindo do arquivo. Tudo o que não dá para aproveitar é
// descartado em silêncio — o objetivo é sempre terminar com um fluxo que abre
// no editor, e não com um erro que o usuário não sabe consertar.
function lerFluxo(bruto: unknown, indice: number): FluxoPortavel {
  if (!bruto || typeof bruto !== "object") {
    throw new ErroDeImportacao(`O item ${indice + 1} do arquivo não é um fluxo.`);
  }
  const f = bruto as Record<string, unknown>;

  // o desenho pode vir aninhado em "graph" ou solto na raiz do fluxo
  const grafoBruto =
    f.graph && typeof f.graph === "object" ? f.graph : { nodes: f.nodes, edges: f.edges };
  const graph = normalizarGrafo(grafoBruto);
  if (graph.nodes.filter((n) => n.kind !== "start").length === 0) {
    throw new ErroDeImportacao(
      `“${textoCurto(f.name, 60) || `Item ${indice + 1}`}” não tem nenhum bloco além do gatilho.`
    );
  }

  const trigger = TRIGGERS.includes(f.trigger as (typeof TRIGGERS)[number])
    ? (f.trigger as FluxoPortavel["trigger"])
    : "comment";

  const keywords = listaDeTextos(f.keywords, 20, 60);
  let matchType = MATCH_TYPES.includes(f.match_type as (typeof MATCH_TYPES)[number])
    ? (f.match_type as FluxoPortavel["match_type"])
    : "contains";
  // Sem palavra-chave, "contém" nunca casa com nada: o fluxo entraria mudo. É
  // mais honesto salvá-lo como "qualquer mensagem", que é o que ele faz.
  if (!keywords.length) matchType = "any";

  return {
    name: textoCurto(f.name, 80) || `Fluxo importado ${indice + 1}`,
    trigger,
    match_type: matchType,
    keywords,
    // resposta pública só existe no gatilho de comentário
    public_replies: trigger === "comment" ? listaDeTextos(f.public_replies, 10, 280) : [],
    ...(textoCurto(f.descricao ?? f.description, 300)
      ? { descricao: textoCurto(f.descricao ?? f.description, 300) }
      : {}),
    graph,
  };
}

export function lerPacote(bruto: unknown): FluxoPortavel[] {
  const itens = extrairFluxos(bruto);
  if (!itens.length) throw new ErroDeImportacao("O arquivo não tem nenhum fluxo dentro.");
  if (itens.length > MAX_FLUXOS) {
    throw new ErroDeImportacao(
      `O arquivo tem ${itens.length} fluxos e o limite por importação é ${MAX_FLUXOS}.`
    );
  }
  return itens.map(lerFluxo);
}

// Ponto de entrada para texto colado ou arquivo lido: separa "JSON quebrado" de
// "JSON válido com conteúdo errado", que são dois problemas bem diferentes.
export function lerTexto(texto: string): FluxoPortavel[] {
  const limpo = texto.trim();
  if (!limpo) throw new ErroDeImportacao("Cole o conteúdo do arquivo ou escolha um .json.");
  let bruto: unknown;
  try {
    bruto = JSON.parse(limpo);
  } catch {
    throw new ErroDeImportacao(
      "Não consegui ler o arquivo: o conteúdo não é um JSON válido. Copie o arquivo inteiro, do { ao }."
    );
  }
  return lerPacote(bruto);
}

// ------------------------------------------------------------
// Exportação
// ------------------------------------------------------------

// Linha de um fluxo como ele está no banco. Tipo próprio (em vez de importar
// Flow de lib/db) para este arquivo continuar utilizável no navegador.
export type FluxoDoBanco = {
  name: string;
  trigger: string;
  match_type: string;
  keywords: string[] | null;
  public_replies: string[] | null;
  nodes: unknown;
  edges: unknown;
};

// O post e o story ficam de fora de propósito: eles são IDs de uma conta
// específica: levados para outra conta, apontariam para uma publicação que não
// existe e o fluxo nunca dispararia. Ao importar, o fluxo vale para todos os
// posts até a pessoa escolher um.
export function paraExportar(flow: FluxoDoBanco): FluxoPortavel {
  return lerFluxo(
    {
      name: flow.name,
      trigger: flow.trigger,
      match_type: flow.match_type,
      keywords: flow.keywords ?? [],
      public_replies: flow.public_replies ?? [],
      nodes: flow.nodes,
      edges: flow.edges,
    },
    0
  );
}

export function montarPacote(flows: FluxoDoBanco[]): Pacote {
  return {
    formato: FORMATO_ATUAL,
    gerado_em: new Date().toISOString(),
    fluxos: flows.map(paraExportar),
  };
}

// Nome de arquivo previsível a partir do nome do fluxo: acentos viram letras
// simples, o resto vira hífen. "Lançamento do e-book" → "lancamento-do-e-book".
export function nomeDeArquivo(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "fluxo"}.json`;
}

// ------------------------------------------------------------
// Prévia
// ------------------------------------------------------------

export const TRIGGER_LABEL: Record<string, string> = {
  comment: "Comentário",
  story: "Resposta a story",
  dm: "Mensagem no direct",
};

export type ResumoDeFluxo = {
  nome: string;
  descricao?: string;
  gatilho: string;
  palavras: string;
  blocos: number;
  // Textos e links de exemplo que a pessoa PRECISA trocar antes de ativar.
  aTrocar: number;
};

export function resumirFluxo(f: FluxoPortavel): ResumoDeFluxo {
  return {
    nome: f.name,
    ...(f.descricao ? { descricao: f.descricao } : {}),
    gatilho: TRIGGER_LABEL[f.trigger] ?? f.trigger,
    palavras:
      f.match_type === "any" ? "qualquer mensagem" : f.keywords.join(", ") || "qualquer mensagem",
    blocos: f.graph.nodes.filter((n) => n.kind !== "start").length,
    aTrocar: contarPendencias(f.graph),
  };
}

export { contarPendencias };
