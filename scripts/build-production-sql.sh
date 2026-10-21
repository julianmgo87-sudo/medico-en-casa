#!/usr/bin/env bash
# Une todas las migraciones en un solo archivo para pegarlo en
# Supabase → SQL Editor (alternativa a `supabase db push`).
set -euo pipefail
cd "$(dirname "$0")/.."
out=supabase/instalacion-produccion.sql
{
  echo "-- Médico en Casa Palmira — instalación completa de la base de datos."
  echo "-- Generado por scripts/build-production-sql.sh. Ejecutar UNA sola vez en un proyecto nuevo."
  echo "-- Supabase → SQL Editor → New query → pegar todo → Run."
  echo
  for f in supabase/migrations/*.sql; do
    echo "-- >>>>>>>>>> $(basename "$f")"
    cat "$f"
    echo
  done
} > "$out"
echo "Generado $out ($(wc -l < "$out") líneas)"
