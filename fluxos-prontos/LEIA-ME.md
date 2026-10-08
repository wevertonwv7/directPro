# 10 fluxos prontos

Dez fluxos completos, prontos para importar. Cada arquivo `.json` é um fluxo; o
`00-pacote-completo.json` traz os dez de uma vez.

Eles não são exemplos de demonstração: cada um resolve uma situação que acontece
todo dia no direct — e todos já vêm com o caminho de quem diz **não**, que é a
parte que quase ninguém monta e é onde mora metade das vendas.

## Como importar (2 minutos)

1. No painel, abra **Fluxos → Importar**.
2. Escolha o arquivo `.json` (ou cole o conteúdo dele).
3. Confira a prévia e clique em **Importar**.

Tudo entra **pausado**. Nada é enviado até você ativar.

## Antes de ativar

Cada fluxo vem com marcações **entre colchetes** — `[NOME DO MATERIAL]`,
`[SUA-AGENDA]`, `[X]%` — no lugar do que é do seu negócio. O painel conta
quantas sobraram e avisa no topo do editor enquanto houver alguma.

Três coisas para conferir em cada fluxo:

- **Os textos entre colchetes.** Troque todos, inclusive dentro dos botões.
- **Os links.** Todo endereço `https://exemplo.com/...` precisa virar o seu.
- **O post do gatilho.** Fluxos de comentário chegam valendo para *todos* os
  posts. Se você quer só um, escolha o post dentro do fluxo.

O `{{first_name}}` você pode deixar como está: ele vira o primeiro nome de quem
respondeu na hora do envio (e `{{first_name|tudo bem}}` usa "tudo bem" quando a
pessoa não tem nome público).

## Os dez fluxos

| Arquivo | Dispara quando | O que faz |
|---|---|---|
| `01-isca-digital.json` | comentam "quero", "link" | Entrega um material no direct: pede o follow, manda o link, guarda o e-mail e volta no dia seguinte para saber se a pessoa usou. |
| `02-lista-de-espera.json` | comentam "lista", "quero entrar" | Monta a lista de espera do lançamento com e-mail e separa por nível (iniciante / intermediário / avançado). |
| `03-cupom-primeira-compra.json` | comentam "cupom", "desconto" | Libera o cupom depois do follow, cobra o uso em 3 horas e faz a última chamada antes de vencer. |
| `04-qualificacao-de-lead.json` | mandam "orçamento", "proposta" no direct | Três perguntas que separam o que a pessoa precisa, a urgência e o e-mail — e terminam no link da sua agenda. |
| `05-menu-do-story.json` | qualquer resposta a story | Menu de três caminhos: comprar, tirar dúvida ou falar com uma pessoa. Nenhuma resposta de story fica sem retorno. |
| `06-objecao-de-preco.json` | mandam "preço", "quanto custa" | Responde o valor na hora e abre três saídas: ver por dentro, ver um plano mais leve ou fechar. |
| `07-agendamento.json` | comentam "agendar", "avaliação" | Pergunta o período preferido, manda a agenda e confere 2 horas depois se a pessoa marcou. |
| `08-aula-ao-vivo.json` | comentam "aula", "live" | Inscreve, guarda o e-mail, manda o link da sala e lembra na véspera e uma hora antes. |
| `09-atendimento-24h.json` | qualquer mensagem no direct | Responde as três dúvidas de loja que mais chegam: cadê meu pedido, como troco, qual o prazo. |
| `10-quiz-de-segmentacao.json` | comentam "quiz", "teste" | Duas perguntas, quatro perfis, quatro recomendações — e a lista sai etiquetada. |

## As etiquetas

Vários fluxos etiquetam quem passa por eles (`lead`, `objecao-preco`,
`prazo-urgente`, `comprou`, `perfil-iniciante`…). As etiquetas aparecem em
**Contatos** e é por elas que você separa depois quem estava quente de quem
estava só olhando. Renomeie à vontade — o nome é livre.

## Detalhes que valem saber

- **Espera de 20 horas.** É o limite prático: o Instagram só deixa mandar
  mensagem até 24 horas depois da última interação da pessoa. Esperas mais
  longas do que isso não seriam entregues.
- **Botões de link e opções de resposta não se misturam** numa mesma mensagem —
  é regra da Meta. Nos fluxos, cada mensagem usa um ou outro.
- **Rótulo de botão tem 20 caracteres.** Se você aumentar um rótulo, o painel
  corta no limite ao salvar.
- **"Só para quem segue"** deixa passar quem já segue e, para quem não segue,
  manda o pedido com o botão. No Facebook esse bloco não tem como conferir e
  deixa todo mundo passar.

## Refazer os arquivos

Estes `.json` são gerados a partir de `scripts/gerar-fluxos-prontos.mjs`, que
confere os limites da Meta e calcula a posição dos blocos:

```bash
node scripts/gerar-fluxos-prontos.mjs
```
