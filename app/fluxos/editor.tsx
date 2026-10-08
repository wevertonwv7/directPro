"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MessageField from "../automacoes/variable-picker";
import MediaPicker, { type Picked, type Platform } from "../media-picker";
import MediaField from "../media-field";
import { MEDIA_LABEL } from "@/lib/media";
import { salvarFluxo } from "./actions";
import {
  NODE_DESC,
  NODE_LABEL,
  avisosDoGrafo,
  novoGrafo,
  proximoNo,
  ramifica,
  saidasDoNo,
  START_NODE_ID,
  type FlowButton,
  type FlowGraph,
  type FlowNode,
  type FlowNodeKind,
} from "@/lib/flow";
import { btnGhost, btnPrimary, hint, input, label, muted } from "../ui";
import {
  IconComment,
  IconStory,
  IconSend,
  IconClock,
  IconMail,
  IconUsers,
  IconX,
  IconAlert,
  IconChevronLeft,
  IconUndo,
} from "../icons";

export type FlowData = {
  id: string;
  name: string;
  active: boolean;
  trigger: "comment" | "story" | "dm";
  keywords: string[];
  match_type: "contains" | "exact" | "any";
  media_id: string | null;
  media_thumbnail_url: string | null;
  media_caption: string | null;
  media_permalink: string | null;
  story_id: string | null;
  story_thumbnail_url: string | null;
  public_replies: string[];
  graph: FlowGraph;
};

export type Account = { username: string | null; platform: Platform };

const LARGURA_BLOCO = 240;
const GRADE = 10; // arraste encaixa nesta grade: alinha os blocos sem esforço
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
// Faixa da borda que puxa o mapa quando se arrasta um bloco (ou uma ligação)
// para fora da área visível. Sem isto, ligar um bloco a outro que está fora da
// tela é impossível: não dá para arrastar e navegar ao mesmo tempo.
const BORDA_ARRASTO = 56;
const VELOCIDADE_BORDA = 14;
const MAX_HISTORICO = 60;

const ICONE: Record<FlowNodeKind, (p: { className?: string }) => React.ReactNode> = {
  start: IconComment,
  message: IconSend,
  delay: IconClock,
  ask_email: IconMail,
  follow_gate: IconUsers,
  tag: IconStory,
};

// Cor por tipo de bloco: com tudo cinza, o mapa vira um monte de retângulo
// igual e a pessoa perde o passo que estava procurando.
const COR: Record<FlowNodeKind, string> = {
  start: "border-indigo-400 dark:border-indigo-500",
  message: "border-sky-300 dark:border-sky-700",
  delay: "border-amber-300 dark:border-amber-700",
  ask_email: "border-emerald-300 dark:border-emerald-700",
  follow_gate: "border-violet-300 dark:border-violet-700",
  tag: "border-fuchsia-300 dark:border-fuchsia-700",
};

const ADICIONAVEIS: FlowNodeKind[] = [
  "message",
  "delay",
  "ask_email",
  "follow_gate",
  "tag",
];

// Curva entre dois pontos. Bezier horizontal: a linha sai pela direita do bloco
// e entra pela esquerda do seguinte, então a leitura é sempre da esquerda para
// a direita, mesmo quando o destino está acima.
function curva(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Altura estimada do bloco, para posicionar as saídas e as curvas. É estimada
// de propósito: medir o DOM de cada bloco a cada render deixaria o arraste
// travado, e um erro de alguns pixels na curva não atrapalha ninguém.
function alturaDoBloco(n: FlowNode): number {
  if (n.kind === "start") return 96;
  if (n.kind === "delay" || n.kind === "tag") return 84;
  const linhasDeTexto = Math.min(4, Math.ceil((n.text?.length ?? 0) / 34) || 1);
  const botoes = n.kind === "message" ? (n.buttons?.length ?? 0) : n.kind === "follow_gate" ? 1 : 0;
  return 64 + linhasDeTexto * 16 + botoes * 30;
}

function posicaoDaSaida(n: FlowNode, handle: string): { dx: number; dy: number } {
  const saidas = saidasDoNo(n);
  const i = Math.max(0, saidas.findIndex((s) => s.handle === handle));
  if (saidas.length === 1) return { dx: LARGURA_BLOCO, dy: alturaDoBloco(n) / 2 };
  // uma saída por caminho, distribuídas na lateral direita do cartão
  const base = alturaDoBloco(n) - (saidas.length * 30 - 15);
  return { dx: LARGURA_BLOCO, dy: base + i * 30 };
}

// Onde encaixar um bloco novo: à direita do bloco selecionado (o passo seguinte
// nasce perto do atual), descendo até achar espaço vazio. Sem isto, os blocos
// nasciam uns por cima dos outros e clicar num deles selecionava o de baixo.
function posicaoLivre(nodes: FlowNode[], referencia?: FlowNode | null): { x: number; y: number } {
  if (!nodes.length) return { x: 80, y: 100 };
  const x = referencia ? referencia.x + 300 : Math.max(...nodes.map((n) => n.x)) + 300;
  let y = referencia ? referencia.y : Math.min(...nodes.map((n) => n.y));
  while (nodes.some((n) => Math.abs(n.x - x) < 260 && Math.abs(n.y - y) < 150)) {
    y += 160;
  }
  return { x, y };
}

// Arruma o mapa em árvore: uma coluna por profundidade a partir do gatilho.
// Depois de muita ligação e arraste, o desenho vira macarrão — isto devolve a
// leitura da esquerda para a direita sem a pessoa reposicionar bloco a bloco.
function organizar(graph: FlowGraph): FlowNode[] {
  const start = graph.nodes.find((n) => n.kind === "start");
  const profundidade = new Map<string, number>();
  if (start) {
    const fila: [string, number][] = [[start.id, 0]];
    while (fila.length) {
      const [id, d] = fila.shift()!;
      if (profundidade.has(id)) continue;
      profundidade.set(id, d);
      for (const e of graph.edges.filter((e) => e.from === id)) fila.push([e.to, d + 1]);
    }
  }
  // blocos soltos vão para uma faixa própria, depois da última coluna
  const maiorD = Math.max(0, ...profundidade.values());
  const porColuna = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const d = profundidade.get(n.id) ?? maiorD + 1;
    porColuna.set(d, [...(porColuna.get(d) ?? []), n.id]);
  }
  const posicoes = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of porColuna) {
    ids.forEach((id, i) => posicoes.set(id, { x: 60 + d * 320, y: 120 + i * 180 }));
  }
  return graph.nodes.map((n) => ({ ...n, ...(posicoes.get(n.id) ?? {}) }));
}

export default function FlowEditor({
  flow,
  account,
}: {
  flow: FlowData | null;
  account: Account | null;
}) {
  const platform: Platform = account?.platform ?? "instagram";
  const facebook = platform === "facebook";

  // ---------- gatilho ----------
  const [name, setName] = useState(flow?.name ?? "");
  const [active, setActive] = useState(flow?.active ?? true);
  const [trigger, setTrigger] = useState<FlowData["trigger"]>(
    flow?.trigger === "story" && facebook ? "comment" : (flow?.trigger ?? "comment")
  );
  const [keywords, setKeywords] = useState(flow?.keywords.join(", ") ?? "");
  const [matchType, setMatchType] = useState(flow?.match_type ?? "contains");
  const [publicReplies, setPublicReplies] = useState(flow?.public_replies.join("\n") ?? "");
  const [post, setPost] = useState<Picked | null>(
    flow?.media_id
      ? {
          id: flow.media_id,
          thumb: flow.media_thumbnail_url ?? "",
          caption: flow.media_caption ?? "",
          permalink: flow.media_permalink ?? "",
        }
      : null
  );
  const [story, setStory] = useState<Picked | null>(
    flow?.story_id
      ? { id: flow.story_id, thumb: flow.story_thumbnail_url ?? "", caption: "", permalink: "" }
      : null
  );

  // ---------- desenho ----------
  const [graph, setGraph] = useState<FlowGraph>(flow?.graph ?? novoGrafo());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // ligação em andamento: a pessoa clicou numa saída e agora escolhe o destino
  const [ligando, setLigando] = useState<{ from: string; handle: string } | null>(null);
  // Ponta solta da linha enquanto se arrasta, em coordenadas do mapa. null =
  // ninguém está arrastando uma ligação agora.
  const [pontaLivre, setPontaLivre] = useState<{ x: number; y: number } | null>(null);
  const [vista, setVista] = useState({ x: 0, y: 0, zoom: 1 });
  const [verAvisos, setVerAvisos] = useState(false);
  // Bloco sob o cursor durante o arraste de uma ligação: destacar só o alvo de
  // verdade (em vez de todos os candidatos) diz onde a linha vai cair.
  const [alvoSobUsuario, setAlvoSobUsuario] = useState<string | null>(null);
  // Ligação sob o ponteiro: é o que revela o × de remover, para as bolinhas de
  // apagar não ficarem espalhadas pelo mapa inteiro o tempo todo.
  const [ligacaoSobUsuario, setLigacaoSobUsuario] = useState<string | null>(null);
  const [espaco, setEspaco] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  // Espelho da vista para ler o valor atual dentro de handlers de ponteiro sem
  // recriá-los a cada quadro (e sem ler estado dentro de um setState, que roda
  // duas vezes no modo estrito do React).
  const vistaRef = useRef(vista);
  useEffect(() => {
    vistaRef.current = vista;
  }, [vista]);
  // Última posição do ponteiro, em coordenadas da tela: o empurrão de borda
  // reaproveita a mesma conta do arraste normal a cada quadro.
  const ponteiroRef = useRef({ x: 0, y: 0 });
  const espacoRef = useRef(false);
  // Ponteiros encostados na tela: com dois, o gesto vira pinça (ampliar/mover).
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const empurrao = useRef(0);
  // arraste em curso (bloco ou fundo). Fica em ref porque muda a cada
  // movimento do ponteiro e não precisa redesenhar nada sozinho.
  const arraste = useRef<
    | { tipo: "bloco"; id: string; dx: number; dy: number }
    | { tipo: "fundo"; x: number; y: number; vx: number; vy: number }
    // ligação sendo puxada de uma saída até um bloco; `moveu` distingue o
    // arraste do clique simples (que mantém o modo "clique e escolha")
    | { tipo: "ligacao"; from: string; handle: string; x: number; y: number; moveu: boolean }
    | null
  >(null);

  // Contador simples para os ids dos blocos novos. Nada de relógio nem sorteio:
  // o id só precisa ser único dentro deste desenho.
  const sequencia = useRef(0);
  function novoId(nodes: FlowNode[]): string {
    let id = "";
    do {
      sequencia.current += 1;
      id = `b${sequencia.current}`;
    } while (nodes.some((n) => n.id === id));
    return id;
  }

  const noSelecionado = graph.nodes.find((n) => n.id === selecionado) ?? null;
  const avisos = avisosDoGrafo(graph, trigger);
  // Bloco logo depois do gatilho: no gatilho de comentário é ele que vira a
  // resposta privada, a única mensagem que fura a janela de 24h — e a única
  // que não aceita anexo.
  const primeiraMensagem = proximoNo(graph, START_NODE_ID);

  // ---------- desfazer e refazer ----------
  //
  // O histórico observa o desenho em vez de ser alimentado por cada função que
  // mexe nele. Assim toda alteração entra sozinha — inclusive as que vierem
  // depois — e a pausa de 400 ms junta o que é obviamente um gesto só: digitar
  // uma frase inteira vira UM passo, não trinta, e arrastar um bloco guarda a
  // posição final, não o rastro.
  const [hist, setHist] = useState<{ lista: FlowGraph[]; i: number }>(() => ({
    lista: [flow?.graph ?? novoGrafo()],
    i: 0,
  }));
  // marca as mudanças que o próprio desfazer provocou, para não regravá-las
  const voltandoNoTempo = useRef(false);

  useEffect(() => {
    if (voltandoNoTempo.current) {
      voltandoNoTempo.current = false;
      return;
    }
    const t = setTimeout(() => {
      setHist((h) => {
        if (JSON.stringify(h.lista[h.i]) === JSON.stringify(graph)) return h;
        // refazer só existe até a próxima alteração: daqui para frente o
        // futuro que estava guardado deixou de ser alcançável
        const lista = [...h.lista.slice(0, h.i + 1), graph].slice(-MAX_HISTORICO);
        return { lista, i: lista.length - 1 };
      });
    }, 400);
    return () => clearTimeout(t);
  }, [graph]);

  const podeDesfazer = hist.i > 0;
  const podeRefazer = hist.i < hist.lista.length - 1;

  const andarNoHistorico = useCallback(
    (passo: number) => {
      const i = hist.i + passo;
      if (i < 0 || i >= hist.lista.length || hist.lista[i] === graph) return;
      voltandoNoTempo.current = true;
      setGraph(hist.lista[i]);
      setHist((h) => ({ ...h, i }));
      setLigando(null);
    },
    [hist, graph]
  );

  function atualizarNo(id: string, muda: Partial<FlowNode>) {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...muda } : n)),
    }));
  }

  function conteudoPadrao(kind: FlowNodeKind): Partial<FlowNode> {
    if (kind === "message") return { text: "", buttonMode: "reply", buttons: [] };
    if (kind === "delay") return { minutes: 60 };
    if (kind === "ask_email") return { text: "Me manda seu melhor e-mail 👇" };
    if (kind === "follow_gate")
      return { text: "Antes de continuar, me segue lá 🙏", buttonLabel: "Já sigo! ✅" };
    if (kind === "tag") return { tag: "" };
    return {};
  }

  function adicionarBloco(kind: FlowNodeKind) {
    const id = novoId(graph.nodes);
    const { x, y } = posicaoLivre(graph.nodes, noSelecionado);
    const novo: FlowNode = { id, kind, x, y, ...conteudoPadrao(kind) };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, novo] }));
    setSelecionado(id);
    trazerParaAVista(x, y);
  }

  function duplicarBloco(id: string) {
    const original = graph.nodes.find((n) => n.id === id);
    if (!original || original.kind === "start") return;
    const novo: FlowNode = {
      ...original,
      id: novoId(graph.nodes),
      x: original.x + 40,
      y: original.y + 60,
    };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, novo] }));
    setSelecionado(novo.id);
  }

  // Bloco novo tem que aparecer na tela, senão parece que o clique não fez
  // nada. Só desloca o mapa quando ele realmente caiu fora da área visível.
  function trazerParaAVista(x: number, y: number) {
    const area = areaRef.current;
    if (!area) return;
    setVista((v) => {
      const px = x * v.zoom + v.x;
      const py = y * v.zoom + v.y;
      const margem = 24;
      // desloca só o necessário: jogar a vista para o bloco novo faria os
      // outros sumirem da tela, e aí a pessoa perde a noção do mapa
      const larg = LARGURA_BLOCO * v.zoom;
      const alt = 140 * v.zoom;
      const dx =
        px < margem
          ? margem - px
          : px + larg > area.clientWidth - margem
            ? area.clientWidth - margem - larg - px
            : 0;
      const dy =
        py < margem
          ? margem - py
          : py + alt > area.clientHeight - margem
            ? area.clientHeight - margem - alt - py
            : 0;
      if (!dx && !dy) return v;
      return { ...v, x: v.x + dx, y: v.y + dy };
    });
  }

  function apagarBloco(id: string) {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelecionado((s) => (s === id ? null : s));
  }

  // Ligar é em dois toques (clica na saída, clica no bloco de destino) em vez
  // de arrastar: funciona igual no celular e não exige mira fina.
  function ligarBlocos(from: string, handle: string, destino: string) {
    if (from === destino) {
      setLigando(null);
      return;
    }
    setGraph((g) => ({
      ...g,
      edges: [
        // uma saída leva a um lugar só: religar troca o destino
        ...g.edges.filter((e) => !(e.from === from && e.handle === handle)),
        { from, handle, to: destino },
      ],
    }));
    setLigando(null);
  }

  function concluirLigacao(destino: string) {
    if (!ligando) return;
    ligarBlocos(ligando.from, ligando.handle, destino);
  }

  function apagarLigacao(from: string, handle: string) {
    setGraph((g) => ({
      ...g,
      edges: g.edges.filter((e) => !(e.from === from && e.handle === handle)),
    }));
  }

  // ---------- arraste e deslocamento ----------

  // Amplia mantendo fixo um ponto da TELA (o cursor, o meio da pinça ou o
  // centro da área). Sem isso, os botões + e − ampliavam a partir do canto
  // superior esquerdo e o que se estava olhando fugia da vista.
  const aplicarZoom = useCallback((novoZoom: number, foco?: { x: number; y: number }) => {
    const area = areaRef.current;
    setVista((v) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, novoZoom));
      if (zoom === v.zoom) return v;
      const fx = foco?.x ?? (area ? area.clientWidth / 2 : 0);
      const fy = foco?.y ?? (area ? area.clientHeight / 2 : 0);
      return {
        zoom,
        x: fx - ((fx - v.x) / v.zoom) * zoom,
        y: fy - ((fy - v.y) / v.zoom) * zoom,
      };
    });
  }, []);

  // Converte uma posição da tela na posição correspondente do mapa.
  const paraOMapa = useCallback((clientX: number, clientY: number) => {
    const area = areaRef.current?.getBoundingClientRect();
    const v = vistaRef.current;
    if (!area) return { x: 0, y: 0 };
    return { x: (clientX - area.left - v.x) / v.zoom, y: (clientY - area.top - v.y) / v.zoom };
  }, []);

  // O arraste em curso aplicado a uma posição de ponteiro. Fica separado do
  // evento porque o empurrão de borda precisa refazer a mesma conta a cada
  // quadro, com a vista já deslocada e o ponteiro parado.
  const aplicarPonteiro = useCallback(
    (clientX: number, clientY: number) => {
      const a = arraste.current;
      if (!a) return;
      if (a.tipo === "bloco") {
        const p = paraOMapa(clientX, clientY);
        const x = Math.round((p.x - a.dx) / GRADE) * GRADE;
        const y = Math.round((p.y - a.dy) / GRADE) * GRADE;
        setGraph((g) => ({
          ...g,
          nodes: g.nodes.map((n) => (n.id === a.id ? { ...n, x, y } : n)),
        }));
      } else if (a.tipo === "ligacao") {
        setPontaLivre(paraOMapa(clientX, clientY));
        // destaca o bloco que está de fato sob o dedo/cursor
        const sob = (
          document.elementFromPoint(clientX, clientY) as HTMLElement | null
        )?.closest("[data-no]");
        const id = sob?.getAttribute("data-no") ?? null;
        setAlvoSobUsuario(id && id !== a.from ? id : null);
      } else {
        setVista((v) => ({ ...v, x: a.vx + (clientX - a.x), y: a.vy + (clientY - a.y) }));
      }
    },
    [paraOMapa]
  );

  // Empurra o mapa enquanto o arraste encosta na borda. Roda em quadros, e não
  // por evento, porque com o ponteiro parado na borda não chega mais evento
  // nenhum — e é exatamente aí que o mapa precisa continuar andando.
  const pararEmpurrao = useCallback(() => {
    if (empurrao.current) cancelAnimationFrame(empurrao.current);
    empurrao.current = 0;
  }, []);

  const comecarEmpurrao = useCallback(() => {
    pararEmpurrao();
    const passo = () => {
      const a = arraste.current;
      const r = areaRef.current?.getBoundingClientRect();
      if (!a || a.tipo === "fundo" || !r) return pararEmpurrao();
      const { x, y } = ponteiroRef.current;
      let dx = 0;
      let dy = 0;
      if (x - r.left < BORDA_ARRASTO) dx = VELOCIDADE_BORDA;
      else if (r.right - x < BORDA_ARRASTO) dx = -VELOCIDADE_BORDA;
      if (y - r.top < BORDA_ARRASTO) dy = VELOCIDADE_BORDA;
      else if (r.bottom - y < BORDA_ARRASTO) dy = -VELOCIDADE_BORDA;
      if (dx || dy) {
        setVista((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        // a vista andou, então o ponto do mapa sob o ponteiro mudou
        requestAnimationFrame(() => aplicarPonteiro(x, y));
      }
      empurrao.current = requestAnimationFrame(passo);
    };
    empurrao.current = requestAnimationFrame(passo);
  }, [aplicarPonteiro, pararEmpurrao]);

  // Registra o arraste e liga o empurrão de borda de uma vez só: são sempre
  // usados juntos, e esquecer o segundo é o tipo de erro que só aparece quando
  // o bloco de destino está fora da tela.
  const iniciarArraste = useCallback(
    (a: NonNullable<typeof arraste.current>, clientX: number, clientY: number) => {
      arraste.current = a;
      ponteiroRef.current = { x: clientX, y: clientY };
      if (a.tipo !== "fundo") comecarEmpurrao();
    },
    [comecarEmpurrao]
  );

  const aoMover = useCallback(
    (e: PointerEvent) => {
      if (ponteiros.current.has(e.pointerId)) {
        ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // Pinça tem precedência: com dois dedos na tela ninguém quer arrastar um
      // bloco, quer ampliar.
      if (pinca.current && ponteiros.current.size >= 2) {
        const [p1, p2] = [...ponteiros.current.values()];
        const r = areaRef.current?.getBoundingClientRect();
        if (!r) return;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const anterior = pinca.current;
        pinca.current = { dist, cx, cy };
        setVista((v) => {
          const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (v.zoom * dist) / anterior.dist));
          const fx = cx - r.left;
          const fy = cy - r.top;
          const razao = zoom / v.zoom;
          return {
            zoom,
            // amplia em torno do meio dos dois dedos e acompanha o arrastar deles
            x: fx - (fx - v.x) * razao + (cx - anterior.cx),
            y: fy - (fy - v.y) * razao + (cy - anterior.cy),
          };
        });
        return;
      }
      const a = arraste.current;
      if (!a) return;
      ponteiroRef.current = { x: e.clientX, y: e.clientY };
      if (a.tipo === "ligacao" && Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) > 4) {
        a.moveu = true;
      }
      aplicarPonteiro(e.clientX, e.clientY);
    },
    [aplicarPonteiro]
  );

  useEffect(() => {
    const soltar = (e: PointerEvent) => {
      ponteiros.current.delete(e.pointerId);
      if (ponteiros.current.size < 2) pinca.current = null;
      const a = arraste.current;
      arraste.current = null;
      pararEmpurrao();
      if (a?.tipo !== "ligacao") return;
      setPontaLivre(null);
      setAlvoSobUsuario(null);
      // Clique curto (sem arrastar) mantém o modo de dois toques: a saída fica
      // "armada" e o próximo clique num bloco fecha a ligação. É o que faz o
      // recurso continuar utilizável no celular.
      if (!a.moveu) return;
      const alvo = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        "[data-no]"
      );
      const destino = alvo?.getAttribute("data-no");
      // soltou no vazio: desarma, em vez de deixar a linha pendurada
      if (!destino) return setLigando(null);
      ligarBlocos(a.from, a.handle, destino);
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [aoMover, pararEmpurrao]);

  // Roda do mouse: como no Figma — rolar desloca, Ctrl/⌘ + rolar amplia no
  // ponto do cursor. Precisa de listener não passivo para poder cancelar a
  // rolagem da página.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = area.getBoundingClientRect();
        // passo proporcional ao gesto: a pinça do trackpad manda deltas
        // pequenos e contínuos, a roda do mouse manda saltos grandes
        const fator = Math.exp(-e.deltaY / 260);
        aplicarZoom(vistaRef.current.zoom * fator, {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        });
        return;
      }
      setVista((v) =>
        e.shiftKey
          ? { ...v, x: v.x - e.deltaY - e.deltaX }
          : { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }
      );
    };
    area.addEventListener("wheel", aoRolar, { passive: false });
    return () => area.removeEventListener("wheel", aoRolar);
  }, [aplicarZoom]);

  // Ajusta o mapa inteiro à área visível: com o fluxo crescendo para a direita,
  // só reposicionar (sem reduzir o zoom) deixava blocos fora da tela.
  const ajustarATela = useCallback(() => {
    const area = areaRef.current;
    if (!graph.nodes.length || !area) return setVista({ x: 0, y: 0, zoom: 1 });
    const minX = Math.min(...graph.nodes.map((n) => n.x));
    const minY = Math.min(...graph.nodes.map((n) => n.y));
    const maxX = Math.max(...graph.nodes.map((n) => n.x + LARGURA_BLOCO));
    const maxY = Math.max(...graph.nodes.map((n) => n.y + alturaDoBloco(n)));
    const margem = 48;
    const zoom = Math.min(
      1,
      Math.max(
        ZOOM_MIN,
        Math.min(
          (area.clientWidth - margem * 2) / Math.max(1, maxX - minX),
          (area.clientHeight - margem * 2) / Math.max(1, maxY - minY)
        )
      )
    );
    setVista({
      zoom,
      x: margem - minX * zoom,
      y: (area.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  }, [graph.nodes]);

  // Teclado: Esc cancela, Delete apaga, Ctrl/⌘+D duplica. Nunca enquanto a
  // pessoa digita num campo — apagar o bloco no meio de uma frase seria cruel.
  useEffect(() => {
    const digitando = (alvo: EventTarget | null) => {
      const el = alvo as HTMLElement | null;
      const tag = el?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLigando(null);
        setSelecionado(null);
        return;
      }
      // Desfazer vale mesmo com o cursor num campo de texto: é lá que a pessoa
      // mais erra, e o navegador só desfaria o campo, não o desenho.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        andarNoHistorico(e.shiftKey ? 1 : -1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        andarNoHistorico(1);
        return;
      }
      if (digitando(e.target)) return;

      if (e.code === "Space" && !espacoRef.current) {
        // segurar espaço navega o mapa a partir de qualquer ponto, inclusive
        // de cima de um bloco — sem isso, mapa cheio não tem fundo para pegar
        e.preventDefault();
        espacoRef.current = true;
        setEspaco(true);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selecionado) {
        e.preventDefault();
        apagarBloco(selecionado);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selecionado) {
        e.preventDefault();
        duplicarBloco(selecionado);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        aplicarZoom(vistaRef.current.zoom * 1.2);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        aplicarZoom(vistaRef.current.zoom / 1.2);
      }
      if (e.key === "0") aplicarZoom(1);
      if (e.key.toLowerCase() === "f") ajustarATela();

      // setas empurram o bloco selecionado de um passo da grade (Shift = dez):
      // encostar dois blocos com precisão no arraste é sofrido
      if (selecionado && e.key.startsWith("Arrow")) {
        const no = graph.nodes.find((n) => n.id === selecionado);
        if (!no) return;
        e.preventDefault();
        const passo = (e.shiftKey ? 10 : 1) * GRADE;
        const d: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const [ex, ey] = d[e.key] ?? [0, 0];
        atualizarNo(selecionado, { x: no.x + ex * passo, y: no.y + ey * passo });
      }
    };
    const aoSoltarTecla = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      espacoRef.current = false;
      setEspaco(false);
    };
    // perder o foco da janela com o espaço afundado deixaria o mapa preso no
    // modo de navegação, sem tecla que o solte
    const aoSairDaJanela = () => {
      espacoRef.current = false;
      setEspaco(false);
    };
    window.addEventListener("keydown", aoTeclar);
    window.addEventListener("keyup", aoSoltarTecla);
    window.addEventListener("blur", aoSairDaJanela);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("keyup", aoSoltarTecla);
      window.removeEventListener("blur", aoSairDaJanela);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionado, graph, andarNoHistorico, aplicarZoom, ajustarATela]);

  const gatilhos = facebook
    ? ([
        { value: "comment", icon: IconComment, titulo: "Comentário no post da página" },
        { value: "dm", icon: IconSend, titulo: "Mensagem no Messenger" },
      ] as const)
    : ([
        { value: "comment", icon: IconComment, titulo: "Comentário em post/reels" },
        { value: "story", icon: IconStory, titulo: "Resposta a story" },
        { value: "dm", icon: IconSend, titulo: "DM recebida" },
      ] as const);

  return (
    <form action={salvarFluxo} className="flex h-full min-h-0 flex-col">
      <input type="hidden" name="id" defaultValue={flow?.id ?? ""} />
      {/* O desenho viaja como JSON num campo escondido: é o editor inteiro
          resumido em um valor só, salvo junto com o resto do formulário. */}
      <input type="hidden" name="graph" value={JSON.stringify(graph)} readOnly />
      <input type="hidden" name="trigger" value={trigger} readOnly />
      <input type="hidden" name="media_id" value={post?.id ?? ""} readOnly />
      <input type="hidden" name="media_thumbnail_url" value={post?.thumb ?? ""} readOnly />
      <input type="hidden" name="media_caption" value={post?.caption ?? ""} readOnly />
      <input type="hidden" name="media_permalink" value={post?.permalink ?? ""} readOnly />
      <input type="hidden" name="story_id" value={story?.id ?? ""} readOnly />
      <input type="hidden" name="story_thumbnail_url" value={story?.thumb ?? ""} readOnly />
      <input type="hidden" name="keywords" value={keywords} readOnly />
      <input type="hidden" name="match_type" value={matchType} readOnly />
      <input type="hidden" name="public_replies" value={publicReplies} readOnly />

      {/* ---------- barra superior ---------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <Link
          href="/fluxos"
          title="Voltar para os fluxos"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <IconChevronLeft className="h-4 w-4" />
        </Link>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Nome do fluxo (ex.: Lançamento do e-book)"
          className={`${input} h-9 w-full min-w-0 py-1.5 sm:w-auto sm:max-w-xs sm:flex-1`}
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
          Ativo
        </label>

        {/* Avisos viram um selo discreto: em tela cheia, uma caixa amarela
            permanente roubaria a altura que é justamente o que se ganhou. */}
        {avisos.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setVerAvisos((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              <IconAlert className="h-3.5 w-3.5" />
              {avisos.length} {avisos.length === 1 ? "aviso" : "avisos"}
            </button>
            {verAvisos && (
              <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <ul className="list-disc space-y-1 pl-4 text-zinc-700 dark:text-zinc-300">
                  {avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Desfazer fica na barra de cima, e não junto do zoom: é uma ação
              sobre o fluxo, na mesma altura de Salvar. */}
          <div className="flex items-center">
            <button
              type="button"
              title="Desfazer (Ctrl+Z)"
              aria-label="Desfazer"
              disabled={!podeDesfazer}
              onClick={() => andarNoHistorico(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-l-lg border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <IconUndo className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Refazer (Ctrl+Shift+Z)"
              aria-label="Refazer"
              disabled={!podeRefazer}
              onClick={() => andarNoHistorico(1)}
              className="-ml-px flex h-9 w-9 items-center justify-center rounded-r-lg border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <IconUndo className="h-4 w-4 -scale-x-100" />
            </button>
          </div>
          <button className={`${btnPrimary} h-9 py-1.5`}>Salvar fluxo</button>
        </div>
      </header>

      {/* ---------- área de trabalho ---------- */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {/* paleta */}
          <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
            {ADICIONAVEIS.map((k) => {
              const Icone = ICONE[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={`Adicionar bloco: ${NODE_LABEL[k]}`}
                  title={NODE_DESC[k]}
                  onClick={() => adicionarBloco(k)}
                  className={`${btnGhost} bg-white/90 backdrop-blur dark:bg-zinc-900/90`}
                >
                  <Icone className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{NODE_LABEL[k]}</span>
                </button>
              );
            })}
          </div>

          {/* controles de vista */}
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5">
            <button
              type="button"
              title="Arrumar os blocos em árvore"
              onClick={() => setGraph((g) => ({ ...g, nodes: organizar(g) }))}
              className={`${btnGhost} bg-white/90 dark:bg-zinc-900/90`}
            >
              Organizar
            </button>
            <button
              type="button"
              title="Reduzir (Ctrl −)"
              disabled={vista.zoom <= ZOOM_MIN + 0.001}
              onClick={() => aplicarZoom(vista.zoom / 1.2)}
              className={`${btnGhost} bg-white/90 disabled:opacity-40 dark:bg-zinc-900/90`}
            >
              −
            </button>
            <button
              type="button"
              title="Voltar para 100%"
              onClick={() => aplicarZoom(1)}
              className="rounded-lg bg-white/90 px-2 py-1 text-xs tabular-nums text-zinc-500 transition-colors hover:text-zinc-800 dark:bg-zinc-900/90 dark:hover:text-zinc-200"
            >
              {Math.round(vista.zoom * 100)}%
            </button>
            <button
              type="button"
              title="Ampliar (Ctrl +)"
              disabled={vista.zoom >= ZOOM_MAX - 0.001}
              onClick={() => aplicarZoom(vista.zoom * 1.2)}
              className={`${btnGhost} bg-white/90 disabled:opacity-40 dark:bg-zinc-900/90`}
            >
              +
            </button>
            <button
              type="button"
              onClick={ajustarATela}
              className={`${btnGhost} bg-white/90 dark:bg-zinc-900/90`}
            >
              Ajustar à tela
            </button>
          </div>

          {/* Dica de rodapé. Some com o painel do bloco aberto: ali sobra pouca
              largura, o texto quebrava em nove linhas e quem está editando um
              bloco não está aprendendo a navegar. Os outros atalhos vivem no
              title de cada botão, que é onde a pessoa vai procurar mesmo. */}
          {ligando ? (
            <p className="absolute bottom-3 left-3 z-20 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white">
              Solte sobre o bloco de destino (ou clique nele) · Esc cancela
            </p>
          ) : noSelecionado ? null : (
            <p className="pointer-events-none absolute bottom-3 left-3 z-10 hidden max-w-[calc(100%-23rem)] text-[11px] leading-relaxed text-zinc-400 lg:block">
              Arraste da bolinha até outro bloco para ligar · Espaço navega · Ctrl + rolar amplia
              · setas movem o bloco
            </p>
          )}

          {/* Fundo quadriculado: dá noção de deslocamento ao arrastar */}
          <div
            ref={areaRef}
            onPointerDown={(e) => {
              ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              // dois dedos na tela = pinça; larga o arraste que estava em curso
              if (ponteiros.current.size === 2) {
                const [p1, p2] = [...ponteiros.current.values()];
                pinca.current = {
                  dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
                  cx: (p1.x + p2.x) / 2,
                  cy: (p1.y + p2.y) / 2,
                };
                arraste.current = null;
                pararEmpurrao();
                setPontaLivre(null);
                return;
              }
              // Navegar o mapa: pelo fundo vazio, com espaço afundado ou com o
              // botão do meio — os três de qualquer ponto da tela.
              const noVazio = e.target === e.currentTarget;
              if (!noVazio && !espacoRef.current && e.button !== 1) return;
              // clicar no vazio também desmarca; segurar espaço, não
              if (noVazio && !espacoRef.current) setSelecionado(null);
              iniciarArraste(
                { tipo: "fundo", x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y },
                e.clientX,
                e.clientY
              );
            }}
            // o botão do meio rola a página no navegador se ninguém impedir
            onAuxClick={(e) => e.preventDefault()}
            // Container com overflow:hidden continua rolável por código: focar
            // um botão dentro do mapa deslocava tudo e não havia como voltar.
            onScroll={(e) => {
              e.currentTarget.scrollLeft = 0;
              e.currentTarget.scrollTop = 0;
            }}
            className={`h-full w-full cursor-grab touch-none overflow-hidden bg-zinc-50 bg-[radial-gradient(circle,rgba(0,0,0,0.10)_1px,transparent_1px)] bg-[length:22px_22px] active:cursor-grabbing dark:bg-zinc-950 dark:bg-[radial-gradient(circle,rgba(255,255,255,0.10)_1px,transparent_1px)] ${
              // com o espaço afundado tudo vira área de navegação, e o cursor
              // precisa dizer isso mesmo por cima dos blocos
              espaco ? "[&_*]:!cursor-grab" : ""
            }`}
          >
            <div
              className="relative h-full w-full"
              style={{
                transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.zoom})`,
                transformOrigin: "0 0",
              }}
            >
              {/* setas */}
              <svg className="absolute left-0 top-0 h-[6000px] w-[6000px] overflow-visible">
                <defs>
                  {/* Ponta de seta: sem ela a linha não diz para que lado a
                      conversa anda, e num mapa com ramificação isso importa. */}
                  <marker
                    id="ponta-seta"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0.5 L8 4 L0 7.5 z" className="fill-zinc-400 dark:fill-zinc-600" />
                  </marker>
                  <marker
                    id="ponta-seta-ativa"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0.5 L8 4 L0 7.5 z" className="fill-indigo-500" />
                  </marker>
                </defs>
                {graph.edges.map((e) => {
                  const de = graph.nodes.find((n) => n.id === e.from);
                  const para = graph.nodes.find((n) => n.id === e.to);
                  if (!de || !para) return null;
                  const s = posicaoDaSaida(de, e.handle);
                  const chave = `${e.from}-${e.handle}`;
                  const emFoco = ligacaoSobUsuario === chave || selecionado === e.from;
                  const d = curva(
                    de.x + s.dx,
                    de.y + s.dy,
                    para.x - 4,
                    para.y + alturaDoBloco(para) / 2
                  );
                  return (
                    <g key={chave}>
                      {/* Faixa invisível e grossa por cima da curva: a linha tem
                          2px e ninguém acerta 2px com o mouse. */}
                      <path
                        d={d}
                        fill="none"
                        strokeWidth={16}
                        stroke="transparent"
                        style={{ pointerEvents: "stroke" }}
                        onPointerEnter={() => setLigacaoSobUsuario(chave)}
                        onPointerLeave={() =>
                          setLigacaoSobUsuario((c) => (c === chave ? null : c))
                        }
                      />
                      <path
                        d={d}
                        fill="none"
                        strokeWidth={emFoco ? 2.5 : 2}
                        markerEnd={`url(#${emFoco ? "ponta-seta-ativa" : "ponta-seta"})`}
                        className={`pointer-events-none transition-[stroke] ${
                          emFoco ? "stroke-indigo-500" : "stroke-zinc-400 dark:stroke-zinc-600"
                        }`}
                      />
                    </g>
                  );
                })}

                {/* linha sendo puxada: mostra para onde a ligação vai antes
                    de soltar, senão o arraste é às cegas */}
                {ligando &&
                  pontaLivre &&
                  (() => {
                    const de = graph.nodes.find((n) => n.id === ligando.from);
                    if (!de) return null;
                    const s = posicaoDaSaida(de, ligando.handle);
                    return (
                      <path
                        d={curva(de.x + s.dx, de.y + s.dy, pontaLivre.x, pontaLivre.y)}
                        fill="none"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        className="pointer-events-none stroke-indigo-500"
                      />
                    );
                  })()}
              </svg>

              {/* Botão de apagar cada seta, no meio do caminho. Só aparece com
                  o ponteiro sobre a linha ou com o bloco de origem selecionado:
                  um × por ligação, sempre visível, enchia o mapa de ruído — e
                  no celular, onde não existe ponteiro parado, selecionar o
                  bloco continua revelando os dele. */}
              {graph.edges.map((e) => {
                const de = graph.nodes.find((n) => n.id === e.from);
                const para = graph.nodes.find((n) => n.id === e.to);
                if (!de || !para) return null;
                const chave = `${e.from}-${e.handle}`;
                if (ligacaoSobUsuario !== chave && selecionado !== e.from) return null;
                const s = posicaoDaSaida(de, e.handle);
                const mx = (de.x + s.dx + para.x) / 2;
                const my = (de.y + s.dy + para.y + alturaDoBloco(para) / 2) / 2;
                return (
                  <button
                    key={`x-${chave}`}
                    type="button"
                    title="Remover ligação"
                    onPointerEnter={() => setLigacaoSobUsuario(chave)}
                    onClick={() => apagarLigacao(e.from, e.handle)}
                    style={{ left: mx - 9, top: my - 9 }}
                    className="absolute z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-indigo-300 bg-white text-[10px] text-indigo-600 shadow-sm transition-colors hover:border-red-400 hover:bg-red-50 hover:text-red-600 dark:border-indigo-700 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-red-950/60"
                  >
                    ×
                  </button>
                );
              })}

              {/* blocos */}
              {graph.nodes.map((n) => {
                const Icone = ICONE[n.kind];
                const saidas = saidasDoNo(n);
                const alvoDeLigacao = Boolean(ligando && ligando.from !== n.id);
                return (
                  <div
                    key={n.id}
                    data-no={n.id}
                    style={{ left: n.x, top: n.y, width: LARGURA_BLOCO }}
                    onClick={() => (ligando ? concluirLigacao(n.id) : setSelecionado(n.id))}
                    className={`absolute rounded-xl border-2 bg-white text-left shadow-sm transition-shadow dark:bg-zinc-900 ${
                      COR[n.kind]
                    } ${selecionado === n.id ? "ring-2 ring-indigo-500" : ""} ${
                      // candidato a destino fica discreto; o que está debaixo do
                      // dedo fica gritante — é ele que vai receber a ligação
                      alvoSobUsuario === n.id
                        ? "cursor-copy scale-[1.02] ring-4 ring-indigo-500 shadow-lg"
                        : alvoDeLigacao
                          ? "cursor-copy ring-2 ring-indigo-300"
                          : ""
                    }`}
                  >
                    <div
                      onPointerDown={(e) => {
                        // espaço afundado, botão do meio ou pinça: quem manda é
                        // a navegação do mapa, não o arraste deste bloco
                        if (ligando || espacoRef.current || e.button === 1) return;
                        e.stopPropagation();
                        ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        const p = paraOMapa(e.clientX, e.clientY);
                        iniciarArraste(
                          { tipo: "bloco", id: n.id, dx: p.x - n.x, dy: p.y - n.y },
                          e.clientX,
                          e.clientY
                        );
                      }}
                      className="flex cursor-grab touch-none items-center gap-1.5 rounded-t-lg border-b border-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 active:cursor-grabbing dark:border-zinc-800 dark:text-zinc-200"
                    >
                      <Icone className="h-3.5 w-3.5" />
                      <span className="truncate">{NODE_LABEL[n.kind]}</span>
                      {n.kind !== "start" && (
                        <button
                          type="button"
                          title="Apagar bloco"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            apagarBloco(n.id);
                          }}
                          className="ml-auto text-zinc-400 transition-colors hover:text-red-500"
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="px-2.5 py-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                      {n.kind === "start" && (
                        <p>
                          {trigger === "comment"
                            ? "comentar"
                            : trigger === "story"
                              ? "responder o story"
                              : "mandar mensagem"}
                          {matchType === "any" ? " qualquer coisa" : `: ${keywords || "…"}`}
                        </p>
                      )}
                      {n.kind === "delay" && <p>{n.minutes ?? 60} minutos</p>}
                      {n.kind === "tag" && (
                        <p>
                          {n.tag?.trim() ? (
                            <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">
                              {n.tag}
                            </span>
                          ) : (
                            <span className="italic text-zinc-400">sem etiqueta ainda</span>
                          )}
                        </p>
                      )}
                      {/* Selo do anexo: no mapa dá para ver de longe quais
                          blocos mandam mídia, sem abrir bloco por bloco. */}
                      {n.mediaUrl && n.mediaKind && (
                        <span className="mb-1 flex w-fit items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {MEDIA_LABEL[n.mediaKind]}
                        </span>
                      )}
                      {(n.kind === "message" ||
                        n.kind === "ask_email" ||
                        n.kind === "follow_gate") && (
                        <p className="line-clamp-4 whitespace-pre-wrap">
                          {n.text || <span className="italic text-zinc-400">sem texto ainda</span>}
                        </p>
                      )}
                      {n.kind === "message" &&
                        n.buttons?.map((b, i) => (
                          <span
                            key={i}
                            className={`mt-1 flex h-[22px] items-center truncate rounded-full px-2 text-[10px] ${
                              n.buttonMode === "url"
                                ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            }`}
                          >
                            {b.label || `Opção ${i + 1}`}
                          </span>
                        ))}
                      {n.kind === "follow_gate" && (
                        <span className="mt-1 flex h-[22px] items-center rounded-full bg-indigo-50 px-2 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          {n.buttonLabel || "Já sigo! ✅"}
                        </span>
                      )}
                    </div>

                    {/* saídas: uma bolinha por caminho possível */}
                    {saidas.map((s) => {
                      const pos = posicaoDaSaida(n, s.handle);
                      const ligada = graph.edges.some(
                        (e) => e.from === n.id && e.handle === s.handle
                      );
                      return (
                        <span key={s.handle}>
                          {ramifica(n) && (
                            <span
                              style={{ left: pos.dx + 12, top: pos.dy - 8 }}
                              className="absolute whitespace-nowrap text-[9px] font-medium text-zinc-400"
                            >
                              {s.label}
                            </span>
                          )}
                          <button
                            type="button"
                            title={
                              s.label
                                ? `Saída: ${s.label} — arraste até o bloco de destino`
                                : "Arraste até o bloco de destino"
                            }
                            // O clique nasce na bolinha mas SOBE até o card, e
                            // lá o handler entendia como "escolhi este bloco
                            // como destino" — cancelando a ligação recém-armada.
                            onClick={(ev) => ev.stopPropagation()}
                            onPointerDown={(ev) => {
                              if (espacoRef.current || ev.button === 1) return;
                              ev.stopPropagation();
                              ev.preventDefault();
                              setLigando({ from: n.id, handle: s.handle });
                              setPontaLivre({ x: n.x + pos.dx, y: n.y + pos.dy });
                              iniciarArraste(
                                {
                                  tipo: "ligacao",
                                  from: n.id,
                                  handle: s.handle,
                                  x: ev.clientX,
                                  y: ev.clientY,
                                  moveu: false,
                                },
                                ev.clientX,
                                ev.clientY
                              );
                            }}
                            style={{ left: pos.dx - 7, top: pos.dy - 7 }}
                            className={`absolute h-3.5 w-3.5 rounded-full border-2 border-white transition-transform hover:scale-125 dark:border-zinc-900 ${
                              ligando?.from === n.id && ligando.handle === s.handle
                                ? "bg-indigo-500 ring-2 ring-indigo-300"
                                : ligada
                                  ? "bg-zinc-400 dark:bg-zinc-500"
                                  : "bg-zinc-300 dark:bg-zinc-600"
                            }`}
                          />
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---------- painel do bloco selecionado ----------
            Sem bloco selecionado o painel simplesmente não existe, e o mapa
            ocupa a tela inteira. */}
        {noSelecionado && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            {noSelecionado.kind === "start" ? (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Quando alguém…
                </p>
                <div className="space-y-1.5">
                  {gatilhos.map((g) => {
                    const Icone = g.icon;
                    return (
                      <label
                        key={g.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                          trigger === g.value
                            ? "border-indigo-500 bg-indigo-500/10 font-semibold text-indigo-700 dark:text-indigo-300"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      >
                        <input
                          type="radio"
                          checked={trigger === g.value}
                          onChange={() => {
                            setTrigger(g.value);
                            if (g.value !== "comment") setPost(null);
                            if (g.value !== "story") setStory(null);
                          }}
                          className="sr-only"
                        />
                        <Icone className="h-4 w-4" />
                        {g.titulo}
                      </label>
                    );
                  })}
                </div>

                <div>
                  <label className={label}>Palavras-chave (separadas por vírgula)</label>
                  <input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="quero, link, eu quero"
                    className={input}
                  />
                  <p className={hint}>Sem diferença de maiúsculas ou acentos.</p>
                </div>

                <div>
                  <label className={label}>Tipo de correspondência</label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as typeof matchType)}
                    className={input}
                  >
                    <option value="contains">Contém a palavra</option>
                    <option value="exact">Texto exato</option>
                    <option value="any">Qualquer texto</option>
                  </select>
                </div>

                {trigger === "comment" && (
                  <>
                    <div>
                      <span className={label}>Post específico (opcional)</span>
                      <MediaPicker
                        kind="posts"
                        selected={post}
                        onSelect={setPost}
                        platform={platform}
                      />
                      <p className={hint}>Sem post escolhido, vale para todos os posts.</p>
                    </div>
                    <MessageField
                      name="public_replies_visivel"
                      label="Responder no comentário (opcional)"
                      value={publicReplies}
                      onChange={setPublicReplies}
                      rows={2}
                      placeholder={"Te chamei na DM! 📩"}
                      hint="Uma variação por linha — o sistema sorteia uma."
                    />
                  </>
                )}

                {trigger === "story" && (
                  <div>
                    <span className={label}>Story específico (opcional)</span>
                    <MediaPicker
                      kind="stories"
                      selected={story}
                      onSelect={setStory}
                      platform={platform}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {NODE_LABEL[noSelecionado.kind]}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => duplicarBloco(noSelecionado.id)}
                      className="font-medium text-zinc-500 hover:underline"
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => apagarBloco(noSelecionado.id)}
                      className="font-medium text-red-600 hover:underline dark:text-red-400"
                    >
                      Apagar
                    </button>
                  </div>
                </div>
                <p className={`-mt-2 text-xs ${muted}`}>{NODE_DESC[noSelecionado.kind]}</p>

                <PainelDoBloco
                  no={noSelecionado}
                  atualizar={atualizarNo}
                  facebook={facebook}
                  avisoDoAnexo={
                    trigger === "comment" && primeiraMensagem === noSelecionado.id
                      ? "Esta é a primeira mensagem depois do comentário: ela é uma resposta privada e a Meta só aceita texto nela. Ponha o anexo num bloco seguinte."
                      : undefined
                  }
                />
              </div>
            )}
          </aside>
        )}
      </div>
    </form>
  );
}

// Campos de edição de cada tipo de bloco.
function PainelDoBloco({
  no,
  atualizar,
  facebook,
  avisoDoAnexo,
}: {
  no: FlowNode;
  atualizar: (id: string, muda: Partial<FlowNode>) => void;
  facebook: boolean;
  // Preenchido quando este bloco é a primeira mensagem de um fluxo de
  // comentário: ali o anexo não é entregue (resposta privada só aceita texto).
  avisoDoAnexo?: string;
}) {
  if (no.kind === "delay") {
    return (
      <div>
        <label className={label}>Esperar quantos minutos</label>
        <input
          type="number"
          inputMode="numeric"
          value={no.minutes ?? 60}
          onChange={(e) => atualizar(no.id, { minutes: Number(e.target.value) || 0 })}
          onBlur={(e) => {
            // Ajuste ao sair do campo, em vez de min/max nativos: com eles, um
            // número fora da faixa bloqueava o "Salvar fluxo" inteiro com a
            // mensagem do navegador, sem dizer qual bloco estava errado.
            const n = Number(e.target.value);
            atualizar(no.id, {
              minutes: Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(1200, Math.round(n))) : 60,
            });
          }}
          className={input}
        />
        <p className={hint}>
          A mensagem seguinte precisa caber na janela de 24h da Meta — passou disso, ela não é
          entregue.
        </p>
      </div>
    );
  }

  if (no.kind === "tag") {
    return (
      <div>
        <label className={label}>Nome da etiqueta</label>
        <input
          value={no.tag ?? ""}
          maxLength={40}
          onChange={(e) => atualizar(no.id, { tag: e.target.value })}
          placeholder="ex.: quer o e-book"
          className={input}
        />
        <p className={hint}>
          A etiqueta fica salva no contato e aparece em <b>Contatos</b>, onde dá para filtrar por
          ela. A mesma etiqueta não se repete se a pessoa passar duas vezes.
        </p>
      </div>
    );
  }

  return (
    <>
      <MessageField
        name={`texto_${no.id}`}
        label="Mensagem"
        value={no.text ?? ""}
        onChange={(v) => atualizar(no.id, { text: v })}
        rows={4}
        placeholder="Oi {{first_name}}! 👋"
      />

      {no.kind === "follow_gate" && (
        <>
          <div>
            <label className={label}>Texto do botão</label>
            <input
              value={no.buttonLabel ?? ""}
              maxLength={20}
              onChange={(e) => atualizar(no.id, { buttonLabel: e.target.value })}
              className={input}
            />
          </div>
          {facebook && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              No Facebook a API não informa quem segue a página: este bloco deixa passar todo
              mundo e registra o ocorrido em Atividade.
            </p>
          )}
        </>
      )}

      {no.kind === "message" && (
        <MediaField
          kind={no.mediaKind ?? null}
          url={no.mediaUrl ?? ""}
          onChange={(kind, url) =>
            atualizar(no.id, { mediaKind: kind ?? undefined, mediaUrl: url || undefined })
          }
          aviso={avisoDoAnexo}
        />
      )}

      {no.kind === "message" && <BotoesDoBloco no={no} atualizar={atualizar} />}
    </>
  );
}

// Botões da mensagem: link (abre um endereço) ou opção de resposta (ramifica).
// São excludentes por bloco porque a Meta não aceita template de botão junto
// com resposta rápida na mesma mensagem.
function BotoesDoBloco({
  no,
  atualizar,
}: {
  no: FlowNode;
  atualizar: (id: string, muda: Partial<FlowNode>) => void;
}) {
  const botoes: FlowButton[] = no.buttons ?? [];
  const modo = no.buttonMode ?? "reply";

  function mudarBotao(i: number, muda: Partial<FlowButton>) {
    atualizar(no.id, {
      buttons: botoes.map((b, idx) => (idx === i ? { ...b, ...muda } : b)),
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className={label}>Botões</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { v: "reply", t: "Opções de resposta", d: "Cada opção segue um caminho" },
              { v: "url", t: "Botões de link", d: "Abrem um endereço" },
            ] as const
          ).map((o) => (
            <label
              key={o.v}
              className={`cursor-pointer rounded-lg border p-2 text-[11px] leading-tight transition-colors ${
                modo === o.v
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                checked={modo === o.v}
                onChange={() => atualizar(no.id, { buttonMode: o.v })}
                className="sr-only"
              />
              <span className="block font-semibold text-zinc-800 dark:text-zinc-200">{o.t}</span>
              <span className="text-zinc-500">{o.d}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {botoes.map((b, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <input
                value={b.label}
                maxLength={20}
                onChange={(e) => mudarBotao(i, { label: e.target.value })}
                placeholder={modo === "url" ? "Abrir link" : "Quero o link! 🔗"}
                className={`${input} py-1.5 text-xs`}
              />
              <button
                type="button"
                title="Remover botão"
                onClick={() => atualizar(no.id, { buttons: botoes.filter((_, idx) => idx !== i) })}
                className="shrink-0 text-zinc-400 transition-colors hover:text-red-500"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
            {modo === "url" && (
              <input
                type="url"
                value={b.url ?? ""}
                onChange={(e) => mudarBotao(i, { url: e.target.value })}
                placeholder="https://seulink.com"
                className={`${input} mt-2 py-1.5 text-xs`}
              />
            )}
          </div>
        ))}
      </div>

      {botoes.length < 3 && (
        <button
          type="button"
          onClick={() => atualizar(no.id, { buttons: [...botoes, { label: "" }] })}
          className={btnGhost}
        >
          + Adicionar botão
        </button>
      )}
      <p className={hint}>
        {modo === "url"
          ? "Até 3 botões de link por mensagem (limite da Meta)."
          : "Cada opção ganha uma bolinha de saída no bloco — ligue cada uma ao próximo passo."}
      </p>
    </div>
  );
}
