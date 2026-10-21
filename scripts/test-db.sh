#!/usr/bin/env bash
# Aplica todas las migraciones sobre una base PostgreSQL local limpia y ejecuta
# las pruebas de flujo completo. Uso: PGHOST=/tmp PGPORT=5433 npm run db:test
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-mcp_test}
export PGUSER=${PGUSER:-postgres}
psql -q -X -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
run supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migración: $(basename "$f")"
  run "$f"
done
echo "-- pruebas --"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/01_full_flow.sql
