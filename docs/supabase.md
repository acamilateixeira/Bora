# Supabase no Bora

Use um projeto de desenvolvimento separado para testar a instalação, os três perfis e as alterações no banco.

## Banco de desenvolvimento

1. Crie um projeto no Supabase com o provedor de autenticação por e-mail habilitado.
2. No SQL Editor desse projeto, execute [`supabase_schema.sql`](../supabase_schema.sql). O script cria tabelas, funções, políticas de acesso e views da operação. Use-o para a instalação inicial. Em seguida, execute [`supabase_push.sql`](../supabase_push.sql) e os arquivos de [`supabase/migrations/`](../supabase/migrations) em ordem (veja [Migrações](#migrações)).
3. Em **Authentication → Users**, crie e confirme as quatro contas da tabela abaixo. Defina senhas locais de teste.
4. No SQL Editor, execute [`supabase_seed.sql`](../supabase_seed.sql). Ele usa os IDs das contas de Auth para criar perfis e vínculos aprovados, além de uma corrida de exemplo.
5. Copie a URL e a chave **publishable** ou **anon** do painel **Connect** para o `.env` do app.

| E-mail de teste | Perfil |
| --- | --- |
| `rider@bora.local` | Passageiro |
| `driver@bora.local` | Motorista |
| `dispatcher@bora.local` | Despacho |
| `admin@bora.local` | Administração |

O seed vincula essas contas à organização **Secretaria de Educacao**. Use os logins do seed para testar o fluxo sem precisar gerar convites primeiro. Para testar cadastro e aprovação, gere um convite no app e abra o fluxo de cadastro com uma conta nova.

**Reset de desenvolvimento.** [`supabase_bootstrap.sql`](../supabase_bootstrap.sql) executa `DROP SCHEMA public CASCADE` e recria o schema. Use-o apenas em um banco descartável. Em um banco com dados, faça alterações pontuais por migração.

## Realtime

Adicione estas tabelas à publicação `supabase_realtime` no painel do banco. Elas correspondem às assinaturas das telas.

| Tela | Tabelas |
| --- | --- |
| Passageiro | `requests` |
| Motorista | `assignments`, `driver_status`, `driver_user_links`, `driver_profile_changes` |
| Despacho | `requests`, `assignments`, `driver_status`, `driver_location`, `user_org_membership`, `driver_org_membership`, `blocks`, `invites` |
| Notificações | `notifications` |

O Realtime respeita as políticas de acesso por linha. Se um perfil recebe uma atualização e outro não, verifique a publicação, o vínculo aprovado e a organização selecionada. [Postgres Changes no Supabase](https://supabase.com/docs/guides/realtime/postgres-changes)

## Migrações

Mudanças em um banco que já tem dados entram como arquivos em [`supabase/migrations/`](../supabase/migrations), aplicados em ordem depois de `supabase_schema.sql` e `supabase_push.sql`. Com a CLI do Supabase, `supabase db push` aplica os que faltam.

| Migração | O que faz |
| --- | --- |
| `20261105120000_secure_notify.sql` | O banco chama a função `notify` com um segredo do Vault, e não mais com a chave anon. Os gatilhos de push passam a rodar como `security definer` e o app não consegue chamar `notify_user` direto. |
| `20261105120100_expire_stale_driver_status.sql` | Cria `expire_stale_driver_status`, que marca como offline o motorista sem sinal há mais de 5 minutos e registra o período no histórico. Só a chave de serviço executa. |

## Notificações

A tela de notificações lê a tabela `notifications`. [`supabase_push.sql`](../supabase_push.sql) cria os gatilhos que registram notificações e chamam a Edge Function `notify` via `pg_net`. Ele também inclui ajustes históricos de políticas e relatórios.

Para ligar o push em um ambiente:

```sql
-- No SQL Editor, uma vez por ambiente:
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify', 'bora_notify_url');
select vault.create_secret('<valor aleatório longo>', 'bora_notify_secret');
```

```bash
supabase secrets set SB_URL=https://<project-ref>.supabase.co SB_SERVICE_ROLE_KEY=<chave de serviço> NOTIFY_SECRET=<o mesmo valor>
supabase functions deploy notify --no-verify-jwt
```

A função só aceita chamadas com o cabeçalho `x-bora-notify-secret`. Como a chave anon vai dentro do app, ela não serve para autorizar o envio. Sem os segredos no Vault, as notificações continuam aparecendo no app, só sem push. Tokens que o Expo marca como `DeviceNotRegistered` são removidos de `device_tokens`.

O push remoto depende de uma build de desenvolvimento em dispositivo físico, de um projeto Expo associado à build e da configuração do serviço de push. [Configuração de push no Expo](https://docs.expo.dev/push-notifications/push-notifications-setup/)

## Presença do motorista

O app calcula a disponibilidade com base na última atualização do status ou da localização (`PRESENCE_STALE_MS`, 5 minutos). Para o banco registrar a mesma coisa, agende a expiração com o `pg_cron`:

```sql
select cron.schedule('bora-expire-driver-status', '* * * * *', $$select expire_stale_driver_status()$$);
```

Ou agende a Edge Function `expire-driver-status`, que chama a mesma função com a chave de serviço. A view `driver_presence` ainda usa um limite de 2 horas para os relatórios.

## Testes

| Comando | O que roda |
| --- | --- |
| `npm test` | Testes unitários com `node:test` (presença, formatação, endereço e a lógica da função `notify`). Não precisa de `npm ci`. |
| `npm run typecheck` | TypeScript do app. |
| `DATABASE_URL=… npm run test:db` | Aplica schema, push e migrações em um Postgres 16 comum, com stubs de `auth`, Vault e `pg_net`, e testa RLS entre organizações, `set_driver_status`, a expiração e o push. |

O CI roda os três em cada PR, mais `deno check` nas Edge Functions.

## Diagnóstico rápido

| Sintoma | Conferir |
| --- | --- |
| O app falha ao inicializar o cliente | URL e chave no `.env`. Reinicie o Expo após alterar o arquivo. |
| Login funciona, mas não aparece um modo | Perfil, organização ativa e vínculo aprovado. |
| Status aparece só após recarregar | Tabela na publicação Realtime e políticas de leitura para aquele perfil. |
| Localização indisponível | Permissão de localização do dispositivo e coordenadas no simulador. |
