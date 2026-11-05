-- Sample seed data for Bora
-- Create these users in Supabase Auth first (email + password),
-- then run this seed. It links profiles using auth.users by email.

-- Orgs
insert into orgs (id, name, status, billing_status)
values
  ('11111111-1111-1111-1111-111111111111', 'Secretaria de Educacao', 'active'::org_status, 'ok'::billing_status),
  ('22222222-2222-2222-2222-222222222222', 'Secretaria de Saude', 'active'::org_status, 'ok'::billing_status)
on conflict (id) do nothing;

-- Users (profiles) - use emails to resolve auth.users IDs
with u_admin as (
  select id from auth.users where email = 'admin@bora.local'
), u_dispatcher as (
  select id from auth.users where email = 'dispatcher@bora.local'
), u_driver as (
  select id from auth.users where email = 'driver@bora.local'
), u_rider as (
  select id from auth.users where email = 'rider@bora.local'
)
insert into users (id, name, phone)
select id, 'Admin Educacao', '31999990001' from u_admin
union all
select id, 'Dispatcher Educacao', '31999990002' from u_dispatcher
union all
select id, 'Motorista 01', '31999990003' from u_driver
union all
select id, 'Usuario 01', '31999990004' from u_rider
on conflict (id) do nothing;

-- User memberships
with u_admin as (select id from auth.users where email = 'admin@bora.local'),
u_dispatcher as (select id from auth.users where email = 'dispatcher@bora.local'),
u_rider as (select id from auth.users where email = 'rider@bora.local')
insert into user_org_membership (user_id, org_id, role)
select id, '11111111-1111-1111-1111-111111111111'::uuid, 'admin'::role_type from u_admin
union all
select id, '11111111-1111-1111-1111-111111111111'::uuid, 'dispatcher'::role_type from u_dispatcher
union all
select id, '11111111-1111-1111-1111-111111111111'::uuid, 'rider'::role_type from u_rider
on conflict do nothing;

update user_org_membership
set status = 'approved'
where org_id = '11111111-1111-1111-1111-111111111111';

-- Driver memberships + status
with u_driver as (select id from auth.users where email = 'driver@bora.local')
insert into driver_org_membership (driver_id, org_id)
select id, '11111111-1111-1111-1111-111111111111'::uuid from u_driver
on conflict do nothing;

update driver_org_membership
set status = 'approved'
where org_id = '11111111-1111-1111-1111-111111111111';

with u_driver as (select id from auth.users where email = 'driver@bora.local')
insert into driver_status (driver_id, org_id, status)
select id, '11111111-1111-1111-1111-111111111111'::uuid, 'online'::driver_status_enum from u_driver
on conflict (driver_id, org_id) do nothing;

-- Requests
with u_rider as (select id from auth.users where email = 'rider@bora.local')
insert into requests (id, org_id, requester_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng)
select
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '11111111-1111-1111-1111-111111111111'::uuid,
  id, 'open'::request_status, -19.9380, -44.0420, -19.9300, -44.0500
from u_rider
on conflict (id) do nothing;

-- Assignments
with u_driver as (select id from auth.users where email = 'driver@bora.local')
insert into assignments (org_id, request_id, driver_id, status)
select
  '11111111-1111-1111-1111-111111111111'::uuid,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  id, 'assigned'::assignment_status
from u_driver
on conflict do nothing;
