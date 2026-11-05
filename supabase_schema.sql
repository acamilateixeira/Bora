-- Supabase schema for Bora (multi-org, shared drivers, blocks, billing suspension)

-- Extensions
create extension if not exists pgcrypto;

-- Enums (safe create)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'role_type') then
    create type role_type as enum ('admin', 'dispatcher', 'driver', 'rider');
  end if;
  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type request_status as enum ('open', 'approved', 'assigned', 'in_progress', 'done', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'assignment_status') then
    create type assignment_status as enum ('assigned', 'accepted', 'rejected', 'started', 'finished');
  end if;
  if not exists (select 1 from pg_type where typname = 'org_status') then
    create type org_status as enum ('active', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'billing_status') then
    create type billing_status as enum ('ok', 'overdue');
  end if;
  if not exists (select 1 from pg_type where typname = 'block_actor') then
    create type block_actor as enum ('org', 'user', 'driver');
  end if;
  if not exists (select 1 from pg_type where typname = 'driver_status_enum') then
    create type driver_status_enum as enum ('offline', 'online', 'busy');
  end if;
  if not exists (select 1 from pg_type where typname = 'link_status') then
    create type link_status as enum ('pending', 'approved', 'rejected', 'blocked');
  end if;
  if not exists (select 1 from pg_type where typname = 'link_requested_by') then
    create type link_requested_by as enum ('user', 'driver');
  end if;
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type membership_status as enum ('pending', 'approved', 'rejected', 'blocked');
  end if;
  if not exists (select 1 from pg_type where typname = 'invite_status') then
    create type invite_status as enum ('active', 'used', 'expired', 'revoked');
  end if;
end
$$;

-- Orgs
create or replace function gen_public_code()
returns text
language sql
as $$
  select upper(substr(md5(gen_random_uuid()::text), 1, 8));
$$;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  public_code text not null default gen_public_code(),
  name text not null,
  status org_status not null default 'active',
  suspended_until timestamptz,
  billing_status billing_status not null default 'ok',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- User profiles (global)
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  public_code text not null default gen_public_code(),
  name text not null,
  phone text not null,
  cpf text,
  vehicle_plate text,
  vehicle_model text,
  vehicle_color text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table orgs add column if not exists public_code text;
alter table orgs alter column public_code set default gen_public_code();
update orgs set public_code = gen_public_code() where public_code is null;
create unique index if not exists orgs_public_code_unique on orgs(public_code);

alter table users add column if not exists public_code text;
alter table users alter column public_code set default gen_public_code();
update users set public_code = gen_public_code() where public_code is null;
create unique index if not exists users_public_code_unique on users(public_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_phone_e164'
  ) then
    alter table users
      add constraint users_phone_e164 check (phone ~ '^[0-9]{10,11}$');
  end if;
end $$;

-- User memberships per org (roles)
create table if not exists user_org_membership (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  role role_type not null,
  status membership_status not null default 'pending',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, org_id, role)
);

update user_org_membership set status = 'approved' where status is null;

-- Driver memberships (driver can serve multiple orgs)
create table if not exists driver_org_membership (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  status membership_status not null default 'pending',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (driver_id, org_id)
);

update driver_org_membership set status = 'approved' where status is null;

-- Invites (secure onboarding)
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  code text not null default gen_public_code(),
  org_id uuid not null references orgs(id) on delete cascade,
  role role_type not null,
  created_by uuid references users(id) on delete set null,
  status invite_status not null default 'active',
  auto_approve boolean not null default false,
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (code)
);

-- Requests
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  public_code text not null default gen_public_code(),
  org_id uuid not null references orgs(id) on delete cascade,
  requester_id uuid not null references users(id) on delete cascade,
  rider_name text,
  rider_pin text,
  pickup_note text,
  status request_status not null default 'open',
  pickup_label text,
  drop_label text,
  pickup_address jsonb,
  drop_address jsonb,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  drop_lat double precision not null,
  drop_lng double precision not null,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Requests code (public)
alter table requests add column if not exists public_code text;
alter table requests alter column public_code set default gen_public_code();
update requests set public_code = gen_public_code() where public_code is null;
create unique index if not exists requests_public_code_unique on requests(public_code);

-- Driver/User links (favorites/contact)
create table if not exists driver_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  status link_status not null default 'pending',
  requested_by link_requested_by not null,
  user_name text,
  user_phone text,
  driver_name text,
  driver_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, driver_id)
);

-- User favorites (user can favorite any driver in org)
create table if not exists user_favorite_drivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, driver_id)
);

-- Assignments
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  status assignment_status not null default 'assigned',
  created_at timestamptz not null default now(),
  unique (request_id, driver_id)
);

-- Org metrics (pre-aggregated for dashboards)
create or replace view org_metrics as
with req as (
  select id, org_id, status, created_at
  from requests
),
first_assign as (
  select request_id, min(created_at) as first_assigned_at
  from assignments
  group by request_id
),
agg as (
  select
    req.org_id,
    count(*) filter (where req.status = 'open') as open_count,
    count(*) filter (where req.status = 'assigned') as assigned_count,
    count(*) filter (where req.status = 'in_progress') as in_progress_count,
    count(*) filter (where req.status = 'done') as done_count,
    count(*) filter (where req.status = 'cancelled') as cancelled_count,
    count(*) as total_count,
    avg(extract(epoch from (now() - req.created_at)) / 60.0) filter (where req.status = 'open') as avg_open_wait_min,
    avg(extract(epoch from (first_assign.first_assigned_at - req.created_at)) / 60.0) filter (where first_assign.first_assigned_at is not null) as avg_assign_min
  from req
  left join first_assign on first_assign.request_id = req.id
  group by req.org_id
)
select
  org_id,
  open_count,
  assigned_count,
  in_progress_count,
  done_count,
  cancelled_count,
  total_count,
  coalesce(round(avg_open_wait_min), 0)::int as avg_open_wait_min,
  coalesce(round(avg_assign_min), 0)::int as avg_assign_min,
  case when total_count > 0 then round((cancelled_count::numeric / total_count) * 100, 0)::int else 0 end as cancel_rate
from agg;

-- Top drivers (finished assignments per org)
create or replace view org_top_drivers as
select
  org_id,
  driver_id,
  count(*) filter (where status = 'finished') as finished_count
from assignments
group by org_id, driver_id;

-- Driver location (realtime)
create table if not exists driver_location (
  driver_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  speed double precision,
  updated_at timestamptz not null default now(),
  primary key (driver_id, org_id)
);

-- Driver status per org
create table if not exists driver_status (
  driver_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  status driver_status_enum not null default 'offline',
  updated_at timestamptz not null default now(),
  primary key (driver_id, org_id)
);



-- Driver status history per org
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

-- Driver status transition with history (single source of truth)
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

-- Report: minutos por dia por status de motorista
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


-- Driver presence (effective online/offline per org)
create or replace view driver_presence as
select
  m.org_id,
  m.driver_id,
  coalesce(ds.status, 'offline')::driver_status_enum as status_raw,
  greatest(ds.updated_at, dl.updated_at) as last_seen_at,
  case
    when greatest(ds.updated_at, dl.updated_at) is null then 'offline'::driver_status_enum
    when greatest(ds.updated_at, dl.updated_at) < now() - interval '2 hours' then 'offline'::driver_status_enum
    else coalesce(ds.status, 'offline')::driver_status_enum
  end as effective_status
from driver_org_membership m
left join driver_status ds on ds.driver_id = m.driver_id and ds.org_id = m.org_id
left join driver_location dl on dl.driver_id = m.driver_id and dl.org_id = m.org_id
where m.active = true and m.status = 'approved';

-- Driver profile changes (audit)
create table if not exists driver_profile_changes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

-- Request events (audit)
create table if not exists request_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  actor_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  from_status request_status,
  to_status request_status,
  created_at timestamptz not null default now()
);

-- Blocks (bidirectional)
create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  blocked_by_type block_actor not null,
  blocked_by_id uuid not null,
  blocked_type block_actor not null,
  blocked_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);

-- Device tokens (push notifications)
create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references orgs(id) on delete cascade,
  expo_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now()
);

-- Notifications (in-app history)
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references orgs(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- API grants for Bora objects. Row-level access is controlled by the policies below.
grant select, insert, update, delete on
  orgs, users, user_org_membership, driver_org_membership, invites, requests,
  driver_user_links, user_favorite_drivers, assignments, driver_location,
  driver_status, driver_profile_changes, request_events,
  blocks, device_tokens, notifications
to authenticated, service_role;
grant select on org_metrics, org_top_drivers, driver_status_daily_report,
  driver_dispatcher_productivity_today, driver_presence
to authenticated, service_role;

-- Indexes
create index if not exists idx_requests_org on requests(org_id);
create index if not exists idx_assignments_org on assignments(org_id);
create index if not exists idx_driver_location_org on driver_location(org_id);
create index if not exists idx_driver_status_org on driver_status(org_id);
create index if not exists idx_driver_profile_changes_driver on driver_profile_changes(driver_id);
create index if not exists idx_driver_profile_changes_org on driver_profile_changes(org_id);
create index if not exists idx_request_events_org on request_events(org_id);
create index if not exists idx_blocks_org on blocks(org_id);
create index if not exists idx_device_tokens_user on device_tokens(user_id);
create index if not exists idx_notifications_user on notifications(user_id);
create index if not exists idx_user_org_membership_org on user_org_membership(org_id);
create index if not exists idx_driver_org_membership_org on driver_org_membership(org_id);
create index if not exists idx_driver_user_links_org on driver_user_links(org_id);
create index if not exists idx_driver_user_links_user on driver_user_links(user_id);
create index if not exists idx_driver_user_links_driver on driver_user_links(driver_id);
create index if not exists idx_driver_user_links_status on driver_user_links(status);

-- Helper functions
create or replace function is_org_member(p_org_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_org_membership m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
      and m.status = 'approved'
      and m.active = true
  );
$$;

create or replace function has_role(p_org_id uuid, p_role role_type)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_org_membership m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
      and m.role = p_role
      and m.status = 'approved'
      and m.active = true
  );
$$;

create or replace function org_is_active(p_org_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orgs o
    where o.id = p_org_id
      and o.active = true
      and o.status = 'active'
      and (o.suspended_until is null or o.suspended_until <= now())
  );
$$;

create or replace function has_any_staff_role()
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_org_membership m
    where m.user_id = auth.uid()
      and m.role in ('admin','dispatcher')
      and m.status = 'approved'
      and m.active = true
  );
$$;

create or replace function is_driver_in_org(p_driver_id uuid, p_org_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from driver_org_membership dom
    where dom.driver_id = p_driver_id
      and dom.org_id = p_org_id
      and dom.status = 'approved'
      and dom.active = true
  );
$$;

create or replace function is_driver_linked(p_driver_id uuid, p_org_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from driver_org_membership dom
    where dom.driver_id = p_driver_id
      and dom.org_id = p_org_id
      and dom.active = true
  );
$$;

create or replace function is_blocked(p_org_id uuid, p_user_id uuid, p_driver_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks b
    where (b.org_id is null or b.org_id = p_org_id)
      and (
        (b.blocked_by_type = 'org' and b.blocked_by_id = p_org_id and b.blocked_type = 'driver' and b.blocked_id = p_driver_id)
        or (b.blocked_by_type = 'driver' and b.blocked_by_id = p_driver_id and b.blocked_type = 'org' and b.blocked_id = p_org_id)
        or (b.blocked_by_type = 'user' and b.blocked_by_id = p_user_id and b.blocked_type = 'driver' and b.blocked_id = p_driver_id)
        or (b.blocked_by_type = 'driver' and b.blocked_by_id = p_driver_id and b.blocked_type = 'user' and b.blocked_id = p_user_id)
      )
  );
$$;

-- Invites: public lookup + accept flow
create or replace function get_invite_public(p_code text)
returns table (
  org_id uuid,
  org_name text,
  role role_type,
  expires_at timestamptz,
  status invite_status,
  auto_approve boolean
)
language sql
security definer
set search_path = public
as $$
  select i.org_id, o.name, i.role, i.expires_at, i.status, i.auto_approve
  from invites i
  join orgs o on o.id = i.org_id
  where i.code = upper(p_code)
    and i.status = 'active'
    and (i.expires_at is null or i.expires_at > now());
$$;

create or replace function accept_invite(
  p_code text,
  p_name text,
  p_phone text,
  p_cpf text,
  p_vehicle_plate text default null,
  p_vehicle_model text default null,
  p_vehicle_color text default null
)
returns table (
  org_id uuid,
  role role_type,
  status membership_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invites%rowtype;
  v_status membership_status;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_inv
  from invites
  where code = upper(p_code)
  for update;

  if not found then
    raise exception 'invite_not_found';
  end if;

  if v_inv.status <> 'active' then
    raise exception 'invite_not_active';
  end if;

  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    update invites set status = 'expired' where id = v_inv.id;
    raise exception 'invite_expired';
  end if;

  v_status := case when v_inv.auto_approve then 'approved' else 'pending' end;

  insert into users (id, name, phone, cpf, vehicle_plate, vehicle_model, vehicle_color)
  values (auth.uid(), p_name, p_phone, p_cpf, p_vehicle_plate, p_vehicle_model, p_vehicle_color)
  on conflict (id) do update set
    name = excluded.name,
    phone = excluded.phone,
    cpf = excluded.cpf,
    vehicle_plate = coalesce(excluded.vehicle_plate, users.vehicle_plate),
    vehicle_model = coalesce(excluded.vehicle_model, users.vehicle_model),
    vehicle_color = coalesce(excluded.vehicle_color, users.vehicle_color);

  if v_inv.role = 'driver' then
    insert into driver_org_membership (driver_id, org_id, status, active)
    values (auth.uid(), v_inv.org_id, v_status, true)
    on conflict (driver_id, org_id) do update
      set status = excluded.status,
          active = true;
  else
    insert into user_org_membership (user_id, org_id, role, status, active)
    values (auth.uid(), v_inv.org_id, v_inv.role, v_status, true)
    on conflict (user_id, org_id, role) do update
      set status = excluded.status,
          active = true;
  end if;

  update invites
  set status = 'used',
      used_at = now(),
      used_by = auth.uid()
  where id = v_inv.id;

  return query select v_inv.org_id, v_inv.role, v_status;
end;
$$;

grant execute on function get_invite_public(text) to anon, authenticated;
grant execute on function accept_invite(text, text, text, text, text, text, text) to authenticated;

-- Enable RLS
alter table orgs enable row level security;
alter table users enable row level security;
alter table user_org_membership enable row level security;
alter table driver_org_membership enable row level security;
alter table requests enable row level security;
alter table assignments enable row level security;
alter table driver_location enable row level security;
alter table driver_status enable row level security;
alter table driver_profile_changes enable row level security;
alter table request_events enable row level security;
alter table blocks enable row level security;
alter table device_tokens enable row level security;
alter table notifications enable row level security;
alter table driver_user_links enable row level security;
alter table user_favorite_drivers enable row level security;
alter table invites enable row level security;

-- Policies
-- Orgs: only members can read their org
create policy orgs_select on orgs
for select using (is_org_member(id));

-- Users: user can read own profile; org admins/dispatchers can read users in their org
create policy users_select_self on users
for select using (id = auth.uid());

create policy users_select_org on users
for select using (
  exists (
    select 1 from user_org_membership m
    where m.user_id = auth.uid()
      and m.role in ('admin','dispatcher')
      and m.active = true
      and exists (
        select 1 from user_org_membership m2
        where m2.user_id = users.id
          and m2.org_id = m.org_id
          and m2.active = true
      )
  )
);

-- Users: org members can see drivers in their org
create policy users_select_drivers_in_org on users
for select using (
  exists (
    select 1 from driver_org_membership dom
    where dom.driver_id = users.id
      and dom.active = true
      and (
        dom.status = 'approved'
        or has_role(dom.org_id, 'admin')
        or has_role(dom.org_id, 'dispatcher')
      )
      and exists (
        select 1 from user_org_membership m
        where m.user_id = auth.uid()
          and m.org_id = dom.org_id
          and m.status = 'approved'
          and m.active = true
      )
  )
);

-- Users: allow self-update for profile fields
create policy users_update_self on users
for update using (id = auth.uid())
with check (id = auth.uid());

-- Users: allow staff (admin/dispatcher) to update profiles in their org
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

-- Memberships: members can read their org memberships; admins can manage
create policy uom_select on user_org_membership
for select using (user_id = auth.uid() or has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

create policy uom_manage on user_org_membership
for all using (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'))
with check (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

create policy dom_select on driver_org_membership
for select using (driver_id = auth.uid() or has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

create policy dom_manage on driver_org_membership
for all using (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'))
with check (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

-- Requests
create policy requests_select on requests
for select using (
  (is_org_member(org_id) or is_driver_in_org(auth.uid(), org_id)) and (
    requester_id = auth.uid()
    or has_role(org_id, 'admin')
    or has_role(org_id, 'dispatcher')
    or (is_driver_in_org(auth.uid(), org_id) and status in ('open','approved'))
    or exists (
      select 1 from assignments a
      where a.request_id = requests.id
        and a.driver_id = auth.uid()
    )
  )
);

-- Insert requests: allowed for members, but block if org suspended
create policy requests_insert on requests
for insert with check (
  is_org_member(org_id)
  and org_is_active(org_id)
  and requester_id = auth.uid()
);

-- Update requests: only admin/dispatcher
create policy requests_update on requests
for update using (
  has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
  or exists (
    select 1 from assignments a
    where a.request_id = requests.id
      and a.driver_id = auth.uid()
  )
)
with check (
  has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
  or exists (
    select 1 from assignments a
    where a.request_id = requests.id
      and a.driver_id = auth.uid()
  )
);

-- Assignments
create policy assignments_select on assignments
for select using (
  (is_org_member(org_id) or is_driver_in_org(auth.uid(), org_id)) and (
    has_role(org_id, 'admin')
    or has_role(org_id, 'dispatcher')
    or driver_id = auth.uid()
  )
);

create policy assignments_insert on assignments
for insert with check (
  (
    (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'))
    and is_driver_in_org(driver_id, org_id)
  )
  or (
    driver_id = auth.uid()
    and is_driver_in_org(driver_id, org_id)
    and exists (
      select 1 from requests r
      where r.id = request_id
        and r.status in ('open','approved')
    )
  )
  and not exists (
    select 1 from assignments a
    where a.request_id = request_id
  )
  and not exists (
    select 1 from requests r
    where r.id = request_id
      and r.requester_id = driver_id
  )
  and not exists (
    select 1 from requests r
    where r.id = request_id
      and is_blocked(r.org_id, r.requester_id, driver_id)
  )
);

create policy assignments_update on assignments
for update using (
  has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
  or driver_id = auth.uid()
)
with check (
  has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
  or driver_id = auth.uid()
);

-- Driver location
create policy driver_location_select on driver_location
for select using (
  (is_org_member(org_id) or is_driver_in_org(auth.uid(), org_id)) and (
    has_role(org_id, 'admin')
    or has_role(org_id, 'dispatcher')
    or driver_id = auth.uid()
  )
);

create policy driver_location_upsert on driver_location
for all using (
  driver_id = auth.uid()
)
with check (
  driver_id = auth.uid()
  and is_driver_in_org(driver_id, org_id)
);

-- Driver status
create policy driver_status_select on driver_status
for select using (
  is_org_member(org_id)
  or (driver_id = auth.uid() and is_driver_in_org(auth.uid(), org_id))
);

create policy driver_status_upsert on driver_status
for all using (
  driver_id = auth.uid()
)
with check (
  driver_id = auth.uid()
  and is_driver_in_org(driver_id, org_id)
);

-- Driver profile changes: driver can insert/select own history; staff can read
create policy driver_profile_changes_select on driver_profile_changes
for select using (
  driver_id = auth.uid()
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

create policy driver_profile_changes_insert on driver_profile_changes
for insert with check (
  driver_id = auth.uid()
  and is_driver_linked(driver_id, org_id)
);

-- Grants
grant select, insert on driver_profile_changes to authenticated;

-- Request events
create policy request_events_select on request_events
for select using (
  is_org_member(org_id) and (
    has_role(org_id, 'admin')
    or has_role(org_id, 'dispatcher')
    or actor_id = auth.uid()
    or exists (
      select 1 from requests r
      where r.id = request_events.request_id
        and r.requester_id = auth.uid()
    )
    or exists (
      select 1 from assignments a
      where a.request_id = request_events.request_id
        and a.driver_id = auth.uid()
    )
  )
);

create policy request_events_insert on request_events
for insert with check (
  actor_id = auth.uid()
  and (
    is_org_member(org_id)
    -- An authorized driver can update a request and let its trigger record the change.
    or (pg_trigger_depth() > 0 and is_driver_in_org(auth.uid(), org_id))
  )
);

-- Blocks: admins/dispatchers can read and manage blocks within org
create policy blocks_select on blocks
for select using (
  (org_id is null and has_any_staff_role())
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

create policy blocks_manage on blocks
for all using (
  (org_id is null and has_any_staff_role())
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
)
with check (
  (org_id is null and has_any_staff_role())
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

-- Driver/User links
create policy links_select on driver_user_links
for select using (
  user_id = auth.uid()
  or (driver_id = auth.uid() and is_driver_in_org(driver_id, org_id))
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

create policy links_insert on driver_user_links
for insert with check (
  (
    requested_by = 'user'
    and user_id = auth.uid()
    and is_org_member(org_id)
    and is_driver_in_org(driver_id, org_id)
  ) or (
    requested_by = 'driver'
    and driver_id = auth.uid()
    and is_driver_in_org(driver_id, org_id)
    and exists (
      select 1 from user_org_membership m
      where m.user_id = driver_user_links.user_id
        and m.org_id = driver_user_links.org_id
        and m.active = true
    )
  )
);

create policy links_update on driver_user_links
for update using (
  user_id = auth.uid()
  or driver_id = auth.uid()
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
)
with check (
  (
    driver_id = auth.uid()
    and status in ('approved','rejected','blocked')
  )
  or (
    user_id = auth.uid()
    and status in ('pending','rejected')
    and requested_by = 'user'
    and driver_name is null
    and driver_phone is null
  )
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

-- Favorites: user can manage own favorites within org; staff can read
create policy favorites_select on user_favorite_drivers
for select using (
  user_id = auth.uid()
  or has_role(org_id, 'admin')
  or has_role(org_id, 'dispatcher')
);

create policy favorites_insert on user_favorite_drivers
for insert with check (
  user_id = auth.uid()
  and is_org_member(org_id)
  and is_driver_in_org(driver_id, org_id)
);

create policy favorites_delete on user_favorite_drivers
for delete using (
  user_id = auth.uid()
);

-- Device tokens: owner can manage own tokens
create policy device_tokens_select on device_tokens
for select using (user_id = auth.uid());

create policy device_tokens_insert on device_tokens
for insert with check (user_id = auth.uid());

create policy device_tokens_delete on device_tokens
for delete using (user_id = auth.uid());

-- Notifications: owner can read/update own notifications
create policy notifications_select on notifications
for select using (user_id = auth.uid());

create policy notifications_update on notifications
for update using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Invites: only staff manage
create policy invites_select on invites
for select using (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

create policy invites_manage on invites
for all using (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'))
with check (has_role(org_id, 'admin') or has_role(org_id, 'dispatcher'));

-- Triggers
create or replace function log_request_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into request_events (org_id, request_id, actor_id, event_type, from_status, to_status)
    values (new.org_id, new.id, auth.uid(), 'status_change', old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_status_change on requests;
create trigger trg_request_status_change
after update of status on requests
for each row execute function log_request_status_change();

-- Driver profile change audit
create or replace function log_driver_profile_changes()
returns trigger language plpgsql as $$
declare
  rec record;
begin
  for rec in
    select org_id from driver_org_membership
    where driver_id = new.id and active = true
  loop
    if new.name is distinct from old.name then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'name', old.name, new.name);
    end if;
    if new.phone is distinct from old.phone then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'phone', old.phone, new.phone);
    end if;
    if new.cpf is distinct from old.cpf then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'cpf', old.cpf, new.cpf);
    end if;
    if new.vehicle_plate is distinct from old.vehicle_plate then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'vehicle_plate', old.vehicle_plate, new.vehicle_plate);
    end if;
    if new.vehicle_model is distinct from old.vehicle_model then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'vehicle_model', old.vehicle_model, new.vehicle_model);
    end if;
    if new.vehicle_color is distinct from old.vehicle_color then
      insert into driver_profile_changes (driver_id, org_id, field, old_value, new_value)
      values (new.id, rec.org_id, 'vehicle_color', old.vehicle_color, new.vehicle_color);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_driver_profile_changes on users;
create trigger trg_driver_profile_changes
after update of name, phone, cpf, vehicle_plate, vehicle_model, vehicle_color on users
for each row execute function log_driver_profile_changes();
