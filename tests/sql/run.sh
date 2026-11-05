#!/usr/bin/env bash
# Aplica o schema do Bora em um Postgres comum e roda os testes do banco.
# Uso: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${DATABASE_URL:?defina DATABASE_URL}"
psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_ -c 'drop schema if exists public cascade' -c 'create schema public' \
      -c 'drop schema if exists auth cascade' -c 'drop schema if exists vault cascade' \
      -c 'drop schema if exists net cascade'

psql_ -f tests/sql/00_supabase_stubs.sql
psql_ -f supabase_schema.sql
# pg_net só existe no Supabase; o stub de net.http_post fica no lugar.
for f in supabase_push.sql supabase/migrations/*.sql; do
  echo "aplicando $f"
  sed '/create extension if not exists pg_net/d' "$f" | psql_
done

psql_ -f tests/sql/10_database.sql
