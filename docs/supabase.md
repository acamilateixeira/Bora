# Supabase no Bora

Use um projeto de desenvolvimento separado para testar a instalação, os três perfis e as alterações no banco.

## Banco de desenvolvimento

1. Crie um projeto no Supabase com o provedor de autenticação por e-mail habilitado.
2. No SQL Editor desse projeto, execute [`supabase_schema.sql`](../supabase_schema.sql). O script cria tabelas, funções, políticas de acesso e views da operação. Use-o para a instalação inicial.
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

## Notificações e presença

A tela de notificações lê a tabela `notifications`. [`supabase_push.sql`](../supabase_push.sql) inclui os gatilhos que registram notificações e chamam a Edge Function `notify` via `pg_net`. O arquivo também inclui ajustes históricos de políticas e relatórios.

O push remoto depende de uma build de desenvolvimento em dispositivo físico, de um projeto Expo associado à build e da configuração do serviço de push. As Edge Functions atuais esperam os segredos de servidor `SB_URL` e `SB_SERVICE_ROLE_KEY`. [Configuração de push no Expo](https://docs.expo.dev/push-notifications/push-notifications-setup/)

Antes de ativar push, revise a autorização de `notify`. A função atual aceita o destinatário no corpo da requisição e usa a chave de serviço para buscar os tokens. Restrinja a chamada ao backend antes de publicar a função. O SQL contém marcadores para a URL do ambiente e para a credencial da chamada.

O app já calcula a disponibilidade com base na última atualização do status ou da localização. A função `expire-driver-status` também foi incluída no código, mas depende da RPC `expire_stale_driver_status`, cuja definição precisa ser fornecida antes de agendá-la.

## Diagnóstico rápido

| Sintoma | Conferir |
| --- | --- |
| O app falha ao inicializar o cliente | URL e chave no `.env`. Reinicie o Expo após alterar o arquivo. |
| Login funciona, mas não aparece um modo | Perfil, organização ativa e vínculo aprovado. |
| Status aparece só após recarregar | Tabela na publicação Realtime e políticas de leitura para aquele perfil. |
| Localização indisponível | Permissão de localização do dispositivo e coordenadas no simulador. |
