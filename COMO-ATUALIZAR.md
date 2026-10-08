# Como atualizar e publicar mudanças

Guia rápido para levar uma alteração até os installs na Vercel. Vale para este
repo (`many`) e para o `webhook-router`.

## Como funciona (resumo)
Cada projeto na Vercel está conectado a este repositório, com **Production
Branch = `main`**. Regra de ouro:

> **Todo push na `main` dispara uma deploy automática** nos projetos conectados.

Então "atualizar" = colocar o código novo na `main`. Nunca commite direto na
`main` em produção sem revisar — trabalhe numa branch e depois traga para a
`main`.

---

## Caminho A — Pelo site do GitHub (sem terminal) ⭐ mais fácil
1. Abra o repositório no GitHub → aba **Pull requests** → **New pull request**.
2. Em cima: **base: `main`** ← **compare: `sua-branch`**.
3. Revise os commits e arquivos que vão entrar (é aqui que você "confere o
   estado").
4. **Create pull request** → **Merge pull request** → **Confirm merge**.
5. O merge atualiza a `main` e **dispara a deploy** nos installs conectados.

Se aparecer *"This branch has conflicts"*, a `main` andou e bateu de frente com
a branch. Dá para resolver ali mesmo no GitHub, ou pelo terminal (Caminho B).

---

## Caminho B — Git no terminal
```bash
# 1. Atualiza as referências do remoto (não mexe nos seus arquivos)
git fetch origin

# 2. CONFIRA O ESTADO antes de mergear:
git log --oneline origin/main..sua-branch    # o que a branch tem a mais (vai entrar)
git log --oneline sua-branch..origin/main    # divergência: idealmente VAZIO

# 3. Vai para a main e atualiza
git checkout main
git pull origin main

# 4. Traz a branch para a main
git merge sua-branch

# 5. Envia — isto dispara a deploy
git push origin main
```

Como ler o passo 2:
- Segundo comando **vazio** → é um **fast-forward** limpo, sem conflito.
- Segundo comando **com commits** → a `main` tem coisa que a branch não tem. O
  `git merge` cria um commit de merge e **pode dar conflito**. Se der: o git
  lista os arquivos, você edita, `git add` neles, `git commit` para concluir e
  então `git push`.

Confirme que subiu:
```bash
git log --oneline -3 origin/main   # seu commit deve estar no topo
```

---

## Disparar uma deploy manualmente (sem commit novo)
Útil para **aplicar env vars novas** (env var só entra numa deploy nova) ou
reprocessar.

**Redeploy (mais simples):**
1. Projeto na Vercel → aba **Deployments**.
2. Na deploy de produção → **⋯** → **Redeploy**.
3. Desmarque **"Use existing Build Cache"** se quiser build limpo → **Redeploy**.

**Deploy Hook (URL reutilizável):**
1. Projeto → **Settings → Git → Deploy Hooks** → criar com a branch `main`.
2. Guarde a URL. Para disparar: `curl -X POST "<URL_DO_HOOK>"`.
   (Redeploy repete o mesmo commit; o Deploy Hook pega o último commit da `main`.)

---

## "Deployment Blocked" — autor do commit sem acesso

Sintoma: a deploy nem começa. Aparece uma faixa vermelha:

> **Deployment Blocked** — The deployment was blocked because the commit author
> did not have contributing access to the project on Vercel.
> The Hobby Plan does not support collaboration for private repositories.

Também não é erro do código: no plano **Hobby** com repositório **privado**, a
Vercel só constrói commits cujo **autor** é o dono da conta Vercel. Qualquer
outro autor é recusado antes de compilar.

### Como descobrir de quem é a conta
Olhe o endereço da deploy: `meuprojeto-git-main-`**`SEU-ESCOPO`**`.vercel.app`.
Esse escopo vem do usuário do GitHub que criou a conta na Vercel. Compare com o
dono do repositório (`github.com/`**`DONO`**`/many`).

**São diferentes?** É essa a causa. O repositório é de uma conta e o projeto da
Vercel é de outra, e no Hobby não dá para adicionar a segunda como colaboradora.

Confira também quem assina os commits:

```bash
git log -5 --format='%h | %an <%ae> | %s'
```

### Destravar agora (10 segundos)
Vercel → **Deployments** → **⋯** → **Redeploy**. Uma deploy disparada por você
no painel não passa pela conferência de autor, então ela sobe. Serve para o
código no ar não ficar parado enquanto você resolve a causa.

### Resolver de vez, da melhor para a pior
1. **Recriar o projeto na conta certa.** Entre na Vercel com o MESMO usuário do
   GitHub que é dono do repositório, importe o `many` por lá e aponte o domínio
   para esse projeto. Volta tudo a funcionar no Hobby, de graça.
2. **Deploy Hook.** Vercel → Settings → Git → Deploy Hooks → crie um para a
   `main` e chame `curl -X POST "<URL>"` depois de cada merge. Não passa pela
   conferência de autor, mas é um passo manual a cada atualização.
3. **Upgrade para o Pro.** Resolve, e é o único caminho se você quiser mesmo
   duas contas no mesmo projeto.

> ⚠️ **Não torne o repositório público para contornar isso.** O bloqueio some
> (o Hobby aceita colaboração em repositório público), mas o código do DirectPro
> é o produto que você vende — publicá-lo entrega o produto de graça.

---

## 404: NOT_FOUND no site publicado

Sintoma: a deploy aparece como concluída, mas abrir `https://SEU-APP.vercel.app`
mostra a tela branca da Vercel com:

> **404: NOT_FOUND** · Code: `NOT_FOUND` · ID: `gru1::…`

Esse 404 vem da **Vercel**, não do app: quer dizer que a deploy existe, mas
nenhuma rota casou com o endereço. Num app Next.js `/` sempre casa — a não ser
que a Vercel **não tenha construído o projeto como Next.js**. Nesse caso ela
publica os arquivos como site estático, não existe `index.html` na raiz, e todo
endereço responde 404.

### Como confirmar em 10 segundos
Vercel → **Deployments** → clique na deploy → **Building**. No log tem que
aparecer a linha:

> `Detected Next.js version: 16.2.10`

**Não apareceu?** É este o problema.

### Causa quase sempre a mesma: o código ficou uma pasta abaixo
A Vercel procura o `package.json` na **Root Directory** do projeto (por padrão,
a raiz do repositório). Se no upload para o GitHub você arrastou a **pasta**
descompactada em vez do **conteúdo** dela, o repositório ficou assim:

```
many/
└── directpro/          ← tudo foi parar aqui dentro
    ├── app/
    ├── package.json
    └── …
```

A Vercel olha a raiz, não acha `package.json`, não detecta framework nenhum e
publica um site estático vazio.

### Correção 1 — ajustar a Root Directory (não mexe no GitHub) ⭐
1. Vercel → projeto → **Settings → Build and Deployment**.
2. Em **Root Directory**, clique em **Edit** e escolha a pasta que contém o
   `package.json` (no exemplo acima, `directpro`).
3. **Save** → aba **Deployments** → **⋯ → Redeploy**.

### Correção 2 — refazer o upload no lugar certo
No GitHub, apague a pasta aninhada e repita o passo 3 da instalação
**selecionando tudo que está dentro** da pasta descompactada (Ctrl+A / Cmd+A) em
vez de arrastar a pasta. A lista de arquivos do repositório tem que mostrar
`app`, `lib`, `public` e `package.json` no primeiro nível.

### Se o log mostra "Detected Next.js" e mesmo assim dá 404
Aí não é detecção — é domínio sem deploy de produção. Vercel → **Deployments**:
confirme que existe uma deploy com o selo **Production** e status **Ready**. Se
a última produção falhou, o domínio continua apontando para o nada. Corrija o
erro do build (ou **⋯ → Promote to Production** numa deploy que deu certo).

> O repositório já traz `"framework": "nextjs"` no `vercel.json`, que força a
> detecção. Ele só é lido se estiver **na Root Directory** — por isso, com o
> código aninhado, a correção continua sendo uma das duas acima.

---

## Quando a deploy falha antes de compilar

### "Provisioning integrations failed" → *Branch limit reached*

Sintoma: a deploy morre em **2 segundos**, ambiente **Preview**, e em
*Provisioning Integrations* aparece:

> `Create database branch for deployment` — **Branch limit reached. Upgrade your
> plan or delete unused branches.**

**Não é erro do código** — o `next build` nem chegou a rodar. A integração do
Neon cria **uma branch do banco por deploy de preview**, e elas se acumulam até
bater o limite do plano.

Três saídas, da mais conservadora à mais definitiva:

1. **Limpar as branches antigas** (mantém o isolamento dos previews)
   [console.neon.tech](https://console.neon.tech) → seu projeto → **Branches** →
   apague as de preview (nomes tipo `preview/…` ou `vercel-…`). **Nunca apague a
   `main`/`production`** — é o banco de verdade. Depois: Vercel → Deployments →
   **⋯ → Redeploy**.
2. **Desligar a branch por preview** (resolve a recorrência)
   Vercel → **Settings → Integrations → Neon** (ou Storage → o banco → Settings)
   → desligue a criação de branch para previews. A partir daí os previews usam o
   banco de produção — teste no preview passa a mexer em dados reais.
3. **Publicar direto em produção**
   Merge na `main`: a deploy de produção usa a branch principal do banco e não
   cria branch nova, então não esbarra nesse limite.

Depois que a deploy passar, o schema novo é criado sozinho no primeiro acesso ao
painel (`lib/db.ts`) — não existe SQL para rodar à mão.

## Variáveis de ambiente (lembrete)
As env vars ficam salvas em **Settings → Environment Variables** de cada projeto
e **não se perdem** em redeploy. Ao mudar uma, faça uma **deploy nova** para ela
entrar.

Integração com o roteador central de webhooks:
- **Roteador (`webhook-router`):** `REGISTER_TOKEN`
- **Cada install (`many`):**
  - `WEBHOOK_ROUTER_URL` = URL do roteador (ex.: `https://webhookrouter-e1ght.vercel.app`)
  - `WEBHOOK_ROUTER_TOKEN` = o mesmo valor do `REGISTER_TOKEN`

Sem essas variáveis, o auto-cadastro de rotas fica desligado (no-op) — o app
continua funcionando normalmente, só não registra as contas no roteador.

Para contas que já estavam conectadas antes de ligar o roteador: entre no
`/setup` de cada install e clique **"reassinar webhooks"** uma vez.
