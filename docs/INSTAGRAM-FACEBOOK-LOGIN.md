# Instagram API com Facebook Login

## Diagnóstico

O erro `Invalid platform app` acontece antes do retorno ao aplicativo. O código anterior iniciava autorização em instagram.com, usando credenciais e escopos do Instagram Login. As capturas do painel Meta mostram um app configurado para Instagram API com Facebook Login. Publicar esse app não torna suas credenciais compatíveis com o outro fluxo. A senha do painel em `/entrar` é uma autenticação independente.

Agora `/api/oauth/login` inicia o fluxo de código no Facebook. O callback troca o código no servidor, estende o token de usuário, verifica permissões, percorre as Páginas autorizadas e identifica `instagram_business_account`. Cada conta profissional vinculada recebe seu próprio token de Página, identificado pelo ID do Instagram. A assinatura de webhook usa o ID da Página vinculada. As chamadas dessas contas usam `graph.facebook.com/v26.0`.

## Configuração do servidor e Meta

1. Configure `ADMIN_PASSWORD`, `DATABASE_URL`, `APP_URL` com a origem HTTPS pública e `CREDENTIALS_ENCRYPTION_KEY` com 64 caracteres hexadecimais. Gere a chave com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Guarde uma cópia segura: trocar ou perder a chave impede ler credenciais já cifradas.
2. Em `/setup`, informe o ID e segredo do **app principal Meta**, encontrados em Configurações do app → Básico. Alternativamente configure `META_APP_ID` e `META_APP_SECRET` no servidor; essas variáveis têm precedência. O segredo salvo não é devolvido no formulário.
3. No caso de uso Instagram, mantenha **API com login do Facebook**. O Instagram deve ser profissional, vinculado a uma Página acessível ao usuário que autoriza. Confira as tarefas e permissões do usuário nessa Página.
4. Nas configurações do Login do Facebook para Empresas, habilite o fluxo OAuth web e cadastre exatamente `https://SEU-DOMINIO/api/oauth/callback`. Configure os domínios, política de privacidade e exclusão de dados indicados pelo assistente.
5. Conceda `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement` e `pages_manage_metadata`. As três primeiras cobrem perfil/comentários/conversas; as demais permitem descobrir Páginas e assinar eventos. Não solicitar publicação de conteúdo é intencional: este fluxo não publica posts. Se usar `FACEBOOK_LOGIN_CONFIG_ID`, selecione uma configuração compatível com token de usuário e essas permissões.
6. Configure o webhook HTTPS `/api/webhook`, com o token de verificação mostrado no assistente. Assine `comments`, `messages` e `messaging_postbacks` no objeto Instagram. Conectar a conta também assina a Página vinculada. Confira a assinatura em `/setup`.
7. Para usuários externos, conclua App Review, Advanced Access das permissões necessárias e a verificação empresarial exigida pela Meta. Estar publicado não substitui essas aprovações. Teste primeiro com usuários/ativos autorizados para desenvolvimento.
8. Reconecte em `/setup`. Tokens e acesso aos dados podem expirar ou ser revogados. A validade efetiva é consultada na Meta; esse fluxo não utiliza a renovação do antigo Instagram Login. Reautorize quando necessário.

`QSTASH_TOKEN` permite acordar o processamento entre eventos; sem ele, eventos posteriores e o cron existente drenam trabalho pendente. `CRON_SECRET` protege os endpoints de cron. Nenhuma credencial real acompanha `.env.example`.

## Comportamento, segurança e recuperação

- OAuth exige a sessão administrativa. O state aleatório fica vinculado à sessão, expira em dez minutos e é consumido uma única vez. Código e tokens permanecem no servidor. Tokens e segredos são cifrados com AES-256-GCM; valores legados são migrados quando a chave estiver configurada.
- Webhooks validam HMAC-SHA256 sobre o corpo original. Eventos relevantes são persistidos antes do HTTP 200; falha de persistência retorna 503. IDs de eventos impedem reprocessamento duplicado. Contas desconhecidas não são encaminhadas para outra conta.
- A fila usa trava no PostgreSQL. Um registro separado reserva cada envio; uma resposta privada é reservada por conta/comentário. Sucesso já confirmado não é reenviado. Erros explicitamente transitórios da Graph admitem tentativas limitadas.
- Timeout ou perda de confirmação após envio deixam resultado **incerto**. O sistema evita repetir automaticamente, pois a Meta pode ter entregue a mensagem. Verifique os Eventos e a conversa antes de qualquer reenvio manual. Isso prioriza evitar duplicação; não há garantia de entrega exatamente uma vez entre dois sistemas.
- Para comentário em post/Reels: uma resposta privada por comentário, dentro de sete dias. O timestamp é verificado na Graph antes de enviar. Comentário não abre a janela de 24 horas; apenas a resposta recebida atualiza essa janela. Eventos antigos não a renovam para a hora do processamento.
- A primeira resposta privada usa texto: URLs são incorporadas e escolhas são apresentadas em texto/números, com continuação ao receber a resposta. Mensagens seguintes preservam os recursos existentes dentro da janela. Comentários de Live não são cobertos por essa automação.
- Contas antigas mantêm seu adaptador existente até reconectar; Messenger, fluxos, contatos e painel mantêm a arquitetura anterior. Segredos são removidos dos erros/eventos registrados.

## Arquivos alterados

OAuth: `app/api/oauth/{login,callback}/route.ts`, `lib/oauth.ts`, `lib/meta-config.ts`, `lib/fb.ts`.
Integração e tokens: `lib/ig-facebook.ts`, `lib/messaging.ts`, `lib/graph.ts`, `lib/secrets.ts`, `lib/db.ts`, `app/api/cron/daily/route.ts`.
Eventos/fila: `app/api/webhook/route.ts`, `lib/webhook-events.ts`, `lib/webhook-inbox.ts`, `lib/delivery.ts`, `lib/engine.ts`.
Assistente: `app/setup/{actions.ts,page.tsx}`. Validação: `tests/integration.test.cjs`, `package.json`, `package-lock.json`. Documentação: este arquivo, README e `.env.example`.

## Validação e pendências externas

Execute `npm ci`, `npm test`, `npx tsc --noEmit` e `npm run build`. Os testes usam PostgreSQL real em memória (PGlite), módulos da aplicação e respostas Meta simuladas; não enviam mensagens reais. Cobrem cifra, OAuth/sessão/state/expiração, ausência de permissões/Página/vínculo, paginação, endpoints, assinatura, palavra-chave e mídia, deduplicação, conta desconhecida, sete dias, janela fechada e falhas de confirmação.

O teste real depende de credenciais, aprovações e hospedagem HTTPS: conecte em `/setup`, selecione um Reels, crie a automação `QUERO`, comente com outra conta e confira uma única resposta privada. Repita a entrega do webhook e confira ausência de duplicatas; responda à mensagem para validar a continuação dentro de 24h. Revogue o acesso e confirme o diagnóstico de reconexão. Esses passos externos não foram executados localmente e os testes simulados não confirmam aprovação ou entrega pela Meta.

Resultado local: **9 testes passaram**, TypeScript sem erros, ESLint dos arquivos TypeScript alterados sem erros e build de produção concluído. A primeira tentativa de build falhou por acesso à fonte Sora no Google Fonts; a execução com acesso à rede passou. Também foi validado que uma resposta recebida abre a janela, enquanto duplicatas e eventos antigos não a renovam indevidamente.

## Referências oficiais consultadas

- [Instagram API com Facebook Login: início](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started/).
- [Private Replies: endpoint, permissões e janelas](https://developers.facebook.com/docs/instagram-platform/private-replies/).
- [Configuração dos webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).
- [Campos e permissões dos webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields).
- [Versões da Graph API](https://developers.facebook.com/docs/graph-api/changelog/): v26.0 consultada em outubro de 2026.
