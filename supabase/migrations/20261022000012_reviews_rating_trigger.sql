-- =============================================================================
-- Médico en Casa Palmira — 0012: el promedio de calificaciones se recalcula
-- automáticamente al crear, ocultar/mostrar o eliminar una valoración.
-- =============================================================================
create or replace function public.recalc_professional_rating()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_prof uuid := coalesce(new.professional_id, old.professional_id);
begin
  perform set_config('app.trusted', 'on', true);
  update public.professional_profiles p set
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.reviews where professional_id = v_prof and is_visible), 0),
    rating_count = (select count(*) from public.reviews where professional_id = v_prof and is_visible)
  where p.user_id = v_prof;
  perform set_config('app.trusted', '', true);
  return null;
end $$;

create trigger reviews_recalc_rating after insert or update of is_visible, rating or delete on public.reviews
  for each row execute function public.recalc_professional_rating();

-- Las acciones de moderación quedan en auditoría.
create trigger reviews_audit after update or delete on public.reviews
  for each row execute function public.audit_row_change();
