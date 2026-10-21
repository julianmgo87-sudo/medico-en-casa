-- =============================================================================
-- Médico en Casa Palmira — 0008: Row Level Security, vistas públicas y permisos
-- =============================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- catálogo público
create policy roles_read on public.roles for select using (true);

create policy categories_read on public.service_categories for select using (is_active or public.is_admin());
create policy categories_admin on public.service_categories for all using (public.is_admin()) with check (public.is_admin());

create policy specialties_read on public.specialties for select using (is_active or public.is_admin());
create policy specialties_admin on public.specialties for all using (public.is_admin()) with check (public.is_admin());

create policy areas_read on public.service_areas for select using (is_active or public.is_admin());
create policy areas_admin on public.service_areas for all using (public.is_admin()) with check (public.is_admin());

create policy holidays_read on public.holidays for select using (true);
create policy holidays_admin on public.holidays for all using (public.is_admin()) with check (public.is_admin());

create policy plans_read on public.membership_plans for select using (is_active or public.is_admin());
create policy plans_admin on public.membership_plans for all using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.application_settings for select using (is_public or public.is_admin());
create policy settings_admin on public.application_settings for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- usuarios
create policy users_self_read on public.users for select using (id = auth.uid() or public.is_admin());
create policy users_self_update on public.users for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy patient_profiles_rw on public.patient_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy patient_profiles_update on public.patient_profiles for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy addresses_read on public.patient_addresses for select using (patient_id = auth.uid() or public.is_admin());
create policy addresses_insert on public.patient_addresses for insert with check (patient_id = auth.uid());
create policy addresses_update on public.patient_addresses for update using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- ---------------------------------------------------------------- profesionales
create policy prof_read on public.professional_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy prof_update on public.professional_profiles for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy payout_acc_read on public.professional_payout_accounts for select using (professional_id = auth.uid() or public.is_admin());
create policy payout_acc_insert on public.professional_payout_accounts for insert with check (professional_id = auth.uid());
create policy payout_acc_update on public.professional_payout_accounts for update using (professional_id = auth.uid() or public.is_admin())
  with check (professional_id = auth.uid() or public.is_admin());

-- Si el profesional cambia su cuenta, debe volver a verificarse.
create or replace function public.reset_payout_verification()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() and (new.account_number is distinct from old.account_number or new.method is distinct from old.method
     or new.phone_number is distinct from old.phone_number or new.holder_document is distinct from old.holder_document) then
    new.verified_at := null; new.verified_by := null;
  end if;
  if not public.is_admin() and (new.verified_at is distinct from old.verified_at) and new.verified_at is not null then
    raise exception 'Solo el administrador verifica cuentas de pago.';
  end if;
  return new;
end $$;
create trigger payout_accounts_reverify before update on public.professional_payout_accounts
  for each row execute function public.reset_payout_verification();

create policy creds_read on public.professional_credentials for select using (professional_id = auth.uid() or public.is_admin());
create policy creds_insert on public.professional_credentials for insert with check (professional_id = auth.uid() or public.is_admin());
create policy creds_update on public.professional_credentials for update using (professional_id = auth.uid() or public.is_admin())
  with check (professional_id = auth.uid() or public.is_admin());
create policy creds_delete on public.professional_credentials for delete using ((professional_id = auth.uid() and status = 'pending') or public.is_admin());

create policy psa_read on public.professional_service_areas for select using (true);
create policy psa_write on public.professional_service_areas for insert with check (professional_id = auth.uid() or public.is_admin());
create policy psa_delete on public.professional_service_areas for delete using (professional_id = auth.uid() or public.is_admin());

create policy avail_read on public.professional_availability for select using (true);
create policy avail_insert on public.professional_availability for insert with check (professional_id = auth.uid() or public.is_admin());
create policy avail_update on public.professional_availability for update using (professional_id = auth.uid() or public.is_admin())
  with check (professional_id = auth.uid() or public.is_admin());
create policy avail_delete on public.professional_availability for delete using (professional_id = auth.uid() or public.is_admin());

create policy exc_read on public.availability_exceptions for select using (professional_id = auth.uid() or public.is_admin());
create policy exc_insert on public.availability_exceptions for insert with check (professional_id = auth.uid() or public.is_admin());
create policy exc_delete on public.availability_exceptions for delete using (professional_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- membresías, precios
create policy memberships_read on public.patient_memberships for select using (patient_id = auth.uid() or public.is_admin());
create policy memberships_admin on public.patient_memberships for update using (public.is_admin()) with check (public.is_admin());

create policy pricing_admin on public.pricing_rules for all using (public.is_admin()) with check (public.is_admin());
create policy commissions_admin on public.commissions for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- citas (solo lectura; escritura vía funciones)
create policy appt_read on public.appointments for select using (patient_id = auth.uid() or public.is_admin());
create or replace function public.can_view_appointment(p_appointment uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select public.is_admin() or exists (select 1 from public.appointments a where a.id = p_appointment
                                       and (a.patient_id = auth.uid() or a.professional_id = auth.uid()));
$$;
create policy appt_history_read on public.appointment_status_history for select using (public.can_view_appointment(appointment_id));
create policy appt_rejections_read on public.appointment_rejections for select using (professional_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- dinero
create policy payments_read on public.payments for select using (patient_id = auth.uid() or public.is_admin());
create policy payment_events_admin on public.payment_events for select using (public.is_admin());
create policy refunds_read on public.refunds for select using (
  public.is_admin() or exists (select 1 from public.payments p where p.id = payment_id and p.patient_id = auth.uid()));
create policy payouts_read on public.professional_payouts for select using (professional_id = auth.uid() or public.is_admin());
create policy payout_items_read on public.payout_items for select using (
  public.is_admin() or exists (select 1 from public.professional_payouts po where po.id = payout_id and po.professional_id = auth.uid()));
create policy ledger_admin on public.financial_ledger for select using (public.is_admin());

-- ---------------------------------------------------------------- otros
create policy reviews_read on public.reviews for select using (is_visible or patient_id = auth.uid() or public.is_admin());
create policy reviews_admin on public.reviews for update using (public.is_admin()) with check (public.is_admin());
create policy notifications_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_admin on public.audit_logs for select using (public.is_admin());

-- ---------------------------------------------------------------- vistas públicas (solo campos seguros)
-- Se ejecutan con permisos del propietario a propósito: exponen únicamente columnas
-- públicas de profesionales APROBADOS. Nunca documento, cuenta bancaria ni archivos.
create view public.public_professionals as
select
  p.user_id as id, u.full_name, p.profession, p.years_experience, p.bio, p.photo_path,
  p.category_id, c.slug as category_slug, c.name as category_name, c.booking_enabled,
  p.specialty_id, s.name as specialty_name,
  p.approved_hourly_rate as hourly_rate, p.default_duration_min,
  public.round_cop(p.approved_hourly_rate * p.default_duration_min / 60.0) as price_from,
  p.rating_avg, p.rating_count, (p.rethus_verified_at is not null) as rethus_verified,
  coalesce((select array_agg(sa.name order by sa.name) from public.professional_service_areas psa
            join public.service_areas sa on sa.id = psa.service_area_id where psa.professional_id = p.user_id), '{}') as zones,
  coalesce((select jsonb_agg(jsonb_build_object('type', cr.credential_type, 'title', cr.title, 'institution', cr.institution,
                                                 'year', extract(year from cr.issued_on)) order by cr.issued_on desc nulls last)
            from public.professional_credentials cr
            where cr.professional_id = p.user_id and cr.status = 'approved' and cr.credential_type not in ('id_document')), '[]') as credentials
from public.professional_profiles p
join public.users u on u.id = p.user_id and u.status = 'active'
join public.service_categories c on c.id = p.category_id and c.is_active
join public.specialties s on s.id = p.specialty_id
where p.status = 'approved';

create view public.public_reviews as
select r.id, r.professional_id, r.rating, r.comment, r.created_at,
       split_part(u.full_name, ' ', 1) as patient_first_name
from public.reviews r join public.users u on u.id = r.patient_id
where r.is_visible;

create view public.category_catalog as
select c.id, c.slug, c.name, c.description, c.icon, c.sort_order, c.booking_enabled,
       (select count(*) from public.public_professionals pp where pp.category_id = c.id) as professionals_count,
       (select min(pp.price_from) from public.public_professionals pp where pp.category_id = c.id) as price_from
from public.service_categories c
where c.is_active;

-- ---------------------------------------------------------------- permisos de ejecución
revoke execute on all functions in schema public from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
  end if;
end $$;

do $$
declare
  f text;
  public_fns text[] := array[
    'is_admin()', 'current_app_role()', 'get_public_settings()', 'round_cop(numeric)',
    'get_price_quote(uuid, public.care_type, timestamptz, integer, uuid, text)',
    'get_available_slots(uuid, date, date, public.care_type, integer, uuid)',
    'find_first_available(uuid, uuid, public.care_type, uuid, date, date)',
    'slot_is_available(uuid, timestamptz, integer, public.care_type, uuid)',
    'professional_covers_area(uuid, uuid)', 'can_view_appointment(uuid)', 'appointment_status_label(public.appointment_status)'
  ];
  user_fns text[] := array[
    'create_appointment_hold(uuid, public.care_type, timestamptz, integer, uuid, text, text)',
    'create_appointment_payment(uuid)', 'respond_to_appointment(uuid, boolean, text, text)',
    'find_alternatives(uuid)', 'accept_alternative(uuid, uuid, timestamptz, boolean)',
    'admin_reassign_appointment(uuid, uuid, timestamptz, text)', 'request_refund_instead(uuid)',
    'cancel_appointment(uuid, text, numeric)', 'reschedule_appointment(uuid, timestamptz, boolean)',
    'update_service_progress(uuid, public.appointment_status)', 'patient_confirm_completion(uuid)',
    'open_dispute(uuid, text)', 'admin_resolve_dispute(uuid, text, text)', 'admin_verify_appointment(uuid)',
    'submit_review(uuid, integer, text)', 'professional_appointments(text)',
    'create_membership_checkout(uuid)', 'admin_grant_membership(uuid, integer, text)',
    'admin_complete_refund(uuid, text, text, text)', 'admin_set_refund_processing(uuid, text)',
    'admin_reconcile_payment(uuid, numeric)',
    'generate_payouts(date, date)', 'admin_set_payout_adjustment(uuid, numeric, text)', 'approve_payout(uuid)',
    'mark_payout_paid(uuid, text, text, text)', 'cancel_payout(uuid, text)', 'professional_earnings_summary()',
    'admin_approve_professional(uuid, numeric, text)', 'admin_reject_professional(uuid, text)',
    'admin_set_user_status(uuid, text, text)', 'admin_dashboard_stats(date, date, uuid, uuid)'
  ];
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  foreach f in array public_fns loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array user_fns loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on all functions in schema public to service_role';
  execute 'grant select on public.public_professionals, public.public_reviews, public.category_catalog to anon, authenticated';
end $$;
