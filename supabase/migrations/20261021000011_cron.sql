-- =============================================================================
-- Médico en Casa Palmira — 0011: procesos automáticos con pg_cron
-- Vencimientos de pagos/solicitudes, devoluciones automáticas, membresías y
-- recordatorios corren en la base de datos cada minuto, sin depender del navegador.
-- Si pg_cron no está disponible, usar /api/cron/jobs (ver docs/DESPLIEGUE.md).
-- =============================================================================
do $outer$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no disponible (%). Configure el cron HTTP alternativo.', sqlerrm;
    return;
  end;
  perform cron.schedule('mcp-run-scheduled-jobs', '* * * * *', 'select public.run_scheduled_jobs()');
end $outer$;
