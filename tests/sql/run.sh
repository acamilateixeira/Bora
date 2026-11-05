#!/usr/bin/env bash
# Aplica o schema do Bora em um Postgres comum e roda os testes do banco.
# Uso: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${DATABASE_URL:?defina DATABASE_URL para um banco de testes vazio e descartável}"
psql_() { psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# Recusa bancos já inicializados antes de aplicar os stubs e o schema.
empty_database="$(psql_ -Atc "
  select exists (select 1 from pg_namespace where nspname = 'public')
    and not exists (
      select 1 from pg_namespace
      where nspname not in ('public', 'information_schema') and nspname !~ '^pg_'
    )
    and not exists (
      select 1 from pg_depend
      where refclassid = 'pg_namespace'::regclass
        and refobjid = to_regnamespace('public')
    );
")"
if [[ "$empty_database" != t ]]; then
  echo 'Use um banco Postgres vazio e descartável para os testes.' >&2
  exit 1
fi

psql_ -f tests/sql/00_supabase_stubs.sql
psql_ -f supabase_schema.sql
# pg_net só existe no Supabase; o stub de net.http_post fica no lugar.
for f in supabase_push.sql supabase/migrations/*.sql; do
  echo "aplicando $f"
  sed '/create extension if not exists pg_net/d' "$f" | psql_
done

psql_ -f tests/sql/10_database.sql
