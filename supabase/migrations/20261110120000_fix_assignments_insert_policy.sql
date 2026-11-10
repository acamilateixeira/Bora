-- Corrige a política de criação de atribuições (assignments_insert).
--
-- Problemas reproduzidos em tests/sql/10_database.sql antes desta migração:
--
-- 1. Precedência de operadores. A política era `staff OR motorista AND regras...`.
--    Como AND vem antes de OR, as regras comuns (corrida sem atribuição, motorista
--    diferente do passageiro, bloqueios) só valiam para o motorista. O despacho
--    conseguia colocar um segundo motorista na mesma corrida, um motorista
--    bloqueado ou o próprio passageiro como motorista.
-- 2. Corrida de outra organização. Nenhum dos caminhos conferia se a corrida
--    pertence à organização da atribuição. O despacho de um órgão conseguia
--    criar uma atribuição apontando para a corrida de outro órgão.
-- 3. Nome sombreado. Em `select 1 from assignments a where a.request_id = request_id`,
--    o `request_id` sem qualificação resolve para `a.request_id` (o escopo mais
--    próximo), e a condição vira "existe alguma atribuição visível". Resultado:
--    um motorista com qualquer corrida no histórico nunca mais conseguia aceitar
--    uma corrida pelo app.
--
-- A regra "uma atribuição ativa por corrida" sai da política e vira um índice
-- único parcial. Dentro da política a subconsulta passa pela RLS de quem insere
-- (o motorista só enxerga as próprias atribuições), então ela não impedia dois
-- motoristas de aceitarem a mesma corrida ao mesmo tempo. O índice impede,
-- inclusive sob concorrência.

do $$
begin
  if exists (
    select request_id
    from assignments
    where status in ('assigned', 'accepted', 'started')
    group by request_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'Há corridas com mais de uma atribuição ativa.',
      hint = 'Resolva os duplicados (marque os excedentes como rejected) antes de aplicar esta migração: '
          || 'select request_id from assignments where status in (''assigned'',''accepted'',''started'') '
          || 'group by request_id having count(*) > 1;';
  end if;
end $$;

create unique index if not exists assignments_one_active_per_request
  on assignments (request_id)
  where status in ('assigned', 'accepted', 'started');

drop policy if exists assignments_insert on assignments;

create policy assignments_insert on assignments
for insert with check (
  -- O motorista precisa servir à organização da atribuição.
  is_driver_in_org(assignments.driver_id, assignments.org_id)
  -- Quem cria: o despacho do órgão, ou o próprio motorista aceitando.
  and (
    has_role(assignments.org_id, 'admin')
    or has_role(assignments.org_id, 'dispatcher')
    or assignments.driver_id = auth.uid()
  )
  -- A corrida é da mesma organização, está disponível para atribuição
  -- e não foi pedida pelo próprio motorista.
  and exists (
    select 1
    from requests r
    where r.id = assignments.request_id
      and r.org_id = assignments.org_id
      and r.status in ('open', 'approved')
      and r.requester_id <> assignments.driver_id
      and not is_blocked(r.org_id, r.requester_id, assignments.driver_id)
  )
);
