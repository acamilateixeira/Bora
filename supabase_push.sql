-- Enable pg_net for HTTP calls
create extension if not exists pg_net;

-- Replace with your project URL and anon key
-- Example URL: https://<project-ref>.supabase.co
-- Example anon key: ey...

create or replace function notify_user(p_user_id uuid, p_org_id uuid, p_title text, p_body text, p_data jsonb)
returns void language plpgsql as $$
declare
  url text := 'https://<project-ref>.supabase.co/functions/v1/notify';
  anon_key text := 'REPLACE_WITH_ANON_KEY';
begin
  insert into notifications (user_id, org_id, title, body, data)
  values (p_user_id, p_org_id, p_title, p_body, p_data);

  perform net.http_post(
    url,
    json_build_object(
      'user_id', p_user_id,
      'title', p_title,
      'body', p_body,
      'data', coalesce(p_data, '{}'::jsonb)
    )::jsonb,
    json_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', anon_key)
    )::jsonb
  );
end;
$$;

create or replace function notify_assignment()
returns trigger language plpgsql as $$
declare
  req_id uuid;
begin
  -- notify driver
  perform notify_user(
    new.driver_id,
    new.org_id,
    'Nova corrida atribuida',
    'Voce recebeu uma nova corrida',
    json_build_object('request_id', new.request_id)::jsonb
  );

  -- notify requester
  select r.requester_id into req_id from requests r where r.id = new.request_id;
  if req_id is not null then
    perform notify_user(
      req_id,
      new.org_id,
      'Solicitacao atribuida',
      'Um motorista foi atribuido',
      json_build_object('request_id', new.request_id)::jsonb
    );
  end if;

  return new;
end;
$$;

create or replace function notify_request_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    perform notify_user(
      new.requester_id,
      new.org_id,
      'Status atualizado',
      concat('Status da solicitacao: ', new.status),
      json_build_object('request_id', new.id, 'status', new.status)::jsonb
    );
  end if;
  return new;
end;
$$;

create or replace function notify_new_request()
returns trigger language plpgsql as $$
declare
  rec record;
begin
  -- notify all dispatchers/admins in the org
  for rec in
    select user_id from user_org_membership
    where org_id = new.org_id
      and role in ('admin','dispatcher')
      and active = true
      and status = 'approved'
      and user_id <> new.requester_id
  loop
    perform notify_user(
      rec.user_id,
      new.org_id,
      'Nova solicitacao',
      'Existe uma nova solicitacao aguardando aprovacao',
      json_build_object('request_id', new.id)::jsonb
    );
  end loop;
  return new;
end;
$$;

-- Triggers (recreate)
drop trigger if exists trg_notify_assignment on assignments;
drop trigger if exists trg_notify_request_status on requests;
drop trigger if exists trg_notify_new_request on requests;

create trigger trg_notify_assignment
after insert on assignments
for each row execute function notify_assignment();

create trigger trg_notify_request_status
after update of status on requests
for each row execute function notify_request_status();

create trigger trg_notify_new_request
after insert on requests
for each row execute function notify_new_request();

-- Driver status history and reporting
create table if not exists driver_status_history (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  status driver_status_enum not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  source text not null default 'app'
);

create index if not exists idx_driver_status_history_driver_org_started
  on driver_status_history(driver_id, org_id, started_at desc);

create index if not exists idx_driver_status_history_open
  on driver_status_history(driver_id, org_id)
  where ended_at is null;

create or replace function set_driver_status(
  p_driver_id uuid,
  p_org_ids uuid[],
  p_status driver_status_enum,
  p_source text default 'app'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_current driver_status_enum;
  v_now timestamptz := now();
  v_has_open boolean;
begin
  if auth.uid() is distinct from p_driver_id then
    raise exception 'unauthorized driver status change';
  end if;

  if p_org_ids is null or array_length(p_org_ids, 1) is null then
    raise exception 'org list is required';
  end if;

  foreach v_org in array p_org_ids loop
    if not is_driver_in_org(p_driver_id, v_org) then
      raise exception 'driver % is not approved in org %', p_driver_id, v_org;
    end if;

    select ds.status
      into v_current
      from driver_status ds
     where ds.driver_id = p_driver_id
       and ds.org_id = v_org;

    if v_current is null then
      insert into driver_status (driver_id, org_id, status, updated_at)
      values (p_driver_id, v_org, p_status, v_now)
      on conflict (driver_id, org_id)
      do update set status = excluded.status, updated_at = excluded.updated_at;

      insert into driver_status_history (driver_id, org_id, status, started_at, source)
      values (p_driver_id, v_org, p_status, v_now, coalesce(p_source, 'app'));

    elsif v_current = p_status then
      update driver_status
         set updated_at = v_now
       where driver_id = p_driver_id
         and org_id = v_org;

      select exists (
        select 1
          from driver_status_history h
         where h.driver_id = p_driver_id
           and h.org_id = v_org
           and h.ended_at is null
      ) into v_has_open;

      if not v_has_open then
        insert into driver_status_history (driver_id, org_id, status, started_at, source)
        values (p_driver_id, v_org, p_status, v_now, coalesce(p_source, 'app'));
      end if;

    else
      update driver_status_history
         set ended_at = v_now
       where driver_id = p_driver_id
         and org_id = v_org
         and ended_at is null;

      update driver_status
         set status = p_status,
             updated_at = v_now
       where driver_id = p_driver_id
         and org_id = v_org;

      insert into driver_status_history (driver_id, org_id, status, started_at, source)
      values (p_driver_id, v_org, p_status, v_now, coalesce(p_source, 'app'));
    end if;
  end loop;
end;
$$;

create or replace view driver_status_daily_report as
select
  org_id,
  driver_id,
  date_trunc('day', started_at)::date as report_day,
  status,
  round(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) / 60.0)::int as minutes
from driver_status_history
group by org_id, driver_id, date_trunc('day', started_at)::date, status;

create or replace view driver_dispatcher_productivity_today as
with base as (
  select
    org_id,
    driver_id,
    sum(case when status = 'online' then minutes else 0 end) as min_online,
    sum(case when status = 'busy' then minutes else 0 end) as min_busy,
    sum(case when status = 'offline' then minutes else 0 end) as min_offline
  from driver_status_daily_report
  where report_day = current_date
  group by org_id, driver_id
)
select
  b.org_id,
  b.driver_id,
  u.name as driver_name,
  b.min_online,
  b.min_busy,
  greatest(b.min_online - b.min_busy, 0) as min_idle,
  case
    when b.min_online > 0 then round((b.min_busy::numeric / b.min_online) * 100, 1)
    else 0
  end as occupancy_rate_pct
from base b
left join users u on u.id = b.driver_id;



-- Hotfix: allow profile change audit inserts from authenticated updates
grant select, insert on driver_profile_changes to authenticated;

-- Hotfix: ensure all tracked fields fire audit trigger
drop trigger if exists trg_driver_profile_changes on users;
create trigger trg_driver_profile_changes
after update of name, phone, cpf, vehicle_plate, vehicle_model, vehicle_color on users
for each row execute function log_driver_profile_changes();

-- Hotfix: allow staff to edit user/driver profiles in their org
drop policy if exists users_update_staff on users;
create policy users_update_staff on users
for update using (
  exists (
    select 1
    from user_org_membership target
    join user_org_membership me
      on me.org_id = target.org_id
    where target.user_id = users.id
      and target.status = 'approved'
      and target.active = true
      and me.user_id = auth.uid()
      and me.status = 'approved'
      and me.active = true
      and me.role in ('admin', 'dispatcher')
  )
  or exists (
    select 1
    from driver_org_membership target
    join user_org_membership me
      on me.org_id = target.org_id
    where target.driver_id = users.id
      and target.status = 'approved'
      and target.active = true
      and me.user_id = auth.uid()
      and me.status = 'approved'
      and me.active = true
      and me.role in ('admin', 'dispatcher')
  )
)
with check (
  exists (
    select 1
    from user_org_membership target
    join user_org_membership me
      on me.org_id = target.org_id
    where target.user_id = users.id
      and target.status = 'approved'
      and target.active = true
      and me.user_id = auth.uid()
      and me.status = 'approved'
      and me.active = true
      and me.role in ('admin', 'dispatcher')
  )
  or exists (
    select 1
    from driver_org_membership target
    join user_org_membership me
      on me.org_id = target.org_id
    where target.driver_id = users.id
      and target.status = 'approved'
      and target.active = true
      and me.user_id = auth.uid()
      and me.status = 'approved'
      and me.active = true
      and me.role in ('admin', 'dispatcher')
  )
);
