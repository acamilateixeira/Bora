-- Recria, em um Postgres comum, o mínimo do Supabase de que o schema depende:
-- papéis da API, auth.uid(), auth.users, Vault e pg_net. Usado só nos testes.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- No Supabase, auth.uid() lê o JWT. Aqui lê a configuração da sessão,
-- então os testes "entram" como um usuário com: set local test.uid = '<uuid>'.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  name text primary key,
  decrypted_secret text not null
);

-- pg_net: registra as chamadas em vez de fazer HTTP.
create schema if not exists net;
create table if not exists net.calls (
  id bigserial primary key,
  url text,
  body jsonb,
  headers jsonb
);
create or replace function net.http_post(url text, body jsonb, headers jsonb)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net.calls (url, body, headers) values (url, body, headers) returning id into v_id;
  return v_id;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
