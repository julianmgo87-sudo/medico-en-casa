-- =============================================================================
-- Médico en Casa Palmira — 0003: utilidades, triggers, auditoría, estados
-- =============================================================================

-- ---------------------------------------------------------------- helpers de identidad
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select role from public.users where id = auth.uid() and status = 'active'), 'anon');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.require_role(p_role text)
returns uuid language plpgsql stable security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.users where id = v_uid and role = p_role and status = 'active') then
    raise exception 'No tienes permisos para realizar esta acción.' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function public.actor_role()
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select role from public.users where id = auth.uid()), 'system');
$$;

-- ---------------------------------------------------------------- configuración
create or replace function public.get_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select value from public.application_settings where key = p_key;
$$;

create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (value #>> '{}')::int from public.application_settings where key = p_key), p_default);
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (value #>> '{}')::boolean from public.application_settings where key = p_key), p_default);
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select value #>> '{}' from public.application_settings where key = p_key), p_default);
$$;

-- Ajustes públicos (sin datos sensibles) para la interfaz.
create or replace function public.get_public_settings()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.application_settings where is_public;
$$;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users', 'patient_profiles', 'service_categories', 'specialties', 'service_areas',
    'professional_profiles', 'professional_payout_accounts', 'membership_plans', 'patient_memberships',
    'pricing_rules', 'commissions', 'appointments', 'payments', 'application_settings']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- alta de usuarios
-- Crea el perfil público a partir de auth.users. El rol administrador NUNCA se
-- asigna desde el registro: solo puede otorgarlo otro administrador (o SQL directo).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'patient');
begin
  if v_role not in ('patient', 'professional') then
    v_role := 'patient';
  end if;
  insert into public.users (id, role, full_name, email, phone, terms_accepted_at, data_consent_at)
  values (
    new.id, v_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    case when (new.raw_user_meta_data ->> 'terms_accepted') = 'true' then now() end,
    case when (new.raw_user_meta_data ->> 'data_consent') = 'true' then now() end
  );
  if v_role = 'patient' then
    insert into public.patient_profiles (user_id) values (new.id);
  else
    insert into public.professional_profiles (user_id, status) values (new.id, 'draft');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Los usuarios no pueden cambiar su propio rol, estado ni correo desde la API.
create or replace function public.guard_user_update()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status
       or new.email is distinct from old.email or new.suspended_reason is distinct from old.suspended_reason then
      raise exception 'No puedes modificar el rol, el estado o el correo de la cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger users_guard before update on public.users for each row execute function public.guard_user_update();

-- El profesional no puede auto-aprobarse ni fijar su tarifa final.
create or replace function public.guard_professional_update()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Funciones internas de confianza (p. ej. recálculo de calificaciones) marcan app.trusted.
  if coalesce(current_setting('app.trusted', true), '') = 'on' then return new; end if;
  if auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status and not (old.status in ('draft', 'rejected') and new.status = 'pending_review') then
      raise exception 'No puedes cambiar el estado de verificación.' using errcode = '42501';
    end if;
    if new.approved_hourly_rate is distinct from old.approved_hourly_rate
       or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
       or new.rethus_verified_at is distinct from old.rethus_verified_at or new.rethus_verified_by is distinct from old.rethus_verified_by
       or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Estos campos solo los puede modificar el administrador.' using errcode = '42501';
    end if;
    -- Cambios sensibles en un perfil aprobado regresan a revisión.
    if old.status = 'approved' and (
         new.profession is distinct from old.profession or new.specialty_id is distinct from old.specialty_id
      or new.category_id is distinct from old.category_id
      or new.professional_registration is distinct from old.professional_registration
      or new.rethus_number is distinct from old.rethus_number
      or new.document_number is distinct from old.document_number) then
      raise exception 'Los cambios en credenciales profesionales deben ser aprobados por el administrador. Contacta a soporte.' using errcode = '42501';
    end if;
    if new.status = 'pending_review' and old.status <> 'pending_review' then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger professional_profiles_guard before update on public.professional_profiles
  for each row execute function public.guard_professional_update();

-- Un profesional no puede auto-aprobar credenciales.
create or replace function public.guard_credential_write()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null;
    elsif new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at or old.status = 'approved' then
      raise exception 'Las credenciales revisadas no pueden modificarse. Sube un nuevo documento.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger professional_credentials_guard before insert or update on public.professional_credentials
  for each row execute function public.guard_credential_write();

-- ---------------------------------------------------------------- auditoría
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id  text;
begin
  -- Nunca guardar números de cuenta completos en auditoría.
  if tg_table_name = 'professional_payout_accounts' then
    v_old := v_old - 'account_number' - 'holder_document';
    v_new := v_new - 'account_number' - 'holder_document';
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id',
                   v_new ->> 'key', v_old ->> 'key', v_new ->> 'professional_id', v_old ->> 'professional_id');
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), public.actor_role(), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['users', 'service_categories', 'specialties', 'service_areas', 'professional_profiles',
    'professional_payout_accounts', 'professional_credentials', 'membership_plans', 'patient_memberships',
    'pricing_rules', 'commissions', 'refunds', 'professional_payouts', 'application_settings', 'holidays',
    'professional_service_areas']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_data jsonb default null)
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values (auth.uid(), public.actor_role(), p_action, p_entity, p_entity_id, p_data);
$$;

-- ---------------------------------------------------------------- notificaciones (bandeja de salida)
create or replace function public.notify_user(
  p_user uuid, p_template text, p_title text, p_body text,
  p_link text default null, p_payload jsonb default '{}', p_dedupe text default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.notifications (user_id, channel, template, title, body, link, payload, dedupe_key)
  values (p_user, 'email', p_template, p_title, p_body, p_link, coalesce(p_payload, '{}'), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function public.notify_admins(p_template text, p_title text, p_body text, p_link text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in select id from public.users where role = 'admin' and status = 'active' loop
    perform public.notify_user(r.id, p_template, p_title, p_body, p_link);
  end loop;
end $$;

-- ---------------------------------------------------------------- estados de la cita
create or replace function public.appointment_status_label(s public.appointment_status)
returns text language sql immutable as $$
  select case s
    when 'pending_payment' then 'Pendiente de pago'
    when 'payment_processing' then 'Pago en procesamiento'
    when 'pending_acceptance' then 'Pendiente de aceptación'
    when 'confirmed' then 'Confirmada'
    when 'rejected' then 'Rechazada'
    when 'expired' then 'Expirada'
    when 'pending_reassignment' then 'Pendiente de reasignación'
    when 'professional_assigned' then 'Profesional asignado'
    when 'en_route' then 'Profesional en camino'
    when 'arrived' then 'Profesional llegó'
    when 'in_progress' then 'Atención en curso'
    when 'completed' then 'Completada'
    when 'cancelled' then 'Cancelada'
    when 'refund_pending' then 'Reembolso pendiente'
    when 'refunded' then 'Reembolsada'
    when 'disputed' then 'En disputa'
  end;
$$;

-- Matriz de transiciones válidas.
create or replace function public.appointment_transition_allowed(f public.appointment_status, t public.appointment_status)
returns boolean language sql immutable as $$
  select (f::text, t::text) in (
    ('pending_payment', 'payment_processing'), ('pending_payment', 'pending_acceptance'),
    ('pending_payment', 'expired'), ('pending_payment', 'cancelled'),
    ('payment_processing', 'pending_acceptance'), ('payment_processing', 'pending_payment'),
    ('payment_processing', 'expired'), ('payment_processing', 'cancelled'), ('payment_processing', 'pending_reassignment'),
    ('expired', 'pending_reassignment'), ('expired', 'pending_acceptance'),
    ('pending_acceptance', 'confirmed'), ('pending_acceptance', 'rejected'),
    ('pending_acceptance', 'expired'), ('pending_acceptance', 'cancelled'),
    ('rejected', 'pending_reassignment'),
    ('pending_reassignment', 'professional_assigned'), ('pending_reassignment', 'refund_pending'),
    ('pending_reassignment', 'cancelled'),
    ('professional_assigned', 'confirmed'), ('professional_assigned', 'rejected'),
    ('professional_assigned', 'expired'), ('professional_assigned', 'cancelled'),
    ('confirmed', 'en_route'), ('confirmed', 'cancelled'), ('confirmed', 'pending_acceptance'),
    ('confirmed', 'pending_reassignment'), ('confirmed', 'disputed'),
    ('en_route', 'arrived'), ('en_route', 'pending_reassignment'), ('en_route', 'disputed'),
    ('arrived', 'in_progress'), ('arrived', 'disputed'),
    ('in_progress', 'completed'), ('in_progress', 'disputed'),
    ('completed', 'disputed'),
    ('disputed', 'completed'), ('disputed', 'refund_pending'),
    ('cancelled', 'refund_pending'),
    ('refund_pending', 'refunded')
  );
$$;

create or replace function public.appointment_blocks_slot(s public.appointment_status)
returns boolean language sql immutable as $$
  select s in ('pending_payment', 'payment_processing', 'pending_acceptance', 'confirmed',
               'professional_assigned', 'en_route', 'arrived', 'in_progress', 'completed');
$$;

create or replace function public.appointments_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not public.appointment_transition_allowed(old.status, new.status) then
      raise exception 'Transición de estado no permitida: % → %',
        public.appointment_status_label(old.status), public.appointment_status_label(new.status)
        using errcode = 'P0001';
    end if;
  end if;
  new.blocked_range := tstzrange(new.starts_at, new.ends_at + make_interval(mins => new.travel_buffer_min), '[)');
  new.patient_range := tstzrange(new.starts_at, new.ends_at, '[)');
  new.blocks_slot := public.appointment_blocks_slot(new.status);
  return new;
end $$;
create trigger appointments_before_write before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

create or replace function public.appointments_after_write()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.appointment_status_history (appointment_id, from_status, to_status, changed_by, actor_role, reason, metadata)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      public.actor_role(),
      nullif(current_setting('app.status_reason', true), ''),
      coalesce(nullif(current_setting('app.status_meta', true), '')::jsonb, '{}'::jsonb)
    );
  end if;
  return new;
end $$;
create trigger appointments_after_write after insert or update on public.appointments
  for each row execute function public.appointments_after_write();

-- Cambia el estado registrando motivo (usado por todas las funciones de negocio).
create or replace function public.set_appointment_status(
  p_id uuid, p_to public.appointment_status, p_reason text default null, p_meta jsonb default '{}'
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  perform set_config('app.status_meta', coalesce(p_meta, '{}')::text, true);
  update public.appointments set status = p_to where id = p_id;
  perform set_config('app.status_reason', '', true);
  perform set_config('app.status_meta', '', true);
end $$;

-- ---------------------------------------------------------------- libro contable
-- p_lines: [{"account":"cash_gateway","direction":"debit","amount":1000}, ...]
create or replace function public.post_ledger(
  p_description text, p_lines jsonb,
  p_appointment uuid default null, p_payment uuid default null, p_refund uuid default null,
  p_payout uuid default null, p_membership uuid default null
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_group uuid := gen_random_uuid();
  v_debits numeric := 0; v_credits numeric := 0;
  l jsonb;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l ->> 'amount')::numeric = 0 then continue; end if;
    if (l ->> 'amount')::numeric < 0 then raise exception 'Monto contable negativo'; end if;
    insert into public.financial_ledger (entry_group, account, direction, amount, description,
      appointment_id, payment_id, refund_id, payout_id, membership_id, created_by)
    values (v_group, (l ->> 'account')::public.ledger_account, (l ->> 'direction')::public.ledger_direction,
      (l ->> 'amount')::numeric, p_description, p_appointment, p_payment, p_refund, p_payout, p_membership, auth.uid());
    if l ->> 'direction' = 'debit' then v_debits := v_debits + (l ->> 'amount')::numeric;
    else v_credits := v_credits + (l ->> 'amount')::numeric; end if;
  end loop;
  if v_debits <> v_credits then
    raise exception 'Asiento contable descuadrado (débitos %, créditos %)', v_debits, v_credits;
  end if;
  return v_group;
end $$;

create or replace function public.ledger_line(p_account text, p_direction text, p_amount numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object('account', p_account, 'direction', p_direction, 'amount', p_amount);
$$;
