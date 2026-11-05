-- Expira a disponibilidade de motoristas que pararam de enviar sinal.
-- Chamada pela Edge Function `expire-driver-status` (chave de serviço) ou
-- direto pelo pg_cron:
--   select cron.schedule('bora-expire-driver-status', '* * * * *',
--                        $$select expire_stale_driver_status()$$);
--
-- O padrão de 5 minutos é o mesmo de PRESENCE_STALE_MS em
-- src/lib/driverPresence.ts: o banco passa a registrar o que o app já mostra.

create or replace function expire_stale_driver_status(
  p_stale_after interval default interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  with stale as (
    select ds.driver_id, ds.org_id
      from driver_status ds
      left join driver_location dl
        on dl.driver_id = ds.driver_id and dl.org_id = ds.org_id
     where ds.status <> 'offline'
       and greatest(ds.updated_at, dl.updated_at) < v_now - p_stale_after
       for update of ds skip locked
  ),
  closed as (
    update driver_status_history h
       set ended_at = v_now
      from stale s
     where h.driver_id = s.driver_id
       and h.org_id = s.org_id
       and h.ended_at is null
  ),
  opened as (
    insert into driver_status_history (driver_id, org_id, status, started_at, source)
    select s.driver_id, s.org_id, 'offline', v_now, 'expire'
      from stale s
  )
  update driver_status ds
     set status = 'offline',
         updated_at = v_now
    from stale s
   where ds.driver_id = s.driver_id
     and ds.org_id = s.org_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Ninguém do app deve derrubar a disponibilidade de outros motoristas.
revoke execute on function expire_stale_driver_status(interval) from public, anon, authenticated;
grant execute on function expire_stale_driver_status(interval) to service_role;
