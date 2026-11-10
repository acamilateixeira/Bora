// Cenários da demo do Bora. Cada passo roda SQL de verdade no schema do app,
// como o usuário indicado, com a RLS e as funções security definer valendo.
// O mesmo arquivo é usado pela página (PGlite no navegador) e pelo teste do CI.

export const ORG = {
  educacao: '11111111-1111-1111-1111-111111111111',
  saude: '22222222-2222-2222-2222-222222222222',
};

export const PEOPLE = {
  rider: { id: 'a0000000-0000-0000-0000-000000000004', name: { pt: 'Usuário 01 · passageiro, Educação', en: 'User 01 · rider, Education' } },
  dispatcher: { id: 'a0000000-0000-0000-0000-000000000002', name: { pt: 'Despacho · Educação', en: 'Dispatch · Education' } },
  driver: { id: 'a0000000-0000-0000-0000-000000000003', name: { pt: 'Motorista 01 · Educação', en: 'Driver 01 · Education' } },
  otherRider: { id: 'b0000000-0000-0000-0000-000000000004', name: { pt: 'Passageiro · Saúde', en: 'Rider · Health' } },
};

/** Arquivos SQL na ordem em que o app é instalado (mesma ordem de tests/sql/run.sh). */
export const SQL_FILES = [
  'tests/sql/00_supabase_stubs.sql',
  'supabase_schema.sql',
  'supabase_push.sql',
  'supabase/migrations/20261105120000_secure_notify.sql',
  'supabase/migrations/20261105120100_expire_stale_driver_status.sql',
  'supabase/migrations/20261110120000_fix_assignments_insert_policy.sql',
];

/** Extensões que só existem no Supabase (pg_net) ou que o schema não usa de fato (pgcrypto). */
export function adapt(sql) {
  return sql
    .replace(/^create extension if not exists pg_net;$/gim, '-- pg_net: stub em tests/sql/00_supabase_stubs.sql')
    .replace(/^create extension if not exists pgcrypto;$/gim, '-- pgcrypto: gen_random_uuid() já é nativo');
}

export const SEED_PRELUDE = `
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@bora.local'),
  ('a0000000-0000-0000-0000-000000000002', 'dispatcher@bora.local'),
  ('a0000000-0000-0000-0000-000000000003', 'driver@bora.local'),
  ('a0000000-0000-0000-0000-000000000004', 'rider@bora.local'),
  ('b0000000-0000-0000-0000-000000000004', 'rider@outra.local');`;

export const SEED_EPILOGUE = `
insert into users (id, name, phone) values ('b0000000-0000-0000-0000-000000000004', 'Passageiro Saude', '31999990009');
insert into user_org_membership (user_id, org_id, role, status)
values ('b0000000-0000-0000-0000-000000000004', '${ORG.saude}', 'rider', 'approved');
insert into requests (org_id, requester_id, status, pickup_label, drop_label, pickup_lat, pickup_lng, drop_lat, drop_lng)
values ('${ORG.saude}', 'b0000000-0000-0000-0000-000000000004', 'open', 'UBS Centro', 'Hospital Regional', -19.03, -43.43, -19.02, -43.42);
-- A corrida do seed oficial já foi concluída pelo despacho; o motorista começa livre.
select set_config('test.uid', '${PEOPLE.dispatcher.id}', false);
update assignments set status = 'finished';
update requests set status = 'done' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select set_config('test.uid', '', false);`;

const own = `(select id from requests where requester_id = '${PEOPLE.rider.id}' and pickup_label = 'Escola Municipal' order by created_at desc limit 1)`;

export const SCENARIOS = [
  {
    id: 'ride',
    title: { pt: 'Pedido de corrida', en: 'Ride request' },
    summary: {
      pt: 'O app insere direto na tabela com a chave pública do Supabase. Quem decide se pode é a política de RLS, não a tela.',
      en: 'The app inserts straight into the table with the public Supabase key. A RLS policy decides what is allowed, not the screen.',
    },
    steps: [
      {
        as: 'rider', expect: 'ok',
        title: { pt: 'Pede uma corrida na própria secretaria', en: 'Requests a ride in their own department' },
        sql: `insert into requests (org_id, requester_id, pickup_label, drop_label, pickup_lat, pickup_lng, drop_lat, drop_lng)
values ('${ORG.educacao}', auth.uid(), 'Escola Municipal', 'Posto de Saúde', -19.033, -43.425, -19.040, -43.431)
returning public_code, status, pickup_label, drop_label`,
      },
      {
        as: 'rider', expect: 'denied',
        title: { pt: 'Tenta pedir em outra secretaria', en: 'Tries to request in another department' },
        note: { pt: 'Ele não é membro da Saúde. A política requests_insert recusa.', en: 'They are not a member of Health. The requests_insert policy refuses it.' },
        sql: `insert into requests (org_id, requester_id, pickup_lat, pickup_lng, drop_lat, drop_lng)
values ('${ORG.saude}', auth.uid(), -19.03, -43.43, -19.02, -43.42)
returning public_code`,
      },
      {
        as: 'otherRider', expect: 'ok', rows: 1,
        title: { pt: 'Passageiro da Saúde lista as corridas que enxerga', en: 'A Health rider lists the rides they can see' },
        note: { pt: 'Só aparece a corrida dele. As da Educação não vazam.', en: 'Only their own ride shows up. Education rides do not leak.' },
        sql: `select pickup_label, drop_label, status from requests order by created_at`,
      },
    ],
  },
  {
    id: 'dispatch',
    title: { pt: 'Despacho aprova e atribui', en: 'Dispatch approves and assigns' },
    summary: {
      pt: 'O despacho vê as corridas da secretaria, aprova e escolhe o motorista. Gatilhos registram o histórico e criam as notificações.',
      en: 'Dispatch sees the department rides, approves, and picks a driver. Triggers record the history and create the notifications.',
    },
    steps: [
      {
        as: 'dispatcher', expect: 'ok', rows: 1,
        title: { pt: 'Aprova a corrida', en: 'Approves the ride' },
        sql: `update requests set status = 'approved' where id = ${own} returning public_code, status`,
      },
      {
        as: 'dispatcher', expect: 'ok', rows: 1,
        title: { pt: 'Atribui ao Motorista 01', en: 'Assigns Driver 01' },
        sql: `insert into assignments (org_id, request_id, driver_id)
values ('${ORG.educacao}', ${own}, '${PEOPLE.driver.id}')
returning status`,
      },
      {
        as: 'driver', expect: 'ok', minRows: 1,
        title: { pt: 'O motorista recebe a notificação', en: 'The driver gets the notification' },
        note: { pt: 'Criada pelo gatilho da atribuição. Sem o segredo no Vault, fica só no histórico do app em vez de virar push.', en: 'Created by the assignment trigger. Without the Vault secret it stays in the app history instead of becoming a push.' },
        sql: `select title, body from notifications where title = 'Nova corrida atribuida' order by created_at desc limit 1`,
      },
      {
        as: 'rider', expect: 'ok', minRows: 1,
        title: { pt: 'O passageiro vê o histórico de status', en: 'The rider sees the status history' },
        sql: `select from_status, to_status from request_events where request_id = ${own} order by created_at`,
      },
    ],
  },
  {
    id: 'driver',
    title: { pt: 'Disponibilidade do motorista', en: 'Driver availability' },
    summary: {
      pt: 'Aprovado na secretaria não significa disponível. O status é mudado só pelo próprio motorista, por uma função que fecha o período anterior no histórico.',
      en: 'Approved in a department does not mean available. Only the driver changes their status, through a function that closes the previous period in the history.',
    },
    steps: [
      {
        as: 'driver', expect: 'ok', rows: 1,
        title: { pt: 'Motorista aceita a corrida', en: 'Driver accepts the ride' },
        sql: `update assignments set status = 'accepted' where request_id = ${own} and driver_id = auth.uid() returning status`,
      },
      {
        as: 'driver', expect: 'ok',
        title: { pt: 'Motorista fica ocupado', en: 'Driver becomes busy' },
        sql: `select set_driver_status(auth.uid(), array['${ORG.educacao}']::uuid[], 'busy')`,
      },
      {
        as: 'dispatcher', expect: 'denied',
        title: { pt: 'Despacho tenta colocar o motorista offline', en: 'Dispatch tries to set the driver offline' },
        note: { pt: 'set_driver_status confere auth.uid(). Nem a equipe muda o status de outra pessoa.', en: 'set_driver_status checks auth.uid(). Not even staff can change someone else’s status.' },
        sql: `select set_driver_status('${PEOPLE.driver.id}', array['${ORG.educacao}']::uuid[], 'offline')`,
      },
      {
        as: 'dispatcher', expect: 'ok', rows: 1,
        title: { pt: 'Despacho vê o motorista ocupado', en: 'Dispatch sees the driver as busy' },
        note: { pt: 'O despacho lê o status, só não pode alterá-lo.', en: 'Dispatch can read the status, just not change it.' },
        sql: `select status from driver_status where driver_id = '${PEOPLE.driver.id}' and org_id = '${ORG.educacao}'`,
      },
    ],
  },
  {
    id: 'guards',
    title: { pt: 'O que o app não consegue fazer', en: 'What the app cannot do' },
    summary: {
      pt: 'Rotinas do servidor e envio de push ficam fora do alcance da chave pública: o papel authenticated não tem permissão de executar.',
      en: 'Server routines and push sending are out of reach for the public key: the authenticated role has no execute permission.',
    },
    steps: [
      {
        as: 'rider', expect: 'denied',
        title: { pt: 'Usuário tenta disparar notificação para alguém', en: 'A user tries to send someone a notification' },
        sql: `select notify_user('${PEOPLE.driver.id}', null, 'spam', 'spam', '{}')`,
      },
      {
        as: 'driver', expect: 'denied',
        title: { pt: 'Motorista tenta rodar a expiração de status', en: 'A driver tries to run the status expiry job' },
        sql: `select expire_stale_driver_status()`,
      },
    ],
  },
];

/** Monta o script do passo: entra como o usuário, roda o SQL e devolve as linhas em JSON. */
export function stepScript(step) {
  const uid = PEOPLE[step.as].id;
  return `begin;
set local role authenticated;
set local test.uid = '${uid}';
with r as (
${step.sql}
)
select coalesce(json_agg(r), '[]'::json)::text as rows from r;
commit;`;
}

/** Confere o resultado contra o esperado. */
export function verdict(step, outcome) {
  if (step.expect === 'denied') return !outcome.ok;
  if (!outcome.ok) return false;
  if (step.rows !== undefined && outcome.rows.length !== step.rows) return false;
  if (step.minRows !== undefined && outcome.rows.length < step.minRows) return false;
  return true;
}
