// ============================================================
// Gerador do pacote de fluxos prontos (fluxos-prontos/*.json)
//
// Os arquivos .json são o produto; este script é a fonte deles. Escrever os
// fluxos aqui e gerar os arquivos resolve três coisas que fazer à mão não
// resolve:
//
// 1. Posição dos blocos. O x/y de cada bloco é calculado a partir das ligações
//    (uma coluna por profundidade), então o fluxo abre organizado no editor em
//    vez de virar um monte de cartão empilhado.
// 2. Limites da Meta. Rótulo de botão passa de 20 caracteres e o Instagram
//    recusa a mensagem inteira; aqui isso quebra a geração, não a entrega.
// 3. Consistência. Dez fluxos escritos à mão divergem em espaçamento, aspas e
//    nome de campo; gerados, não.
//
// Rodar:  node scripts/gerar-fluxos-prontos.mjs
// ============================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DESTINO = join(process.cwd(), "fluxos-prontos");

// ------------------------------------------------------------
// Atalhos para escrever os blocos
// ------------------------------------------------------------
const msg = (id, text, buttons = []) => ({
  id,
  kind: "message",
  text,
  buttonMode: buttons.some((b) => b.url) ? "url" : "reply",
  buttons,
});
const link = (label, url) => ({ label, url });
const opcao = (label) => ({ label });
const espera = (id, minutes) => ({ id, kind: "delay", minutes });
const email = (id, text) => ({ id, kind: "ask_email", text });
const seguir = (id, text, buttonLabel = "Já sigo ✅") => ({
  id,
  kind: "follow_gate",
  text,
  buttonLabel,
});
const etiqueta = (id, tag) => ({ id, kind: "tag", tag });

// "a > b" liga a saída única; "a 0> b" liga o primeiro botão de resposta.
function ligar(spec) {
  return spec.map((linha) => {
    const m = /^(\S+)\s+(?:(\d+)>|>)\s+(\S+)$/.exec(linha.trim());
    if (!m) throw new Error(`Ligação inválida: "${linha}"`);
    return { from: m[1], handle: m[2] === undefined ? "next" : `btn:${m[2]}`, to: m[3] };
  });
}

// ------------------------------------------------------------
// Limites reais da API da Meta, conferidos na geração
// ------------------------------------------------------------
const LIMITES = { texto: 900, rotulo: 20, botoes: 3, espera: 1200 };

function conferir(fluxo) {
  const erros = [];
  const ids = new Set();
  for (const n of fluxo.nodes) {
    if (ids.has(n.id)) erros.push(`id repetido: ${n.id}`);
    ids.add(n.id);
    if (n.text && n.text.length > LIMITES.texto)
      erros.push(`${n.id}: texto com ${n.text.length} caracteres (máx ${LIMITES.texto})`);
    if (n.minutes && n.minutes > LIMITES.espera)
      erros.push(`${n.id}: espera de ${n.minutes} min (máx ${LIMITES.espera})`);
    if ((n.buttons?.length ?? 0) > LIMITES.botoes)
      erros.push(`${n.id}: ${n.buttons.length} botões (máx ${LIMITES.botoes})`);
    for (const b of n.buttons ?? []) {
      // .length em JS conta unidades UTF-16: um emoji vale 2, que é exatamente
      // como o corte acontece na normalização antes de gravar.
      if (b.label.length > LIMITES.rotulo)
        erros.push(`${n.id}: rótulo "${b.label}" com ${b.label.length} (máx ${LIMITES.rotulo})`);
    }
    if (n.kind === "message" && n.buttons?.length) {
      const comUrl = n.buttons.filter((b) => b.url).length;
      if (comUrl && comUrl !== n.buttons.length)
        erros.push(`${n.id}: mistura botão de link com opção de resposta`);
    }
  }
  for (const e of fluxo.edges) {
    if (!ids.has(e.from)) erros.push(`ligação sai de bloco inexistente: ${e.from}`);
    if (!ids.has(e.to)) erros.push(`ligação vai para bloco inexistente: ${e.to}`);
  }
  // toda saída de botão de resposta precisa levar a algum lugar
  for (const n of fluxo.nodes) {
    if (n.kind !== "message" || n.buttonMode !== "reply") continue;
    n.buttons?.forEach((b, i) => {
      if (!fluxo.edges.some((e) => e.from === n.id && e.handle === `btn:${i}`))
        erros.push(`${n.id}: a opção "${b.label}" não leva a lugar nenhum`);
    });
  }
  // e todo bloco precisa ser alcançável a partir do gatilho
  const vistos = new Set(["start"]);
  const fila = ["start"];
  while (fila.length) {
    const atual = fila.shift();
    for (const e of fluxo.edges.filter((e) => e.from === atual)) {
      if (!vistos.has(e.to)) {
        vistos.add(e.to);
        fila.push(e.to);
      }
    }
  }
  for (const n of fluxo.nodes) {
    if (!vistos.has(n.id)) erros.push(`${n.id}: bloco solto, nunca é executado`);
  }
  if (erros.length) throw new Error(`${fluxo.name}\n  - ${erros.join("\n  - ")}`);
}

// ------------------------------------------------------------
// Posicionamento: uma coluna por profundidade a partir do gatilho
// ------------------------------------------------------------
const COLUNA = 300;
const LINHA = 170;

function posicionar(nodes, edges) {
  const profundidade = new Map([["start", 0]]);
  const fila = ["start"];
  while (fila.length) {
    const atual = fila.shift();
    for (const e of edges.filter((e) => e.from === atual)) {
      if (profundidade.has(e.to)) continue;
      profundidade.set(e.to, profundidade.get(atual) + 1);
      fila.push(e.to);
    }
  }
  const porColuna = new Map();
  for (const n of nodes) {
    const d = profundidade.get(n.id) ?? 0;
    if (!porColuna.has(d)) porColuna.set(d, []);
    porColuna.get(d).push(n.id);
  }
  const posicao = new Map();
  for (const [d, ids] of porColuna) {
    ids.forEach((id, i) => {
      // centraliza a coluna na vertical: a leitura fica em torno de uma linha
      posicao.set(id, { x: 60 + d * COLUNA, y: (i - (ids.length - 1) / 2) * LINHA });
    });
  }
  // Empurra tudo para o quadrante positivo. Centralizar as colunas produz y
  // negativo nas mais cheias, e o editor abre a vista no canto (0,0): os blocos
  // ficariam acima da área visível até alguém clicar em "Ajustar à tela".
  const menorY = Math.min(...[...posicao.values()].map((p) => p.y));
  return nodes.map((n) => {
    const p = posicao.get(n.id);
    return { ...n, x: p.x, y: Math.round(p.y - menorY + 60) };
  });
}

function montar(def) {
  const nodes = [{ id: "start", kind: "start" }, ...def.nodes];
  const edges = ligar(def.edges);
  const fluxo = {
    name: def.name,
    descricao: def.descricao,
    trigger: def.trigger,
    match_type: def.keywords?.length ? (def.match_type ?? "contains") : "any",
    keywords: def.keywords ?? [],
    public_replies: def.trigger === "comment" ? (def.public_replies ?? []) : [],
    nodes,
    edges,
  };
  conferir(fluxo);
  return { ...fluxo, nodes: posicionar(nodes, edges) };
}

// ============================================================
// Os dez fluxos
// ============================================================
const FLUXOS = [];

// ------------------------------------------------------------
// 1. Isca digital: comentou → recebe o material no direct
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "01-isca-digital.json",
  name: "1 · Isca digital no comentário",
  descricao:
    "Quem comenta a palavra-chave recebe o material no direct. Pede o follow antes de entregar, guarda o e-mail e volta no dia seguinte para saber se a pessoa usou.",
  trigger: "comment",
  keywords: ["quero", "eu quero", "link", "enviar"],
  public_replies: [
    "Te mandei no direct 📩",
    "Já está no seu direct, dá uma olhada 👀",
    "Enviado! Confere lá no privado ✅",
  ],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name|tudo bem}}! Vi seu comentário 👀\n\nEu preparei o [NOME DO MATERIAL] e posso te mandar agora mesmo. Quer receber?",
      [opcao("Quero sim 🙌"), opcao("Me conta mais")]
    ),
    msg(
      "m2",
      "Claro! O [NOME DO MATERIAL] é um passo a passo de [O QUE ELE RESOLVE], em [FORMATO: PDF, vídeo ou planilha].\n\nEm [TEMPO] você já consegue [RESULTADO]. Quer que eu mande?",
      [opcao("Agora quero 👍"), opcao("Fica pra depois")]
    ),
    seguir(
      "g1",
      "Perfeito! Só uma coisa antes: me segue aqui para não perder os próximos materiais 👇\n\nDepois é só tocar no botão."
    ),
    etiqueta("t1", "lead"),
    msg("m3", "Aqui está, {{first_name}} 🎁\n\n[NOME DO MATERIAL] — é só tocar no botão abaixo.", [
      link("Baixar agora", "https://exemplo.com/[SEU-LINK]"),
    ]),
    email(
      "e1",
      "Mais uma coisa rápida: me manda seu melhor e-mail que eu te aviso quando sair [A PRÓXIMA COISA] 👇\n\n(é só escrever aqui e enviar)"
    ),
    etiqueta("t2", "e-mail-capturado"),
    espera("d1", 1200),
    msg("m4", "{{first_name}}, conseguiu abrir o [NOME DO MATERIAL]?", [
      opcao("Sim, curti 🔥"),
      opcao("Ainda não 😅"),
    ]),
    msg(
      "m5",
      "Que bom! 🙌\n\nSe quiser o passo seguinte, é [NOME DA SUA OFERTA] — é onde eu mostro [O QUE A OFERTA ENTREGA].",
      [link("Quero ver", "https://exemplo.com/[SUA-OFERTA]")]
    ),
    etiqueta("t3", "engajado"),
    msg("m6", "Sem stress, o link continua valendo 👇", [
      link("Abrir de novo", "https://exemplo.com/[SEU-LINK]"),
    ]),
    msg(
      "m9",
      "Sem problema, {{first_name}} 🙂 Fica guardado aqui — é só me mandar “quero” quando bater a vontade."
    ),
    etiqueta("t9", "morno"),
  ],
  edges: [
    "start > m1",
    "m1 0> g1",
    "m1 1> m2",
    "m2 0> g1",
    "m2 1> m9",
    "m9 > t9",
    "g1 > t1",
    "t1 > m3",
    "m3 > e1",
    "e1 > t2",
    "t2 > d1",
    "d1 > m4",
    "m4 0> m5",
    "m4 1> m6",
    "m5 > t3",
  ],
});

// ------------------------------------------------------------
// 2. Lista de espera de lançamento
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "02-lista-de-espera.json",
  name: "2 · Lista de espera do lançamento",
  descricao:
    "Transforma o comentário do post de aquecimento em lista de espera com e-mail, separa a lista por nível (iniciante, intermediário, avançado) e aquece até a abertura.",
  trigger: "comment",
  keywords: ["lista", "quero entrar", "eu quero", "espera"],
  public_replies: ["Entrou na lista! Confere o direct 📩", "Te chamei no privado 👀"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! As vagas de [NOME DO PROGRAMA] abrem dia [DATA] 🚀\n\nQuem entra na lista de espera é avisado primeiro e leva [BÔNUS DE QUEM ENTRA HOJE]. Posso te colocar?",
      [opcao("Quero entrar ✋"), opcao("Qual o valor?")]
    ),
    msg(
      "m2",
      "O investimento fica em torno de [FAIXA DE PREÇO], com [CONDIÇÃO DE PAGAMENTO]. O valor exato eu abro no dia [DATA].\n\nEntrar na lista não compromete nada — só garante o aviso e o bônus.",
      [opcao("Então entra ✅"), opcao("Agora não")]
    ),
    email(
      "e1",
      "Combinado! Me manda seu melhor e-mail — é para lá que vai o aviso da abertura 👇"
    ),
    etiqueta("t1", "lista-de-espera"),
    msg(
      "m3",
      "Prontinho, você está na lista ✅\n\nPara eu te mandar o conteúdo certo até lá: onde você está hoje?",
      [opcao("Ainda não comecei"), opcao("Já comecei"), opcao("Já faço há tempo")]
    ),
    etiqueta("t2", "nivel-iniciante"),
    etiqueta("t3", "nivel-intermediario"),
    etiqueta("t4", "nivel-avancado"),
    msg("m4", "Perfeito, anotado 📝\n\nEnquanto a abertura não chega, começa por aqui:", [
      link("Ver o conteúdo", "https://exemplo.com/[CONTEUDO-GRATUITO]"),
    ]),
    espera("d1", 1200),
    msg(
      "m5",
      "{{first_name}}, está chegando a abertura de [NOME DO PROGRAMA] 👀\n\nDeixei aqui tudo o que você precisa saber antes de decidir:",
      [link("Ler antes", "https://exemplo.com/[PAGINA-DE-ESPERA]")]
    ),
    msg("m8", "Tranquilo, {{first_name}} 🙂 Se mudar de ideia, é só me mandar “lista” por aqui."),
    etiqueta("t8", "lista-recusou"),
  ],
  edges: [
    "start > m1",
    "m1 0> e1",
    "m1 1> m2",
    "m2 0> e1",
    "m2 1> m8",
    "m8 > t8",
    "e1 > t1",
    "t1 > m3",
    "m3 0> t2",
    "m3 1> t3",
    "m3 2> t4",
    "t2 > m4",
    "t3 > m4",
    "t4 > m4",
    "m4 > d1",
    "d1 > m5",
  ],
});

// ------------------------------------------------------------
// 3. Cupom de primeira compra
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "03-cupom-primeira-compra.json",
  name: "3 · Cupom de primeira compra",
  descricao:
    "Entrega o cupom no direct depois do follow, cobra o uso 3 horas depois e faz a última chamada antes de vencer. Separa quem comprou, quem travou e quem sumiu.",
  trigger: "comment",
  keywords: ["cupom", "desconto", "quero"],
  public_replies: ["Cupom no seu direct 🎟️", "Te mandei no privado ✅"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! Tenho um cupom de [X]% para a primeira compra 🎟️\n\nQuer que eu libere pra você?",
      [opcao("Quero o cupom 🎟️"), opcao("Como funciona?")]
    ),
    msg(
      "m2",
      "Simples: o cupom dá [X]% em [O QUE VALE], vale por [PRAZO] e só na primeira compra. Não acumula com outras promoções.\n\nLibero pra você?",
      [opcao("Libera sim ✅"), opcao("Depois eu vejo")]
    ),
    seguir(
      "g1",
      "Fechado! Me segue aqui para eu conseguir te mandar — e para você ver as promoções antes de todo mundo 👇"
    ),
    etiqueta("t1", "cupom-enviado"),
    msg(
      "m3",
      "Seu cupom é [CÓDIGO] 🎟️\n\n[X]% de desconto, válido até [DATA]. É só aplicar no carrinho:",
      [link("Usar agora", "https://exemplo.com/[SUA-LOJA]")]
    ),
    espera("d1", 180),
    msg("m4", "{{first_name}}, conseguiu usar o cupom [CÓDIGO]?", [
      opcao("Comprei! 🛍️"),
      opcao("Deu erro 😕"),
      opcao("Ainda tô vendo"),
    ]),
    etiqueta("t2", "comprou"),
    msg(
      "m5",
      "Obaaa! Obrigado pela confiança 🧡\n\nQualquer coisa sobre a entrega, é só me chamar por aqui."
    ),
    etiqueta("t3", "erro-no-cupom"),
    msg("m6", "Me conta o que apareceu na tela que eu resolvo pra você 🙏 (pode mandar print)"),
    espera("d2", 1200),
    msg("m8", "Último aviso, {{first_name}} 😊 O cupom [CÓDIGO] vence [DATA]:", [
      link("Usar o cupom", "https://exemplo.com/[SUA-LOJA]"),
    ]),
    msg("m7", "Sem problema! Quando quiser, é só mandar “cupom” aqui 😉"),
    etiqueta("t7", "cupom-recusou"),
  ],
  edges: [
    "start > m1",
    "m1 0> g1",
    "m1 1> m2",
    "m2 0> g1",
    "m2 1> m7",
    "m7 > t7",
    "g1 > t1",
    "t1 > m3",
    "m3 > d1",
    "d1 > m4",
    "m4 0> t2",
    "m4 1> t3",
    "m4 2> d2",
    "t2 > m5",
    "t3 > m6",
    "d2 > m8",
  ],
});

// ------------------------------------------------------------
// 4. Qualificação de lead para serviço
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "04-qualificacao-de-lead.json",
  name: "4 · Qualificação de lead (serviço)",
  descricao:
    "Três perguntas no direct que separam o que a pessoa precisa, para quando precisa e o e-mail dela — e terminam no link da sua agenda. Cada resposta vira etiqueta em Contatos.",
  trigger: "dm",
  keywords: ["orçamento", "orcamento", "proposta", "quero contratar", "valores"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! Aqui é o atendimento de [SEU NEGÓCIO] 👋\n\nPara eu te passar um orçamento certo (e não um chute), me responde 3 coisinhas rápidas. Vamos?",
      [opcao("Vamos lá 👍"), opcao("Só uma dúvida")]
    ),
    msg(
      "m9",
      "Pode perguntar! Mas se preferir, me diz o que você precisa que eu já te respondo com valor.",
      [opcao("Ok, vamos lá 👍"), opcao("Falar com pessoa")]
    ),
    etiqueta("t9", "quer-atendimento-humano"),
    msg(
      "m10",
      "Já te chamei aqui, {{first_name}} 🙌\n\nMe deixa um resumo do que você precisa que eu respondo pessoalmente em até [PRAZO]."
    ),
    msg("m2", "1 de 3 — O que você precisa?", [
      opcao("[SERVIÇO 1]"),
      opcao("[SERVIÇO 2]"),
      opcao("Outra coisa"),
    ]),
    etiqueta("t1", "servico-1"),
    etiqueta("t2", "servico-2"),
    etiqueta("t3", "servico-outro"),
    msg("m3", "2 de 3 — Para quando você precisa?", [
      opcao("Essa semana 🔥"),
      opcao("Neste mês"),
      opcao("Só pesquisando"),
    ]),
    etiqueta("t4", "prazo-urgente"),
    etiqueta("t5", "prazo-do-mes"),
    etiqueta("t6", "so-pesquisando"),
    email("e1", "3 de 3 — Me manda seu melhor e-mail que eu envio a proposta por lá também 👇"),
    msg(
      "m5",
      "Perfeito, {{first_name}}! Já tenho o que preciso ✅\n\nO próximo passo é uma conversa de [DURAÇÃO], sem compromisso, para eu entender seu caso e te passar o valor fechado.",
      [link("Escolher horário", "https://exemplo.com/[SUA-AGENDA]")]
    ),
    espera("d1", 1200),
    msg("m6", "{{first_name}}, conseguiu marcar o horário?", [
      opcao("Marquei ✅"),
      opcao("Ainda não"),
    ]),
    etiqueta("t7", "agendou"),
    msg("m7", "Sem stress! A agenda continua aberta aqui 👇", [
      link("Ver horários", "https://exemplo.com/[SUA-AGENDA]"),
    ]),
  ],
  edges: [
    "start > m1",
    "m1 0> m2",
    "m1 1> m9",
    "m9 0> m2",
    "m9 1> t9",
    "t9 > m10",
    "m2 0> t1",
    "m2 1> t2",
    "m2 2> t3",
    "t1 > m3",
    "t2 > m3",
    "t3 > m3",
    "m3 0> t4",
    "m3 1> t5",
    "m3 2> t6",
    "t4 > e1",
    "t5 > e1",
    "t6 > e1",
    "e1 > m5",
    "m5 > d1",
    "d1 > m6",
    "m6 0> t7",
    "m6 1> m7",
  ],
});

// ------------------------------------------------------------
// 5. Menu de atendimento na resposta de story
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "05-menu-do-story.json",
  name: "5 · Menu de atendimento no story",
  descricao:
    "Qualquer resposta a story vira um menu de três caminhos: comprar, tirar dúvida ou falar com uma pessoa. Nenhuma resposta de story fica sem retorno.",
  trigger: "story",
  keywords: [],
  nodes: [
    msg("m1", "Oi {{first_name}}, obrigado por responder o story 🧡\n\nComo eu posso te ajudar?", [
      opcao("Quero comprar 🛍️"),
      opcao("Tenho uma dúvida"),
      opcao("Falar com alguém"),
    ]),
    etiqueta("t1", "interesse-compra"),
    msg("m2", "Show! É por aqui 👇\n\n[O QUE ESTÁ NO STORY] — [PREÇO E CONDIÇÃO].", [
      link("Ver e comprar", "https://exemplo.com/[SEU-LINK]"),
    ]),
    espera("d1", 240),
    msg("m5", "{{first_name}}, ficou alguma dúvida antes de fechar?", [
      opcao("Tudo certo ✅"),
      opcao("Tenho dúvida"),
    ]),
    msg("m8", "Perfeito! Qualquer coisa é só me chamar por aqui 🙌"),
    msg("m3", "Pode perguntar 🙂 Sobre o que é?", [
      opcao("Preço"),
      opcao("Prazo e entrega"),
      opcao("Outra dúvida"),
    ]),
    msg("m6", "[EXPLICAÇÃO DO PREÇO: valor, formas de pagamento e parcelamento].", [
      link("Ver detalhes", "https://exemplo.com/[SEU-LINK]"),
    ]),
    msg(
      "m7",
      "[EXPLICAÇÃO DO PRAZO: quanto tempo leva, como é enviado e como acompanhar o pedido]."
    ),
    etiqueta("t2", "duvida-aberta"),
    msg(
      "m4",
      "Já anotei aqui, {{first_name}} 👋\n\nMe escreve o que você precisa que uma pessoa da equipe responde em até [PRAZO], no horário [HORÁRIO DE ATENDIMENTO]."
    ),
  ],
  edges: [
    "start > m1",
    "m1 0> t1",
    "m1 1> m3",
    "m1 2> t2",
    "t1 > m2",
    "m2 > d1",
    "d1 > m5",
    "m5 0> m8",
    "m5 1> m3",
    "m3 0> m6",
    "m3 1> m7",
    "m3 2> t2",
    "t2 > m4",
  ],
});

// ------------------------------------------------------------
// 6. Objeção de preço
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "06-objecao-de-preco.json",
  name: "6 · Quem pergunta o preço",
  descricao:
    "Responde “quanto custa” com o valor na hora e três saídas: ver por dentro, ver um plano mais leve ou fechar. Etiqueta quem falou que está caro, para você trabalhar essa lista depois.",
  trigger: "dm",
  keywords: ["preço", "preco", "valor", "quanto custa", "quanto é", "quanto e"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! Boa pergunta 👇\n\n[NOME DO PRODUTO] custa [PREÇO] — ou [CONDIÇÃO PARCELADA]. Nele vai [O QUE ESTÁ INCLUÍDO].\n\nO que faz mais sentido pra você agora?",
      [opcao("Ver por dentro 👀"), opcao("Está caro pra mim"), opcao("Quero fechar 🤝")]
    ),
    msg(
      "m2",
      "Deixei a página com tudo destrinchado: o que entra, quanto tempo leva e o que dizem as pessoas que já fizeram.",
      [link("Ver a página", "https://exemplo.com/[SUA-PAGINA]")]
    ),
    etiqueta("t1", "viu-a-pagina"),
    espera("d1", 1200),
    msg("m5", "{{first_name}}, conseguiu dar uma olhada? Ficou alguma dúvida?", [
      opcao("Ficou uma dúvida"),
      opcao("Tudo claro 👍"),
    ]),
    msg("m6", "Manda aqui que eu te respondo 🙂"),
    msg("m7", "Então é só isso 👇", [link("Começar agora", "https://exemplo.com/[CHECKOUT]")]),
    etiqueta("t2", "objecao-preco"),
    msg(
      "m3",
      "Entendo, {{first_name}} 🙂\n\nDuas saídas: dá para parcelar em [X]x de [VALOR], e existe [PLANO MENOR] por [PREÇO MENOR], que já resolve [O PROBLEMA PRINCIPAL].",
      [link("Ver o plano menor", "https://exemplo.com/[PLANO-MENOR]")]
    ),
    etiqueta("t3", "quer-fechar"),
    msg(
      "m4",
      "Perfeito! É por aqui 👇\n\nSe travar alguma coisa no pagamento, me chama nesta mesma conversa que eu resolvo.",
      [link("Finalizar compra", "https://exemplo.com/[CHECKOUT]")]
    ),
  ],
  edges: [
    "start > m1",
    "m1 0> m2",
    "m1 1> t2",
    "m1 2> t3",
    "m2 > t1",
    "t1 > d1",
    "d1 > m5",
    "m5 0> m6",
    "m5 1> m7",
    "t2 > m3",
    "t3 > m4",
  ],
});

// ------------------------------------------------------------
// 7. Agendamento de avaliação
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "07-agendamento.json",
  name: "7 · Agendamento de avaliação",
  descricao:
    "Pergunta o período preferido, pede o follow, manda a agenda e confere 2 horas depois se a pessoa marcou. Quem não achou horário cai numa lista de encaixe.",
  trigger: "comment",
  keywords: ["agendar", "avaliação", "avaliacao", "horário", "horario", "quero"],
  public_replies: ["Te chamei no direct para marcar 📅", "Já estou no seu privado ✅"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! Vamos marcar a sua [AVALIAÇÃO / SESSÃO] 📅\n\nSão [DURAÇÃO] em [ENDEREÇO OU ONLINE], sem compromisso. Qual período funciona melhor pra você?",
      [opcao("Manhã ☀️"), opcao("Tarde 🌤️"), opcao("Noite 🌙")]
    ),
    etiqueta("t1", "prefere-manha"),
    etiqueta("t2", "prefere-tarde"),
    etiqueta("t3", "prefere-noite"),
    seguir(
      "g1",
      "Perfeito! Me segue aqui para eu conseguir te mandar a confirmação e os lembretes por este chat 👇"
    ),
    msg("m2", "Fechado! Escolhe o horário que ficar melhor pra você 👇", [
      link("Ver horários", "https://exemplo.com/[SUA-AGENDA]"),
    ]),
    espera("d1", 120),
    msg("m3", "{{first_name}}, conseguiu escolher o horário?", [
      opcao("Marquei ✅"),
      opcao("Não achei horário"),
      opcao("Mudei de ideia"),
    ]),
    etiqueta("t4", "agendou"),
    email(
      "e1",
      "Show! Me manda seu e-mail que eu envio a confirmação e o lembrete por lá também 👇"
    ),
    msg(
      "m4",
      "Confirmado, {{first_name}}! Te espero 🙌\n\nSe precisar remarcar, é só me avisar por aqui — sem problema nenhum."
    ),
    etiqueta("t5", "sem-horario"),
    msg("m5", "Me diz dois dias e horários que funcionam pra você que eu abro um encaixe 🙏"),
    etiqueta("t6", "desistiu"),
    msg(
      "m6",
      "Sem problema 🙂 O convite fica de pé — é só mandar “agendar” aqui quando fizer sentido."
    ),
  ],
  edges: [
    "start > m1",
    "m1 0> t1",
    "m1 1> t2",
    "m1 2> t3",
    "t1 > g1",
    "t2 > g1",
    "t3 > g1",
    "g1 > m2",
    "m2 > d1",
    "d1 > m3",
    "m3 0> t4",
    "m3 1> t5",
    "m3 2> t6",
    "t4 > e1",
    "e1 > m4",
    "t5 > m5",
    "t6 > m6",
  ],
});

// ------------------------------------------------------------
// 8. Aula ao vivo: inscrição e lembretes
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "08-aula-ao-vivo.json",
  name: "8 · Aula ao vivo com lembrete",
  descricao:
    "Inscreve no comentário, guarda o e-mail, manda o link da sala e volta 20 horas depois para confirmar presença — com o “estamos começando” uma hora antes de entrar.",
  trigger: "comment",
  keywords: ["aula", "quero participar", "eu quero", "live"],
  public_replies: ["Te mandei o link no direct 📩", "Já foi para o seu privado ✅"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! A aula [NOME DA AULA] é dia [DATA], às [HORA] 🎥\n\nÉ gratuita e ao vivo. Quer que eu te mande o link e o lembrete?",
      [opcao("Quero sim 🙌"), opcao("Sobre o que é?")]
    ),
    msg(
      "m2",
      "Na aula eu mostro [PONTO 1], [PONTO 2] e [PONTO 3] — em [DURAÇÃO], direto ao ponto, com espaço para perguntas no fim.\n\nTe garanto uma vaga?",
      [opcao("Garante sim ✅"), opcao("Fica pra próxima")]
    ),
    email("e1", "Perfeito! Me manda seu melhor e-mail que a inscrição vai para lá 👇"),
    etiqueta("t1", "inscrito-na-aula"),
    msg("m3", "Inscrição confirmada ✅\n\nSalva o link da sala — é o mesmo no dia da aula:", [
      link("Salvar o link", "https://exemplo.com/[LINK-DA-SALA]"),
    ]),
    espera("d1", 1200),
    msg(
      "m4",
      "{{first_name}}, a aula [NOME DA AULA] é [HOJE OU AMANHÃ] às [HORA] ⏰\n\nVocê vem?",
      [opcao("Tô dentro 🔥"), opcao("Não vou conseguir")]
    ),
    etiqueta("t2", "confirmou-presenca"),
    espera("d2", 60),
    msg("m5", "Começando em instantes, {{first_name}}! Entra por aqui 👇", [
      link("Entrar na sala", "https://exemplo.com/[LINK-DA-SALA]"),
    ]),
    etiqueta("t3", "nao-vai-a-aula"),
    msg(
      "m6",
      "Sem problema! Eu deixo a gravação disponível por [PRAZO] e te mando o link por aqui 🙌"
    ),
    msg("m8", "Combinado! Eu te aviso quando tiver a próxima 😉"),
    etiqueta("t8", "aula-recusou"),
  ],
  edges: [
    "start > m1",
    "m1 0> e1",
    "m1 1> m2",
    "m2 0> e1",
    "m2 1> m8",
    "m8 > t8",
    "e1 > t1",
    "t1 > m3",
    "m3 > d1",
    "d1 > m4",
    "m4 0> t2",
    "m4 1> t3",
    "t2 > d2",
    "d2 > m5",
    "t3 > m6",
  ],
});

// ------------------------------------------------------------
// 9. Atendimento 24h de loja
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "09-atendimento-24h.json",
  name: "9 · Atendimento 24h da loja",
  descricao:
    "Responde na hora as três perguntas que mais chegam no direct de loja: cadê meu pedido, como troco e qual o prazo. Quem quer gente é etiquetado e some da fila automática.",
  trigger: "dm",
  keywords: [],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! 👋 Sou o atendimento de [SUA LOJA] e respondo na hora, a qualquer horário.\n\nSobre o que você precisa?",
      [opcao("Meu pedido 📦"), opcao("Trocas e prazos"), opcao("Falar com pessoa")]
    ),
    msg(
      "m2",
      "Para acompanhar seu pedido, é só entrar com o número que veio no e-mail de confirmação 👇\n\nSe já passou de [PRAZO] sem atualizar, me chama aqui que eu verifico pra você.",
      [link("Rastrear pedido", "https://exemplo.com/[RASTREIO]")]
    ),
    msg("m3", "Claro! O que você quer saber?", [
      opcao("Prazo de entrega"),
      opcao("Como trocar"),
      opcao("Formas de pagar"),
    ]),
    msg(
      "m4",
      "📦 Prazo de entrega\n\n[REGIÃO 1]: [X] dias úteis\n[REGIÃO 2]: [Y] dias úteis\n\nO envio sai em até [Z] dias úteis depois de o pagamento ser confirmado."
    ),
    msg(
      "m5",
      "🔁 Trocas e devoluções\n\nVocê tem [X] dias corridos depois de receber. O produto precisa estar [CONDIÇÃO]. A primeira troca é [GRÁTIS OU COM CUSTO].",
      [link("Abrir uma troca", "https://exemplo.com/[TROCAS]")]
    ),
    msg(
      "m6",
      "💳 Formas de pagamento\n\nPix (com [X]% de desconto), cartão em até [X]x e boleto.\n\nNo Pix o envio é liberado na hora que o pagamento cai."
    ),
    etiqueta("t1", "atendimento-humano"),
    msg(
      "m7",
      "Já chamei alguém da equipe 🙋\n\nEscreve aqui o que você precisa (com o número do pedido, se tiver) que a gente responde em até [PRAZO], no horário [HORÁRIO DE ATENDIMENTO]."
    ),
  ],
  edges: [
    "start > m1",
    "m1 0> m2",
    "m1 1> m3",
    "m1 2> t1",
    "m3 0> m4",
    "m3 1> m5",
    "m3 2> m6",
    "t1 > m7",
  ],
});

// ------------------------------------------------------------
// 10. Quiz de segmentação
// ------------------------------------------------------------
FLUXOS.push({
  arquivo: "10-quiz-de-segmentacao.json",
  name: "10 · Quiz de 2 perguntas",
  descricao:
    "Duas perguntas, quatro perfis e uma recomendação diferente para cada um. A pessoa sai etiquetada, com e-mail e com o conteúdo certo na mão — e você sai com a lista separada.",
  trigger: "comment",
  keywords: ["quiz", "teste", "descobrir", "eu quero"],
  public_replies: ["Te mandei o quiz no direct 🧩", "Começou! Confere o privado 👀"],
  nodes: [
    msg(
      "m1",
      "Oi {{first_name}}! Duas perguntas rápidas e eu te digo qual [CAMINHO OU PLANO] combina com você 🧩\n\nPergunta 1: onde você está hoje?",
      [opcao("Começando do zero"), opcao("Já tenho algo")]
    ),
    etiqueta("t1", "perfil-iniciante"),
    etiqueta("t2", "perfil-avancado"),
    msg("m2", "Ótimo, todo mundo começa aí 🌱\n\nPergunta 2: o que mais te trava hoje?", [
      opcao("Falta de tempo ⏳"),
      opcao("Não sei por onde"),
    ]),
    msg("m3", "Boa, então dá para acelerar 🚀\n\nPergunta 2: o que mais te trava agora?", [
      opcao("Poucos clientes"),
      opcao("Falta de processo"),
    ]),
    etiqueta("t3", "trava-tempo"),
    etiqueta("t4", "trava-direcao"),
    etiqueta("t5", "trava-clientes"),
    etiqueta("t6", "trava-processo"),
    msg(
      "m4",
      "Seu perfil: começando com pouco tempo ⏳\n\nO caminho mais curto pra você é [RECOMENDAÇÃO 1], porque [MOTIVO EM UMA FRASE].",
      [link("Ver o caminho", "https://exemplo.com/[RECOMENDACAO-1]")]
    ),
    msg(
      "m5",
      "Seu perfil: começando sem direção 🧭\n\nComeça por [RECOMENDAÇÃO 2] — é o que organiza tudo antes de você gastar energia à toa.",
      [link("Ver o caminho", "https://exemplo.com/[RECOMENDACAO-2]")]
    ),
    msg(
      "m6",
      "Seu perfil: rodando, mas sem clientes 📣\n\nSua prioridade é [RECOMENDAÇÃO 3]: [MOTIVO EM UMA FRASE].",
      [link("Ver o caminho", "https://exemplo.com/[RECOMENDACAO-3]")]
    ),
    msg(
      "m7",
      "Seu perfil: rodando, mas no sufoco 🧯\n\nAntes de vender mais, arruma [RECOMENDAÇÃO 4] — senão o volume novo vira problema.",
      [link("Ver o caminho", "https://exemplo.com/[RECOMENDACAO-4]")]
    ),
    email(
      "e1",
      "Quer o resultado completo por e-mail também, com o passo a passo? Manda seu melhor e-mail 👇"
    ),
    msg(
      "m8",
      "Enviado 📩\n\nE se quiser conversar sobre o seu caso, é só me responder aqui — eu leio tudo."
    ),
  ],
  edges: [
    "start > m1",
    "m1 0> t1",
    "m1 1> t2",
    "t1 > m2",
    "t2 > m3",
    "m2 0> t3",
    "m2 1> t4",
    "m3 0> t5",
    "m3 1> t6",
    "t3 > m4",
    "t4 > m5",
    "t5 > m6",
    "t6 > m7",
    "m4 > e1",
    "m5 > e1",
    "m6 > e1",
    "m7 > e1",
    "e1 > m8",
  ],
});

// ============================================================
// Escrita dos arquivos
// ============================================================
mkdirSync(DESTINO, { recursive: true });

const prontos = FLUXOS.map((def) => ({ arquivo: def.arquivo, fluxo: montar(def) }));

for (const { arquivo, fluxo } of prontos) {
  const corpo = { formato: 1, fluxos: [fluxo] };
  writeFileSync(join(DESTINO, arquivo), `${JSON.stringify(corpo, null, 2)}\n`, "utf8");
}

// O pacote completo é o arquivo que a pessoa importa de uma vez: um clique e os
// dez fluxos entram pausados.
writeFileSync(
  join(DESTINO, "00-pacote-completo.json"),
  `${JSON.stringify({ formato: 1, fluxos: prontos.map((p) => p.fluxo) }, null, 2)}\n`,
  "utf8"
);

console.log(`${prontos.length} fluxos gerados em fluxos-prontos/`);
for (const { arquivo, fluxo } of prontos) {
  const blocos = fluxo.nodes.filter((n) => n.kind !== "start").length;
  console.log(`  ${arquivo.padEnd(30)} ${String(blocos).padStart(2)} blocos · ${fluxo.name}`);
}
