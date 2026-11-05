-- Push seguro: o banco chama a Edge Function `notify` com um segredo guardado
-- no Supabase Vault, em vez da chave anon (que vai dentro do app e qualquer
-- pessoa consegue extrair).
--
-- Antes de aplicar, crie os dois segredos no Vault (uma vez por ambiente):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify', 'bora_notify_url');
--   select vault.create_secret('<valor aleatório longo>', 'bora_notify_secret');
-- E o mesmo valor do segredo na função:
--   supabase secrets set NOTIFY_SECRET=<valor aleatório longo>
--   supabase functions deploy notify --no-verify-jwt

create extension if not exists pg_net;

-- security definer: os gatilhos rodam com o usuário que alterou a linha,
-- que não pode ler o Vault nem inserir notificações para outra pessoa.
create or replace function notify_user(
  p_user_id uuid,
  p_org_id uuid,
  p_title text,
  p_body text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  insert into notifications (user_id, org_id, title, body, data)
  values (p_user_id, p_org_id, p_title, p_body, p_data);

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'bora_notify_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'bora_notify_secret';

  -- Sem configuração de push, a notificação fica só no histórico do app.
  if v_url is null or v_secret is null then
    raise notice 'notify_user: push não configurado; notificação gravada apenas no app';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', p_title,
      'body', p_body,
      'data', coalesce(p_data, '{}'::jsonb)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bora-notify-secret', v_secret
    )
  );
end;
$$;

-- Só os gatilhos devem chamar notify_user. Eles passam a rodar como dono da
-- função, então o revoke não afeta o fluxo normal do app.
alter function notify_assignment() security definer set search_path = public;
alter function notify_request_status() security definer set search_path = public;
alter function notify_new_request() security definer set search_path = public;
revoke execute on function notify_user(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
