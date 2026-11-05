## O que muda
<!-- Descreva a mudança em 2 ou 3 frases. -->

## Por quê
<!-- Problema ou decisão de produto que motivou. -->

## Como testar
<!-- Perfil (passageiro, despacho ou motorista) e passos no app, ou o teste que cobre. -->

## Checklist
- [ ] `npm test`, `npm run typecheck` e `npm run test:db` passam
- [ ] Tabela nova tem RLS e política por organização
- [ ] Função `security definer` confere `auth.uid()` e tem `search_path` fixo
- [ ] Mudança no banco entrou como migração em `supabase/migrations/`
- [ ] Tabela nova assinada pelo app foi adicionada à publicação do Realtime (docs/supabase.md)
