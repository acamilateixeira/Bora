# Guia para agentes de IA neste repositório

Bora: app mobile (React Native 0.81 + Expo SDK 54 + TypeScript) com backend no Supabase.
O app fala direto com o Supabase usando a chave pública, então **toda regra de acesso fica no banco**.

## Comandos

- `npm start` — Expo
- `npm test` — testes unitários (`node:test`, sem dependências)
- `npm run typecheck` — TypeScript do app
- `DATABASE_URL=postgres://… npm run test:db` — schema + migrações + testes em um banco Postgres 16 vazio e descartável

## Estrutura

- `src/screens/` — uma tela por perfil (passageiro, despacho, motorista) e autenticação.
- `src/services/`, `src/lib/` — acesso ao Supabase, presença e notificações.
- `supabase_schema.sql` — instalação inicial. Mudanças depois disso vão em `supabase/migrations/`.
- `supabase/functions/` — Edge Functions (Deno). A lógica fica em `handler.ts`, sem imports, para ser testada no Node.
- `tests/sql/00_supabase_stubs.sql` — o mínimo do Supabase (`auth.uid()`, Vault, `pg_net`) para rodar o schema fora dele.

## Regras

1. Tabela nova tem RLS e política por organização; adicione um teste em `tests/sql/10_database.sql`.
2. Função `security definer` confere `auth.uid()` e fixa `search_path`.
3. Nunca use a chave de serviço no app. Variáveis `EXPO_PUBLIC_*` entram no bundle.
4. Tabela que o app assina no Realtime precisa estar na publicação (atualize `docs/supabase.md`).
5. Textos do app em português; README em PT e EN.
