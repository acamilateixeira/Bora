-- Testes do banco: isolamento entre organizações (RLS), regras das funções
-- security definer e as migrações de push e presença.
-- Cada bloco falha com raise exception; o psql roda com ON_ERROR_STOP.

\set ON_ERROR_STOP 1

-- Contas e dados do seed oficial.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@bora.local'),
  ('a0000000-0000-0000-0000-000000000002', 'dispatcher@bora.local'),
  ('a0000000-0000-0000-0000-000000000003', 'driver@bora.local'),
  ('a0000000-0000-0000-0000-000000000004', 'rider@bora.local'),
  ('b0000000-0000-0000-0000-000000000004', 'rider@outra.local');

\ir ../../supabase_seed.sql

-- Uma corrida em outra organização, de outro passageiro.
insert into users (id, name, phone) values ('b0000000-0000-0000-0000-000000000004', 'Passageiro Saude', '31999990009');
insert into user_org_membership (user_id, org_id, role, status)
values ('b0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'rider', 'approved');
insert into requests (org_id, requester_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng)
values ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000004', 'open', -19.9, -43.9, -19.8, -43.8);

\echo 'RLS: passageiro só vê corridas da própria organização'
begin;
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000004';
do $$
begin
  if exists (select 1 from requests where org_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'vazamento: passageiro da Educacao viu corrida da Saude';
  end if;
  if not exists (select 1 from requests where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') then
    raise exception 'passageiro deveria ver a própria corrida';
  end if;
end $$;
rollback;

\echo 'RLS: passageiro não cria corrida em organização da qual não participa'
begin;
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000004';
do $$
begin
  begin
    insert into requests (org_id, requester_id, pickup_lat, pickup_lng, drop_lat, drop_lng)
    values ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000004', 0, 0, 0, 0);
    raise exception 'insert deveria ter sido bloqueado pela RLS';
  exception when insufficient_privilege then
    null; -- esperado
  end;
end $$;
rollback;

\echo 'set_driver_status: ninguém altera a disponibilidade de outro motorista'
begin;
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000002';
do $$
begin
  begin
    perform set_driver_status('a0000000-0000-0000-0000-000000000003',
                              array['11111111-1111-1111-1111-111111111111']::uuid[], 'offline');
    raise exception 'despacho conseguiu mudar o status do motorista';
  exception when raise_exception then
    if sqlerrm not like 'unauthorized%' then raise; end if;
  end;
end $$;
rollback;

\echo 'set_driver_status: troca de status fecha o histórico anterior'
begin;
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000003';
select set_driver_status('a0000000-0000-0000-0000-000000000003',
                         array['11111111-1111-1111-1111-111111111111']::uuid[], 'busy');
select set_driver_status('a0000000-0000-0000-0000-000000000003',
                         array['11111111-1111-1111-1111-111111111111']::uuid[], 'online');
reset role;
do $$
declare v_open int;
begin
  select count(*) into v_open from driver_status_history
   where driver_id = 'a0000000-0000-0000-0000-000000000003' and ended_at is null;
  if v_open <> 1 then
    raise exception 'esperava 1 período aberto no histórico, encontrei %', v_open;
  end if;
end $$;
rollback;

\echo 'expire_stale_driver_status: só expira quem passou do limite'
begin;
insert into users (id, name, phone) values ('b0000000-0000-0000-0000-000000000004', 'x', '31999990009')
  on conflict do nothing;
update driver_status set status = 'online', updated_at = now() - interval '10 minutes'
 where driver_id = 'a0000000-0000-0000-0000-000000000003';
insert into driver_status_history (driver_id, org_id, status, started_at)
values ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'online', now() - interval '10 minutes');
do $$
declare v_count int; v_status driver_status_enum; v_source text;
begin
  if expire_stale_driver_status(interval '15 minutes') <> 0 then
    raise exception 'não deveria expirar dentro do limite';
  end if;
  v_count := expire_stale_driver_status();
  if v_count <> 1 then raise exception 'esperava 1 motorista expirado, veio %', v_count; end if;
  select status into v_status from driver_status where driver_id = 'a0000000-0000-0000-0000-000000000003';
  if v_status <> 'offline' then raise exception 'status deveria ser offline, é %', v_status; end if;
  select source into v_source from driver_status_history
   where driver_id = 'a0000000-0000-0000-0000-000000000003' and ended_at is null;
  if v_source is distinct from 'expire' then raise exception 'histórico aberto deveria vir de expire'; end if;
  if expire_stale_driver_status() <> 0 then raise exception 'segunda execução deveria ser idempotente'; end if;
end $$;
rollback;

\echo 'expire_stale_driver_status: app não pode chamar'
begin;
set local role authenticated;
do $$
begin
  begin
    perform expire_stale_driver_status();
    raise exception 'usuário do app conseguiu executar a expiração';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'notify_user: sem Vault configurado, grava só no histórico'
begin;
truncate net.calls;
select notify_user('a0000000-0000-0000-0000-000000000003', null, 't', 'b', '{}');
do $$
begin
  if (select count(*) from net.calls) <> 0 then raise exception 'não deveria chamar HTTP sem segredo'; end if;
  if not exists (select 1 from notifications where user_id = 'a0000000-0000-0000-0000-000000000003' and title = 't') then
    raise exception 'notificação deveria ficar no histórico';
  end if;
end $$;
rollback;

\echo 'notify_user: gatilho de atribuição chama a função com o segredo, não com a chave anon'
begin;
truncate net.calls;
insert into vault.decrypted_secrets values
  ('bora_notify_url', 'https://example.supabase.co/functions/v1/notify'),
  ('bora_notify_secret', 's3cr3t');
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000002';
update requests set status = 'approved' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
reset role;
do $$
declare v_headers jsonb;
begin
  select headers into v_headers from net.calls order by id limit 1;
  if v_headers is null then raise exception 'gatilho não chamou a Edge Function'; end if;
  if v_headers->>'x-bora-notify-secret' <> 's3cr3t' then raise exception 'cabeçalho do segredo ausente'; end if;
  if v_headers ? 'Authorization' then raise exception 'não deveria mandar a chave anon'; end if;
end $$;
rollback;

\echo 'notify_user: usuário do app não chama direto'
begin;
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000004';
do $$
begin
  begin
    perform notify_user('a0000000-0000-0000-0000-000000000003', null, 'spam', 'spam', '{}');
    raise exception 'usuário do app conseguiu disparar notificação';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- Atribuições (migração 20261110120000). Cenário: a corrida do seed já foi
-- concluída e há uma corrida nova e aberta na Educação.
\echo 'assignments: despacho não aponta atribuição para corrida de outro órgão'
begin;
set local test.uid = 'a0000000-0000-0000-0000-000000000002';
create temp table saude_request on commit drop as
  select id from requests where org_id = '22222222-2222-2222-2222-222222222222' limit 1;
grant select on saude_request to authenticated;
set local role authenticated;
do $$
begin
  begin
    insert into assignments (org_id, request_id, driver_id)
    select '11111111-1111-1111-1111-111111111111', id, 'a0000000-0000-0000-0000-000000000003' from saude_request;
    raise exception 'vazamento: despacho da Educação atribuiu corrida da Saúde';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

\echo 'assignments: despacho não coloca segundo motorista nem o passageiro na corrida'
begin;
set local test.uid = 'a0000000-0000-0000-0000-000000000002';
-- admin e passageiro também viram motoristas da Educação para o teste
insert into driver_org_membership (driver_id, org_id, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'approved'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'approved');
set local role authenticated;
do $$
begin
  begin
    insert into assignments (org_id, request_id, driver_id)
    values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a0000000-0000-0000-0000-000000000001');
    raise exception 'corrida ficou com dois motoristas ativos';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    insert into assignments (org_id, request_id, driver_id)
    values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a0000000-0000-0000-0000-000000000004');
    raise exception 'passageiro virou motorista da própria corrida';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;
rollback;

\echo 'assignments: motorista com histórico aceita corrida nova'
begin;
set local test.uid = 'a0000000-0000-0000-0000-000000000002';
update assignments set status = 'finished' where request_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
update requests set status = 'done' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
insert into requests (id, org_id, requester_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111',
        'a0000000-0000-0000-0000-000000000004', 'open', 0, 0, 0, 0);
set local role authenticated;
set local test.uid = 'a0000000-0000-0000-0000-000000000003';
insert into assignments (org_id, request_id, driver_id, status)
values ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'a0000000-0000-0000-0000-000000000003', 'accepted');
rollback;

\echo 'assignments: só uma atribuição ativa por corrida, mesmo sem a RLS'
begin;
-- Sem RLS (superusuário), simulando dois aceites que passaram na política ao
-- mesmo tempo: o índice único é a última barreira.
insert into driver_org_membership (driver_id, org_id, status)
values ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'approved');
do $$
begin
  begin
    insert into assignments (org_id, request_id, driver_id, status)
    values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            'a0000000-0000-0000-0000-000000000001', 'accepted');
    raise exception 'índice deveria impedir a segunda atribuição ativa';
  exception when unique_violation then null;
  end;
  -- Depois de recusada, a corrida pode ser atribuída a outro motorista.
  update assignments set status = 'rejected' where request_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  insert into assignments (org_id, request_id, driver_id, status)
  values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          'a0000000-0000-0000-0000-000000000001', 'accepted');
end $$;
rollback;

\echo 'OK: todos os testes do banco passaram'
