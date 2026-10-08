// ============================================================
// Traduzir o erro da Meta para o que a pessoa precisa fazer
//
// A Meta devolve coisas como:
//   Instagram API 400: {"error":{"message":"API access blocked.",
//                       "type":"OAuthException","code":200,...}}
//
// Isso não diz nada para quem comprou o app — e, pior, o palpite óbvio
// ("reconectar a conta") costuma ser o palpite errado. O que separa os casos é
// o CÓDIGO, não o texto:
//
//   190 → o token não vale mais            → reconectar resolve
//   200 → o app não tem permissão          → reconectar NÃO resolve
//     4 / 17 / 32 / 613 → limite de chamadas → esperar resolve
//    10 / 803 → recurso fora do alcance do app
//
// Este arquivo roda nos dois lados (a lista de Atividade e a tela de
// Configuração usam o mesmo diagnóstico), por isso não importa "server-only".
// ============================================================

export type DiagnosticoMeta = {
  // Uma frase: o que aconteceu.
  resumo: string;
  // O que fazer, na ordem em que vale a pena tentar. Lista vazia = nada a fazer.
  passos: string[];
  // true quando o problema é do app/conta e vai se repetir até alguém agir —
  // em oposição a instabilidade passageira, que se resolve sozinha.
  precisaDeAcao: boolean;
};

// Tira o corpo JSON de dentro da mensagem crua do erro.
function corpoDoErro(bruto: string): { message?: string; code?: number; error_subcode?: number } {
  const abre = bruto.indexOf("{");
  if (abre < 0) return {};
  try {
    const json = JSON.parse(bruto.slice(abre)) as {
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    return json.error ?? {};
  } catch {
    return {};
  }
}

export function codigoDoErroMeta(bruto: string | null | undefined): number | null {
  if (!bruto) return null;
  return corpoDoErro(bruto).code ?? null;
}

// O bloqueio de acesso do app é o caso que mais confunde: ele derruba TUDO ao
// mesmo tempo (listar posts, mandar DM, responder comentário), porque não é uma
// permissão específica que falhou — é o app inteiro que está sem acesso.
const PASSOS_ACESSO_BLOQUEADO = [
  "Conta como testadora: no painel da Meta, em Funções do app → Testadores do Instagram, a conta precisa aparecer como aceita (não pendente). O convite se aceita PELO NAVEGADOR, no computador, em instagram.com/accounts/manage_access → Apps e sites → Convites de testador — é o mesmo passo 5 desta tela.",
  "App no ar: o botão no topo do painel do app tem que estar em “Ao vivo”, não em Desenvolvimento.",
  "App restringido: se houver faixa vermelha no topo do painel do app, leia o motivo. Verificação de Uso de Dados vencida é a causa mais comum de o acesso cair sem ninguém ter mexido em nada.",
  "Tipo da conta: o Instagram precisa continuar como Profissional (Comercial ou Criador).",
  "Acesso avançado: em Revisão do app → Permissões e recursos, as permissões do Instagram precisam estar em Acesso avançado para valer com contas que não são testadoras.",
];

export function diagnosticoDaMeta(bruto: string | null | undefined): DiagnosticoMeta | null {
  if (!bruto) return null;
  const { message = "", code } = corpoDoErro(bruto);
  const texto = `${bruto} ${message}`.toLowerCase();

  // 200 = permissão. Reconectar não resolve: o token está bom, o app é que
  // está sem acesso.
  if (code === 200 || texto.includes("api access blocked")) {
    return {
      resumo:
        "A Meta bloqueou o acesso do seu app — não é a conta que desconectou, e reconectar não resolve. Quando isto acontece, para tudo de uma vez: listar posts, mandar mensagem e responder comentário.",
      passos: PASSOS_ACESSO_BLOQUEADO,
      precisaDeAcao: true,
    };
  }

  // Erro da troca do código do OAuth. A mensagem da Meta fala em redirect_uri,
  // mas o que ela compara são TRÊS coisas: o endereço usado no diálogo de
  // autorização, o usado na troca do código e a lista cadastrada no app. Basta
  // um deles diferir — inclusive por uma barra no fim — para dar isto.
  if (texto.includes("error validating verification code") || texto.includes("redirect_uri")) {
    return {
      resumo:
        "A Meta recusou o código de autorização porque o endereço de retorno não bate com o que está cadastrado no app.",
      passos: [
        "Cadastre o endereço exato: em Configuração, passo 3, o painel mostra a “URI de redirecionamento OAuth”. Copie de lá e cole na Meta em Instagram → Configuração da API → URIs de redirecionamento do OAuth. Tem que bater caractere por caractere — sem barra no fim, sem www a mais ou a menos.",
        "Trocou de domínio ou de projeto? Então o endereço cadastrado na Meta é o antigo. É a causa mais comum quando o OAuth funcionava e parou.",
        "Se você abriu o painel por um endereço e o cadastrado é outro, cadastre os dois na Meta — vale o endereço pelo qual você clica em “Conectar”.",
        "Já tentou uma vez e voltou a esta tela? Comece de novo pelo botão “Conectar Instagram”: o código da Meta só serve uma vez, e recarregar a página de retorno reaproveita um código já gasto.",
      ],
      precisaDeAcao: true,
    };
  }

  if (code === 190 || texto.includes("access token") || texto.includes("session has expired")) {
    return {
      resumo: "O token desta conta não vale mais.",
      passos: [
        "Reconecte a conta aqui em Configuração — isto gera um token novo.",
        "Se acabou de reconectar e voltou a falhar, confira se a senha do Instagram mudou ou se o acesso do app foi revogado no aplicativo do Instagram.",
      ],
      precisaDeAcao: true,
    };
  }

  if (code === 10 || code === 803 || texto.includes("does not exist")) {
    return {
      resumo:
        "A Meta respondeu que este conteúdo não existe ou está fora do alcance do app. Costuma ser post apagado, comentário removido ou permissão que o app ainda não tem.",
      passos: [
        "Se for um post: confira se ele ainda está publicado nesta conta.",
        "Se acabou de conceder uma permissão nova na Meta, reconecte a conta para o token passar a carregá-la.",
      ],
      precisaDeAcao: true,
    };
  }

  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return {
      resumo: "A Meta limitou o volume de chamadas por enquanto.",
      passos: ["Não precisa fazer nada: o sistema volta a tentar sozinho mais tarde."],
      precisaDeAcao: false,
    };
  }

  if (/ API 5\d\d/.test(bruto)) {
    return {
      resumo: "A Meta ficou instável na hora.",
      passos: ["Não precisa fazer nada: o sistema tenta de novo sozinho."],
      precisaDeAcao: false,
    };
  }

  return null;
}
