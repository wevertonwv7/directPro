# DirectPro 💬

**Comentário vira DM.** Automatize o seu Instagram sem mensalidade: quando alguém comenta uma
palavra-chave num post ou reels (ou responde um story), a pessoa recebe uma DM automática com o
seu link. Sua própria central de DMs, rodando de graça, para sempre, na sua conta.

## Como funciona

1. Alguém comenta a palavra-chave (ex.: `quero`) no seu post.
2. O app responde no privado na hora (essa resposta **fura a janela de 24h** — é permitida 1 vez
   por comentário, em até 7 dias) e, se você quiser, também responde publicamente no comentário.
3. A pessoa responde à mensagem → isso **abre a janela de 24h** da Meta. No Facebook Login,
   a primeira resposta privada apresenta as opções em texto.
4. O app manda a DM com o seu link (botão clicável) e, opcionalmente, um lembrete depois de X
   minutos.

Tudo pela **API oficial** do Instagram (nada de robô de navegador, que derruba conta). Também
funciona com resposta a story e DM recebida com palavra-chave.

## O que você precisa (tudo grátis)

| O quê | Para quê |
|---|---|
| Conta **GitHub** | guardar a sua cópia do código |
| Conta **Vercel** (entre com o GitHub) | hospedar o app + banco de dados |
| Conta **Meta for Developers** (conta do Facebook) | criar o app da API do Instagram |
| Instagram **Profissional** (Comercial ou Criador) | a API só funciona nesse tipo de conta |
| Página do Facebook vinculada ao Instagram | autenticação pela API com Facebook Login |

> Sua conta é pessoal? Instagram → Configurações → Central de contas → Tipo de conta → **Mudar
> para conta profissional**. Leva 1 minuto e é reversível.

## Instalação (15 minutos, sem programar — siga junto com o vídeo)

### Parte 1 — Subir o código no seu GitHub

1. Crie sua conta em [github.com](https://github.com) (se ainda não tiver).
2. Acesse [github.com/new](https://github.com/new): nome `many`, marque **Private** → **Create
   repository**.
3. Na página do repositório vazio, clique em **"uploading an existing file"**. Abra a pasta
   descompactada, **selecione tudo que está DENTRO dela** (Ctrl+A / Cmd+A) e arraste. Não
   arraste a pasta em si.
4. Clique em **Commit changes**.

> ⚠️ **Confira antes de seguir.** A lista de arquivos do repositório precisa mostrar
> `app`, `lib`, `public`, `package.json` e `next.config.ts` **no primeiro nível**.
>
> Se você vir **uma pasta só** (algo como `directpro` ou `many-main`), o upload foi aninhado: a
> Vercel não vai encontrar o app e o site responde `404: NOT_FOUND`. Apague os arquivos e refaça
> o passo 3 arrastando o *conteúdo* da pasta — ou veja a correção sem refazer nada em
> [COMO-ATUALIZAR.md](COMO-ATUALIZAR.md#404-not_found-no-site-publicado).

### Parte 2 — Publicar na Vercel

1. Acesse [vercel.com/new](https://vercel.com/new) e entre com o GitHub.
2. Em **Import Git Repository**, importe o `many`.
3. Antes de concluir, abra **Environment Variables** e adicione `ADMIN_PASSWORD` = a senha que
   você quer para o seu painel. Configure também `APP_URL` e `CREDENTIALS_ENCRYPTION_KEY`
   conforme [.env.example](.env.example) e [o guia da integração](docs/INSTAGRAM-FACEBOOK-LOGIN.md).
   Clique em **Deploy**.
4. Depois do deploy: aba **Storage** → **Create Database** → **Neon** → plano Free → **Create**
   → **Connect** ao projeto (pode deixar tudo como está nas opções).
5. Aba **Deployments** → menu **⋯** do deploy mais recente → **Redeploy** (isso ativa o banco —
   as tabelas são criadas sozinhas).

### Parte 3 — Conectar o Instagram (assistente guiado)

Abra `https://SEU-APP.vercel.app`, entre com a sua senha e clique em **Configuração**. O
assistente mostra os passos com botões de copiar. Esta versão usa **Instagram API com Facebook
Login**; veja [configuração, permissões e diagnóstico](docs/INSTAGRAM-FACEBOOK-LOGIN.md).

1. Criar o app em
   [developers.facebook.com/apps/creation](https://developers.facebook.com/apps/creation/)
   (caso de uso **"Gerencie mensagens e conteúdo no Instagram"**).
2. Copiar o **ID e segredo do app principal Meta**, em Configurações do app → Básico.
3. Cadastrar na Meta as URLs que o assistente mostra (webhook + token de verificação + URI de
   redirecionamento OAuth) e assinar **comments**, **messages** e **messaging_postbacks**.
4. Vincular o Instagram profissional a uma Página e autorizar com um usuário que tenha acesso.
5. Cadastrar as URLs de privacidade (o app já serve as páginas) em Configurações → Básico e
   concluir as aprovações de acesso necessárias para usuários externos. Publicar o app sozinho
   não substitui App Review, Advanced Access e verificação empresarial exigidos pela Meta.
6. Clicar em **Conectar Instagram** no assistente e autorizar. Pronto.

### Parte 4 — Criar a primeira automação

**Automações → Nova automação**: palavra-chave, DM de boas-vindas, link e (opcional) lembrete.
Publique um post e **comente a palavra-chave com OUTRA conta** para testar. Acompanhe em
**Eventos**.

No seletor de post dá para **carregar mais posts** (a lista vem por lotes) ou **colar o link do
post** — útil quando o post é antigo e não aparece nos primeiros lotes.

## Fluxos: a automação em forma de mapa

**Fluxos → Novo fluxo** abre um editor em tela cheia, com blocos ligados por setas, no estilo do
ManyChat:

- **Enviar mensagem** — texto com botões de link *ou* opções de resposta;
- **Esperar** — segura o próximo passo por X minutos;
- **Pedir e-mail** — só continua depois que a pessoa informar (fica salvo em Contatos);
- **Só para quem segue** — confere na hora e libera o caminho (Instagram);
- **Etiquetar** — marca a pessoa; a etiqueta aparece em **Contatos**, com filtro e no CSV.

Cada **opção de resposta** tem a sua própria ligação: é assim que a conversa muda conforme o que
a pessoa escolhe. Para ligar dois blocos, arraste da bolinha da direita até o bloco de destino
(ou clique na bolinha e depois no bloco).

Atalhos: arraste o fundo para navegar, **Ctrl + rolar** amplia, **Del** apaga o bloco
selecionado, **Ctrl+D** duplica e **Organizar** arruma tudo em árvore.

Fluxo e automação simples convivem: use a automação para o caminho único e direto (a maioria dos
casos) e o fluxo quando precisar de caminhos diferentes. Quando os dois casam com a mesma
palavra-chave, o **fluxo tem prioridade**.

### Anexos: imagem, áudio e vídeo

Blocos de mensagem (nos fluxos) e as etapas da automação simples aceitam um **anexo**. A Meta não
recebe arquivo: ela recebe um **endereço público** e busca o arquivo do lado dela na hora de
entregar. Por isso o campo é um link — e por isso o app continua sem custo mensal, já que não
precisa de nenhum serviço de armazenamento.

- **Imagem** jpg, png, gif — até 8 MB · **Áudio** aac, m4a, wav, mp3 — até 25 MB ·
  **Vídeo** mp4, mov, webm — até 25 MB.
- O link precisa **abrir sem login**. Link do Google Drive em modo visualização entrega uma
  página HTML, não o arquivo; no Dropbox, acrescente `?raw=1`. O painel avisa nos dois casos.
- A **prévia** dentro do campo carrega o endereço do mesmo jeito que a Meta vai carregar: se não
  aparecer ali, não chega no direct.
- Anexo e texto são **duas mensagens** (regra da Meta): a mídia sai primeiro, o texto e os botões
  logo depois.
- A **primeira mensagem depois de um comentário** é uma resposta privada e só aceita texto — o
  painel não oferece anexo ali e avisa se você puser num fluxo.
- Se o anexo falhar (link quebrado, arquivo grande demais), **o texto vai assim mesmo** e a falha
  fica registrada em **Atividade**, com o motivo. Uma imagem não derruba a conversa.

### Importar e exportar fluxos

Um fluxo é um arquivo `.json` que dá para guardar, mandar para alguém e importar em outra conta:

- **Fluxos → Importar** aceita um fluxo, uma lista ou um pacote inteiro. A tela mostra a prévia
  (nome, gatilho, quantos blocos, quanta coisa falta personalizar) **antes** de gravar qualquer
  coisa, e tudo entra **pausado**.
- **Exportar** baixa um fluxo; **Exportar todos** baixa a conta inteira num arquivo só.

O post e o story do gatilho **não** vão no arquivo de propósito: são IDs de uma conta específica
e, em outra conta, apontariam para uma publicação que não existe. O fluxo importado vale para
todos os posts até você escolher um.

A pasta [`fluxos-prontos/`](fluxos-prontos/) traz **10 fluxos completos** para importar (isca
digital, lista de espera, cupom, qualificação de lead, menu do story, objeção de preço,
agendamento, aula ao vivo, atendimento 24h e quiz de segmentação). Eles vêm com marcações entre
colchetes — `[SEU LINK]`, `[NOME DO MATERIAL]` — e o editor avisa no topo enquanto sobrar alguma.
Detalhes em [`fluxos-prontos/LEIA-ME.md`](fluxos-prontos/LEIA-ME.md).

## Lembretes na hora certa (opcional, recomendado)

Para o lembrete "depois de 60 min" sair na hora exata, instale o **QStash** (grátis): painel da
Vercel → **Marketplace → Upstash QStash** → conecte ao projeto → Redeploy. Sem ele o app
continua funcionando — os envios imediatos saem na hora e os lembretes saem no próximo evento ou
no cron diário.

## Limites reais (para ninguém se frustrar)

- **Não dá** para exigir que a pessoa te siga antes de receber o link — a API não permite
  verificar seguidores. Dá só para pedir na mensagem.
- **Não dá** para saber se a pessoa clicou no link — por isso o lembrete é por tempo.
- **Disparo em massa para base fria é proibido** pela Meta e derruba a conta. Este app só
  responde a quem interagiu (comentário/story/DM) — e é por isso que ele é seguro.
- Limites de envio conservadores embutidos: ~1,6 mensagens/segundo e ~190/hora.
- Tokens e acesso aos dados podem expirar ou ser revogados. Contas com Facebook Login devem
  ser reconectadas quando necessário; não usam a renovação do antigo Instagram Login.

## Arquitetura (para quem é técnico)

- **Next.js 16** (App Router, `proxy.ts`) na Vercel Hobby; painel em PT-BR protegido por senha.
- **Fluxos** (`lib/flow.ts`): o desenho é um documento jsonb na tabela `flows`; onde cada pessoa
  parou fica em `flow_runs`, porque a continuação depende de um evento futuro (toque no botão,
  e-mail, tempo passar). O arquivo `.json` de import/export é lido por `lib/flow-io.ts`, que
  passa tudo por `normalizarGrafo` — o mesmo funil do editor, porque arquivo que veio de fora
  não é dado confiável.
- **Postgres (Neon)** via marketplace da Vercel; schema criado automaticamente no primeiro
  acesso (`lib/db.ts`). Fila com trava atômica (`FOR UPDATE SKIP LOCKED`) e registro de envios.
  Envios com confirmação incerta exigem conferência manual, evitando repetição automática.
- **Motor orientado a eventos**: o webhook valida a assinatura HMAC, enfileira e drena a fila na
  mesma requisição (`after()`). **QStash** (opcional) acorda o app na hora dos lembretes. **Cron
  diário** renova o token e faz drenagem de segurança.
- Credenciais da Meta ficam cifradas no banco (via `/setup`); a chave de criptografia fica no
  servidor. O webhook persiste os eventos antes de confirmar o recebimento.

## Licença

**Uso pessoal** — instale para as suas contas ou de clientes diretos, modifique à vontade.
**Proibido revender ou redistribuir o código.** Veja [LICENSE](LICENSE).
