-- =============================================================================
-- Médico en Casa Palmira — 0005: flujo de reservas
-- Toda la lógica corre en el servidor (funciones SECURITY DEFINER con validación
-- de rol). El navegador nunca decide precios, estados ni disponibilidad.
-- =============================================================================

create or replace function public.has_active_membership(p_patient uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.patient_memberships m
    where m.patient_id = p_patient and m.status = 'active' and m.starts_at <= now() and m.ends_at > now()
  );
$$;

create or replace function public.response_timeout_min(p_care public.care_type)
returns int language sql stable security definer set search_path = public, extensions as $$
  select case p_care when 'priority' then public.setting_int('response_timeout_priority_min', 15)
                     else public.setting_int('response_timeout_scheduled_min', 30) end;
$$;

create or replace function public.fmt_cop(p numeric)
returns text language sql immutable as $$
  select '$' || replace(to_char(coalesce(p, 0), 'FM999G999G999G990'), ',', '.') || ' COP';
$$;

create or replace function public.fmt_bogota(p timestamptz)
returns text language sql immutable as $$
  select to_char(p at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI');
$$;

-- ---------------------------------------------------------------- reembolsos (interno)
create or replace function public.create_refund_internal(p_appointment uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.appointments;
  v_payment uuid;
  v_refund uuid;
  v_already numeric;
begin
  select * into a from public.appointments where id = p_appointment for update;
  select id into v_payment from public.payments where appointment_id = p_appointment and status = 'approved';
  if v_payment is null or p_amount <= 0 then return null; end if;
  select coalesce(sum(amount), 0) into v_already from public.refunds
   where appointment_id = p_appointment and status not in ('cancelled', 'failed');
  if v_already + p_amount > a.amount_paid then
    raise exception 'El reembolso supera el valor pagado.';
  end if;
  insert into public.refunds (payment_id, appointment_id, amount, reason, requested_by)
  values (v_payment, p_appointment, p_amount, p_reason, auth.uid())
  returning id into v_refund;
  update public.appointments set payment_state = 'refund_pending' where id = p_appointment;
  perform public.notify_user(a.patient_id, 'refund_requested', 'Devolución en trámite',
    format('Iniciamos la devolución de %s de tu cita %s. Te avisaremos cuando la transferencia se haya realizado.',
      public.fmt_cop(p_amount), a.code), '/paciente/citas/' || a.id);
  perform public.notify_admins('admin_refund_pending', 'Reembolso pendiente',
    format('Cita %s: devolución de %s. Motivo: %s', a.code, public.fmt_cop(p_amount), p_reason), '/admin/pagos');
  return v_refund;
end $$;

-- ---------------------------------------------------------------- reserva temporal + pago
create or replace function public.create_appointment_payment(p_appointment uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  a public.appointments;
  v_ref text;
begin
  select * into a from public.appointments where id = p_appointment and patient_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if a.status <> 'pending_payment' then raise exception 'Esta cita no está pendiente de pago.'; end if;
  if a.hold_expires_at <= now() then raise exception 'La reserva temporal venció. Selecciona nuevamente el horario.'; end if;
  if exists (select 1 from public.payments where appointment_id = a.id and status = 'processing') then
    raise exception 'Ya tienes un pago en procesamiento para esta cita. Espera la confirmación de la entidad.';
  end if;
  v_ref := 'CITA-' || replace(a.code, 'MCP-', '') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.payments (reference, purpose, patient_id, appointment_id, amount)
  values (v_ref, 'appointment', v_uid, a.id, a.total_amount);
  return jsonb_build_object('reference', v_ref, 'amount', a.total_amount, 'amount_in_cents', (a.total_amount * 100)::bigint,
                            'currency', 'COP', 'appointment_id', a.id, 'hold_expires_at', a.hold_expires_at);
end $$;

create or replace function public.create_appointment_hold(
  p_professional uuid, p_care public.care_type, p_starts_at timestamptz, p_duration_min int,
  p_address_id uuid, p_promo text default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid  uuid := public.require_role('patient');
  pr     public.professional_profiles;
  cat    public.service_categories;
  addr   public.patient_addresses;
  v_dur  int;
  q      jsonb;
  v_id   uuid;
  v_code text;
  v_pay  jsonb;
begin
  if public.setting_bool('membership_required', true) and not public.has_active_membership(v_uid) then
    raise exception 'Necesitas una membresía activa para solicitar citas.' using errcode = 'MC002';
  end if;

  select * into pr from public.professional_profiles where user_id = p_professional and status = 'approved';
  if pr.user_id is null then raise exception 'El profesional no está disponible.'; end if;
  select * into cat from public.service_categories where id = pr.category_id;
  if not cat.booking_enabled or not cat.is_active then
    raise exception 'Este servicio aún no está habilitado para reservas.';
  end if;

  select * into addr from public.patient_addresses where id = p_address_id and patient_id = v_uid and not is_archived;
  if addr.id is null then raise exception 'Selecciona una dirección válida.'; end if;
  if addr.service_area_id is null or not public.professional_covers_area(p_professional, addr.service_area_id) then
    raise exception 'Lo sentimos, este profesional no presta servicio en la zona de tu dirección.' using errcode = 'MC003';
  end if;

  v_dur := coalesce(p_duration_min, pr.default_duration_min);
  -- Libera reservas temporales sin pagar del mismo paciente.
  perform public.set_appointment_status(id, 'cancelled', 'Reemplazada por una nueva reserva')
    from public.appointments
   where patient_id = v_uid and status = 'pending_payment'
     and not exists (select 1 from public.payments p where p.appointment_id = appointments.id and p.status in ('processing', 'approved'));

  if not public.slot_is_available(p_professional, p_starts_at, v_dur, p_care) then
    raise exception 'El horario seleccionado ya no está disponible.' using errcode = 'MC004';
  end if;

  q := public.compute_quote(p_professional, p_care, p_starts_at, v_dur, addr.service_area_id, p_promo);

  begin
    insert into public.appointments (
      patient_id, professional_id, original_professional_id, category_id, specialty_id, care_type,
      status, starts_at, ends_at, duration_min, travel_buffer_min, blocked_range, patient_range,
      address_id, service_area_id, address_snapshot, promo_code, patient_notes,
      hourly_rate, base_amount, surcharges_amount, travel_fee, service_fee, discount_amount, total_amount, price_breakdown,
      commission_percent, commission_base_rule, commission_base_amount, commission_amount, professional_net_amount,
      hold_expires_at)
    values (
      v_uid, p_professional, p_professional, pr.category_id, pr.specialty_id, p_care,
      'pending_payment', p_starts_at, p_starts_at + make_interval(mins => v_dur), v_dur, pr.travel_buffer_min,
      'empty'::tstzrange, 'empty'::tstzrange,
      addr.id, addr.service_area_id,
      jsonb_build_object('label', addr.label, 'address_line', addr.address_line, 'neighborhood', addr.neighborhood,
        'reference_notes', addr.reference_notes,
        'area_name', (select name from public.service_areas where id = addr.service_area_id)),
      nullif(trim(p_promo), ''), nullif(trim(p_notes), ''),
      (q ->> 'hourly_rate')::numeric, (q ->> 'base_amount')::numeric, (q ->> 'surcharges_amount')::numeric,
      (q ->> 'travel_fee')::numeric, (q ->> 'service_fee')::numeric, (q ->> 'discount_amount')::numeric,
      (q ->> 'total_amount')::numeric, q,
      (q ->> 'commission_percent')::numeric, q ->> 'commission_base_rule', (q ->> 'commission_base_amount')::numeric,
      (q ->> 'commission_amount')::numeric, (q ->> 'professional_net_amount')::numeric,
      now() + make_interval(mins => public.setting_int('payment_hold_min', 20)))
    returning id, code into v_id, v_code;
  exception when exclusion_violation then
    raise exception 'El horario acaba de ser reservado por otra persona o se cruza con otra cita tuya. Elige otro horario.'
      using errcode = 'MC004';
  end;

  if (q ->> 'total_amount')::numeric = 0 then
    raise exception 'El valor de la cita no puede ser cero.';
  end if;

  v_pay := public.create_appointment_payment(v_id);
  return jsonb_build_object('appointment_id', v_id, 'code', v_code, 'quote', q - 'commission_percent' - 'commission_base_rule'
    - 'commission_base_amount' - 'commission_amount' - 'professional_net_amount') || v_pay;
end $$;

-- ---------------------------------------------------------------- aceptación / rechazo
create or replace function public.move_to_reassignment(p_appointment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.appointments;
begin
  update public.appointments
     set reassignment_deadline = now() + make_interval(hours => public.setting_int('reassignment_decision_hours', 12)),
         response_deadline = null
   where id = p_appointment returning * into a;
  perform public.set_appointment_status(p_appointment, 'pending_reassignment', p_reason);
  perform public.notify_user(a.patient_id, 'appointment_needs_reassignment', 'Tu cita necesita un nuevo profesional',
    format('Tu cita %s del %s no pudo ser atendida por el profesional asignado (%s). Ingresa para elegir otro profesional disponible o solicitar la devolución completa.',
      a.code, public.fmt_bogota(a.starts_at), p_reason), '/paciente/citas/' || a.id);
end $$;

create or replace function public.respond_to_appointment(
  p_appointment uuid, p_accept boolean, p_reason text default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('professional');
  a public.appointments;
  v_label text;
begin
  select * into a from public.appointments where id = p_appointment and professional_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if a.status not in ('pending_acceptance', 'professional_assigned') then
    raise exception 'Esta solicitud ya no está pendiente (estado actual: %).', public.appointment_status_label(a.status);
  end if;
  if a.response_deadline is not null and a.response_deadline < now() then
    raise exception 'El plazo para responder esta solicitud ya venció.';
  end if;

  if p_accept then
    update public.appointments set accepted_at = now(), response_deadline = null where id = a.id;
    perform public.set_appointment_status(a.id, 'confirmed', 'Aceptada por el profesional');
    perform public.notify_user(a.patient_id, 'appointment_accepted', '¡Tu cita fue confirmada!',
      format('El profesional aceptó tu cita %s para el %s.', a.code, public.fmt_bogota(a.starts_at)),
      '/paciente/citas/' || a.id);
    return jsonb_build_object('status', 'confirmed');
  end if;

  v_label := case p_reason
    when 'no_disponible' then 'No disponible'
    when 'desplazamiento' then 'Problema de desplazamiento'
    when 'conflicto_agenda' then 'Conflicto de agenda'
    when 'fuera_de_alcance' then 'Servicio fuera de su alcance profesional'
    when 'otro' then 'Otro motivo'
  end;
  if v_label is null then raise exception 'Selecciona un motivo de rechazo.'; end if;
  if p_reason = 'otro' and coalesce(trim(p_notes), '') = '' then
    raise exception 'Describe el motivo del rechazo.';
  end if;

  insert into public.appointment_rejections (appointment_id, professional_id, kind, reason, notes)
  values (a.id, v_uid, 'rejected', p_reason, p_notes);
  update public.appointments set rejection_reason = p_reason, rejection_notes = p_notes where id = a.id;
  perform public.set_appointment_status(a.id, 'rejected', v_label, jsonb_build_object('reason', p_reason, 'notes', p_notes));
  perform public.move_to_reassignment(a.id, 'El profesional rechazó la solicitud: ' || v_label);
  perform public.notify_admins('admin_appointment_rejected', 'Cita rechazada',
    format('La cita %s fue rechazada (%s).', a.code, v_label), '/admin/reservas');
  return jsonb_build_object('status', 'pending_reassignment');
end $$;

-- ---------------------------------------------------------------- alternativas y reasignación
create or replace function public.find_alternatives(p_appointment uuid)
returns table (professional_id uuid, full_name text, specialty text, rating_avg numeric,
               starts_at timestamptz, same_time boolean, total_amount numeric, price_difference numeric)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  a public.appointments;
  v_day date;
begin
  select * into a from public.appointments ap where ap.id = p_appointment;
  if a.id is null or not (a.patient_id = auth.uid() or public.is_admin()) then
    raise exception 'Cita no encontrada.';
  end if;
  v_day := (a.starts_at at time zone 'America/Bogota')::date;
  return query
  select p.user_id, u.full_name, s.name, p.rating_avg, slot.starts_at,
         slot.starts_at = a.starts_at,
         (public.compute_quote(p.user_id, a.care_type, slot.starts_at, a.duration_min, a.service_area_id, a.promo_code::text) ->> 'total_amount')::numeric,
         (public.compute_quote(p.user_id, a.care_type, slot.starts_at, a.duration_min, a.service_area_id, a.promo_code::text) ->> 'total_amount')::numeric
           - (a.amount_paid - a.amount_refunded)
  from public.professional_profiles p
  join public.users u on u.id = p.user_id and u.status = 'active'
  join public.specialties s on s.id = p.specialty_id
  cross join lateral (
    select g.starts_at from public.get_available_slots(p.user_id, greatest(v_day, (now() at time zone 'America/Bogota')::date), v_day + 3,
                                                       a.care_type, a.duration_min, a.id) g
    order by abs(extract(epoch from g.starts_at - a.starts_at)) limit 1
  ) slot
  where p.status = 'approved'
    and p.category_id = a.category_id
    and p.user_id <> a.professional_id
    and not exists (select 1 from public.appointment_rejections r where r.appointment_id = a.id and r.professional_id = p.user_id)
    and public.professional_covers_area(p.user_id, a.service_area_id)
  order by (slot.starts_at = a.starts_at) desc, (p.specialty_id = a.specialty_id) desc, slot.starts_at, p.rating_avg desc
  limit 10;
end $$;

-- Aplica un nuevo profesional/horario a una cita pagada (reasignación o reprogramación).
create or replace function public.reassign_internal(
  p_appointment uuid, p_professional uuid, p_starts_at timestamptz, p_accept_new_price boolean,
  p_to_status public.appointment_status, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.appointments;
  pr public.professional_profiles;
  q jsonb;
  v_paid numeric;
  v_new numeric;
  v_refund uuid;
begin
  select * into a from public.appointments where id = p_appointment for update;
  select * into pr from public.professional_profiles where user_id = p_professional and status = 'approved';
  if pr.user_id is null then raise exception 'El profesional seleccionado no está disponible.'; end if;
  if pr.category_id <> a.category_id then raise exception 'El profesional no presta este servicio.'; end if;
  if exists (select 1 from public.appointment_rejections r where r.appointment_id = a.id and r.professional_id = p_professional)
     and p_professional <> a.professional_id then
    raise exception 'Este profesional ya rechazó la solicitud.';
  end if;
  if not public.professional_covers_area(p_professional, a.service_area_id) then
    raise exception 'El profesional no cubre la zona de la dirección.';
  end if;
  if not public.slot_is_available(p_professional, p_starts_at, a.duration_min, a.care_type, a.id) then
    raise exception 'El horario ya no está disponible.' using errcode = 'MC004';
  end if;

  q := public.compute_quote(p_professional, a.care_type, p_starts_at, a.duration_min, a.service_area_id, a.promo_code::text);
  v_paid := a.amount_paid - a.amount_refunded;
  v_new := (q ->> 'total_amount')::numeric;
  if v_new > v_paid then
    raise exception 'Esta opción cuesta % más que lo pagado. El cobro de diferencias aún no está habilitado: elige otra opción o solicita la devolución.',
      public.fmt_cop(v_new - v_paid) using errcode = 'MC005';
  end if;
  if v_new <> (a.total_amount) and not coalesce(p_accept_new_price, false) then
    raise exception 'El valor cambia de % a %. Debes aceptar expresamente el nuevo valor.',
      public.fmt_cop(a.total_amount), public.fmt_cop(v_new) using errcode = 'MC006';
  end if;

  perform set_config('app.status_reason', p_reason, true);
  perform set_config('app.status_meta', jsonb_build_object('from_professional', a.professional_id, 'to_professional', p_professional,
    'from_start', a.starts_at, 'to_start', p_starts_at, 'old_total', a.total_amount, 'new_total', v_new)::text, true);
  begin
    update public.appointments set
      professional_id = p_professional,
      starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => a.duration_min),
      travel_buffer_min = pr.travel_buffer_min,
      specialty_id = pr.specialty_id,
      hourly_rate = (q ->> 'hourly_rate')::numeric, base_amount = (q ->> 'base_amount')::numeric,
      surcharges_amount = (q ->> 'surcharges_amount')::numeric, travel_fee = (q ->> 'travel_fee')::numeric,
      service_fee = (q ->> 'service_fee')::numeric, discount_amount = (q ->> 'discount_amount')::numeric,
      total_amount = v_new, price_breakdown = q,
      commission_percent = (q ->> 'commission_percent')::numeric, commission_base_rule = q ->> 'commission_base_rule',
      commission_base_amount = (q ->> 'commission_base_amount')::numeric, commission_amount = (q ->> 'commission_amount')::numeric,
      professional_net_amount = (q ->> 'professional_net_amount')::numeric,
      reassignment_count = reassignment_count + case when p_professional <> a.professional_id then 1 else 0 end,
      reassignment_deadline = null, accepted_at = null,
      response_deadline = now() + make_interval(mins => public.response_timeout_min(a.care_type)),
      status = p_to_status
    where id = a.id;
  exception when exclusion_violation then
    raise exception 'El horario acaba de ser ocupado. Elige otra opción.' using errcode = 'MC004';
  end;
  perform set_config('app.status_reason', '', true);
  perform set_config('app.status_meta', '', true);

  if v_new < v_paid then
    v_refund := public.create_refund_internal(a.id, v_paid - v_new, 'Diferencia de valor por cambio de profesional u horario');
    update public.appointments set payment_state = 'refund_pending' where id = a.id;
  end if;

  perform public.notify_user(p_professional, 'new_appointment_request', 'Nueva solicitud de cita',
    format('Tienes una nueva solicitud (%s) para el %s. Responde antes de %s.', a.code, public.fmt_bogota(p_starts_at),
      public.fmt_bogota(now() + make_interval(mins => public.response_timeout_min(a.care_type)))), '/profesional');
  return jsonb_build_object('status', p_to_status, 'total_amount', v_new, 'refund_id', v_refund);
end $$;

create or replace function public.accept_alternative(
  p_appointment uuid, p_professional uuid, p_starts_at timestamptz, p_accept_new_price boolean default false
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment and patient_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if a.status <> 'pending_reassignment' then raise exception 'Esta cita no está pendiente de reasignación.'; end if;
  if a.payment_state not in ('paid', 'refund_pending') then raise exception 'La cita no tiene un pago aprobado.'; end if;
  return public.reassign_internal(a.id, p_professional, p_starts_at, p_accept_new_price, 'professional_assigned',
    'Reasignación aprobada por el paciente');
end $$;

create or replace function public.admin_reassign_appointment(
  p_appointment uuid, p_professional uuid, p_starts_at timestamptz, p_patient_consent_note text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.appointments;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_patient_consent_note), '') = '' then
    raise exception 'Registra cómo obtuviste la aprobación del paciente.';
  end if;
  select * into a from public.appointments where id = p_appointment for update;
  if a.status <> 'pending_reassignment' then raise exception 'Solo se reasignan citas pendientes de reasignación.'; end if;
  return public.reassign_internal(a.id, p_professional, p_starts_at, true, 'professional_assigned',
    'Reasignación administrativa. Aprobación del paciente: ' || p_patient_consent_note);
end $$;

create or replace function public.request_refund_instead(p_appointment uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment and patient_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if a.status <> 'pending_reassignment' then raise exception 'Esta cita no está pendiente de reasignación.'; end if;
  perform public.set_appointment_status(a.id, 'refund_pending', 'El paciente solicitó la devolución');
  perform public.create_refund_internal(a.id, a.amount_paid - a.amount_refunded
    - coalesce((select sum(amount) from public.refunds where appointment_id = a.id and status in ('pending', 'processing')), 0),
    'Devolución solicitada por el paciente tras rechazo/vencimiento');
  return jsonb_build_object('status', 'refund_pending');
end $$;

-- ---------------------------------------------------------------- cancelación y reprogramación
create or replace function public.cancel_appointment(p_appointment uuid, p_reason text, p_admin_refund_percent numeric default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
  a public.appointments;
  v_hours numeric;
  v_pct numeric := 100;
  v_avail numeric;
  v_refund numeric;
  v_retained numeric;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.id is null or not (v_admin or a.patient_id = v_uid) then raise exception 'Cita no encontrada.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la cancelación.'; end if;

  if a.status = 'payment_processing' then
    raise exception 'Tu pago está en procesamiento. Espera la respuesta de la entidad antes de cancelar.';
  end if;
  if a.status not in ('pending_payment', 'pending_acceptance', 'professional_assigned', 'pending_reassignment', 'confirmed') then
    raise exception 'La cita no puede cancelarse en su estado actual (%). Contacta a soporte.', public.appointment_status_label(a.status);
  end if;

  if a.status = 'confirmed' then
    v_hours := extract(epoch from (a.starts_at - now())) / 3600.0;
    if v_hours < public.setting_int('free_cancellation_hours', 24) then
      v_pct := public.setting_int('late_cancellation_refund_percent', 50);
    end if;
  end if;
  if v_admin and p_admin_refund_percent is not null then
    v_pct := greatest(0, least(100, p_admin_refund_percent));
  end if;

  update public.appointments set cancellation_reason = p_reason, cancelled_by = v_uid where id = a.id;
  perform public.set_appointment_status(a.id, 'cancelled', p_reason, jsonb_build_object('refund_percent', v_pct));

  if a.payment_state in ('paid', 'refund_pending', 'partially_refunded') then
    v_avail := a.amount_paid - a.amount_refunded
      - coalesce((select sum(amount) from public.refunds where appointment_id = a.id and status in ('pending', 'processing')), 0);
    v_refund := round(v_avail * v_pct / 100.0);
    v_retained := v_avail - v_refund;
    if v_retained > 0 then
      perform public.post_ledger('Penalidad por cancelación tardía ' || a.code, jsonb_build_array(
        public.ledger_line('customer_funds_held', 'debit', v_retained),
        public.ledger_line('platform_cancellation_revenue', 'credit', v_retained)), a.id);
    end if;
    if v_refund > 0 then
      perform public.set_appointment_status(a.id, 'refund_pending', 'Devolución por cancelación');
      perform public.create_refund_internal(a.id, v_refund, 'Cancelación: ' || p_reason);
    end if;
  end if;

  if a.status in ('confirmed', 'pending_acceptance', 'professional_assigned') then
    perform public.notify_user(a.professional_id, 'appointment_cancelled', 'Cita cancelada',
      format('La cita %s del %s fue cancelada.', a.code, public.fmt_bogota(a.starts_at)), '/profesional/citas');
  end if;
  perform public.notify_user(a.patient_id, 'appointment_cancelled', 'Cita cancelada',
    format('Tu cita %s fue cancelada.%s', a.code,
      case when v_refund > 0 then ' Devolución en trámite: ' || public.fmt_cop(v_refund) || '.' else '' end),
    '/paciente/citas/' || a.id);
  return jsonb_build_object('status', 'cancelled', 'refund_amount', coalesce(v_refund, 0), 'refund_percent', v_pct);
end $$;

create or replace function public.reschedule_appointment(p_appointment uuid, p_starts_at timestamptz, p_accept_new_price boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment and patient_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if a.status not in ('pending_acceptance', 'confirmed') then
    raise exception 'Solo puedes reprogramar citas pendientes de aceptación o confirmadas.';
  end if;
  if extract(epoch from (a.starts_at - now())) / 3600.0 < public.setting_int('free_cancellation_hours', 24) then
    raise exception 'Solo puedes reprogramar con al menos % horas de anticipación.', public.setting_int('free_cancellation_hours', 24);
  end if;
  -- La nueva hora requiere nuevamente la aceptación del profesional.
  return public.reassign_internal(a.id, a.professional_id, p_starts_at, p_accept_new_price, 'pending_acceptance',
    'Reprogramada por el paciente');
end $$;

-- ---------------------------------------------------------------- prestación del servicio
create or replace function public.post_completion_ledger(p_appointment uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.completion_ledger_at is not null or a.amount_paid = 0 then return; end if;
  perform public.post_ledger('Servicio prestado ' || a.code, jsonb_build_array(
    public.ledger_line('customer_funds_held', 'debit', a.total_amount),
    public.ledger_line('promotional_discount_expense', 'debit', a.discount_amount),
    public.ledger_line('professional_payable', 'credit', a.professional_net_amount),
    public.ledger_line('platform_commission_revenue', 'credit', a.commission_amount),
    public.ledger_line('platform_service_fee_revenue', 'credit', a.service_fee)), a.id);
  update public.appointments set completion_ledger_at = now() where id = a.id;
end $$;

create or replace function public.reverse_completion_ledger(p_appointment uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.completion_ledger_at is null then return; end if;
  if exists (select 1 from public.payout_items i join public.professional_payouts po on po.id = i.payout_id
             where i.appointment_id = a.id and po.status in ('approved', 'paid')) then
    raise exception 'La cita ya está en una liquidación aprobada o pagada. Cancela la liquidación o registra un ajuste.';
  end if;
  delete from public.payout_items i using public.professional_payouts po
   where i.appointment_id = a.id and po.id = i.payout_id and po.status = 'pending';
  perform public.post_ledger('Reverso servicio ' || a.code, jsonb_build_array(
    public.ledger_line('customer_funds_held', 'credit', a.total_amount),
    public.ledger_line('promotional_discount_expense', 'credit', a.discount_amount),
    public.ledger_line('professional_payable', 'debit', a.professional_net_amount),
    public.ledger_line('platform_commission_revenue', 'debit', a.commission_amount),
    public.ledger_line('platform_service_fee_revenue', 'debit', a.service_fee)), a.id);
  update public.appointments set completion_ledger_at = null where id = a.id;
end $$;

create or replace function public.update_service_progress(p_appointment uuid, p_to public.appointment_status)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('professional');
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment and professional_id = v_uid for update;
  if a.id is null then raise exception 'Cita no encontrada.'; end if;
  if not ((a.status, p_to) in (('confirmed'::public.appointment_status, 'en_route'::public.appointment_status),
                               ('en_route', 'arrived'), ('arrived', 'in_progress'), ('in_progress', 'completed'))) then
    raise exception 'Cambio de estado no permitido desde %.', public.appointment_status_label(a.status);
  end if;
  if p_to = 'en_route' and a.starts_at - now() > interval '3 hours' then
    raise exception 'Podrás marcar "En camino" desde 3 horas antes de la cita.';
  end if;
  if p_to = 'completed' and now() < a.starts_at then
    raise exception 'No puedes completar una atención antes de su hora de inicio.';
  end if;

  perform public.set_appointment_status(a.id, p_to, 'Actualizado por el profesional');
  if p_to = 'en_route' then
    perform public.notify_user(a.patient_id, 'professional_en_route', 'Tu profesional va en camino',
      format('El profesional de tu cita %s ya va en camino.', a.code), '/paciente/citas/' || a.id);
  elsif p_to = 'arrived' then
    perform public.notify_user(a.patient_id, 'professional_arrived', 'Tu profesional llegó',
      format('El profesional de tu cita %s indicó que llegó a la dirección.', a.code), '/paciente/citas/' || a.id, '{}', 'arrived:' || a.id);
  elsif p_to = 'completed' then
    update public.appointments set completed_at = now() where id = a.id;
    perform public.post_completion_ledger(a.id);
    perform public.notify_user(a.patient_id, 'appointment_completed', 'Servicio completado',
      format('Tu cita %s fue marcada como completada. Confírmala y califica la atención.', a.code), '/paciente/citas/' || a.id);
  end if;
  return jsonb_build_object('status', p_to);
end $$;

create or replace function public.patient_confirm_completion(p_appointment uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := public.require_role('patient');
begin
  update public.appointments set patient_confirmed_at = now()
   where id = p_appointment and patient_id = v_uid and status = 'completed' and patient_confirmed_at is null;
  if not found then raise exception 'No se puede confirmar esta cita.'; end if;
end $$;

create or replace function public.open_dispute(p_appointment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.id is null or not (a.patient_id = v_uid or a.professional_id = v_uid or public.is_admin()) then
    raise exception 'Cita no encontrada.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Describe el motivo de la disputa.'; end if;
  if a.status not in ('confirmed', 'en_route', 'arrived', 'in_progress', 'completed') then
    raise exception 'No se puede abrir una disputa en el estado actual.';
  end if;
  if exists (select 1 from public.payout_items i join public.professional_payouts po on po.id = i.payout_id
             where i.appointment_id = a.id and po.status = 'paid') then
    raise exception 'Esta cita ya fue liquidada. Contacta a soporte para revisar el caso.';
  end if;
  update public.appointments set dispute_reason = p_reason, dispute_opened_at = now() where id = a.id;
  perform public.set_appointment_status(a.id, 'disputed', p_reason);
  perform public.notify_admins('admin_dispute', 'Nueva disputa', format('Cita %s: %s', a.code, p_reason), '/admin/reservas');
end $$;

create or replace function public.admin_resolve_dispute(p_appointment uuid, p_resolution text, p_notes text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.appointments;
begin
  perform public.require_role('admin');
  select * into a from public.appointments where id = p_appointment for update;
  if a.status <> 'disputed' then raise exception 'La cita no está en disputa.'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Registra la justificación de la decisión.'; end if;
  if p_resolution = 'complete' then
    update public.appointments set completed_at = coalesce(completed_at, now()), admin_verified_at = now(),
           admin_verified_by = auth.uid() where id = a.id;
    perform public.set_appointment_status(a.id, 'completed', 'Disputa resuelta a favor del servicio: ' || p_notes);
    perform public.post_completion_ledger(a.id);
  elsif p_resolution = 'refund' then
    perform public.reverse_completion_ledger(a.id);
    perform public.set_appointment_status(a.id, 'refund_pending', 'Disputa resuelta con devolución: ' || p_notes);
    perform public.create_refund_internal(a.id, a.amount_paid - a.amount_refunded
      - coalesce((select sum(amount) from public.refunds where appointment_id = a.id and status in ('pending', 'processing')), 0),
      'Disputa: ' || p_notes);
  else
    raise exception 'Resolución inválida.';
  end if;
end $$;

create or replace function public.admin_verify_appointment(p_appointment uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_role('admin');
  update public.appointments set admin_verified_at = now(), admin_verified_by = auth.uid()
   where id = p_appointment and status = 'completed';
  if not found then raise exception 'Solo se verifican citas completadas.'; end if;
  perform public.audit('verify_service', 'appointments', p_appointment::text);
end $$;

create or replace function public.submit_review(p_appointment uuid, p_rating int, p_comment text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment and patient_id = v_uid;
  if a.id is null or a.status <> 'completed' then raise exception 'Solo puedes calificar citas completadas.'; end if;
  insert into public.reviews (appointment_id, patient_id, professional_id, rating, comment)
  values (a.id, v_uid, a.professional_id, p_rating, nullif(trim(p_comment), ''));
  perform set_config('app.trusted', 'on', true);
  update public.professional_profiles p set
    rating_avg = (select round(avg(rating)::numeric, 2) from public.reviews where professional_id = a.professional_id and is_visible),
    rating_count = (select count(*) from public.reviews where professional_id = a.professional_id and is_visible)
  where p.user_id = a.professional_id;
  perform set_config('app.trusted', '', true);
exception when unique_violation then
  raise exception 'Ya calificaste esta cita.';
end $$;

-- ---------------------------------------------------------------- vista del profesional (minimiza datos)
-- El profesional solo ve nombre, teléfono y dirección exacta del paciente cuando la
-- cita está confirmada y en curso. Antes de aceptar solo ve barrio/zona y motivo breve.
create or replace function public.professional_appointments(p_scope text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_uid uuid := public.require_role('professional');
begin
  return coalesce((
    select jsonb_agg(row order by
      case when p_scope = 'history' then null else (row ->> 'starts_at') end asc,
      case when p_scope = 'history' then (row ->> 'starts_at') end desc)
    from (
      select jsonb_build_object(
        'id', a.id, 'code', a.code, 'status', a.status, 'status_label', public.appointment_status_label(a.status),
        'care_type', a.care_type, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'duration_min', a.duration_min,
        'response_deadline', a.response_deadline, 'specialty', s.name,
        'area_name', a.address_snapshot ->> 'area_name', 'neighborhood', a.address_snapshot ->> 'neighborhood',
        'patient_notes', case when a.status in ('pending_acceptance', 'professional_assigned', 'confirmed', 'en_route', 'arrived', 'in_progress') then a.patient_notes end,
        'patient_name', case when a.status in ('confirmed', 'en_route', 'arrived', 'in_progress', 'completed') then u.full_name end,
        'patient_phone', case when a.status in ('confirmed', 'en_route', 'arrived', 'in_progress') then u.phone end,
        'address', case when a.status in ('confirmed', 'en_route', 'arrived', 'in_progress') then a.address_snapshot end,
        'professional_net_amount', a.professional_net_amount, 'commission_amount', a.commission_amount,
        'gross_amount', a.base_amount + a.surcharges_amount + a.travel_fee
      ) as row
      from public.appointments a
      join public.users u on u.id = a.patient_id
      join public.specialties s on s.id = a.specialty_id
      where a.professional_id = v_uid and (
        (p_scope = 'pending' and a.status in ('pending_acceptance', 'professional_assigned')) or
        (p_scope = 'upcoming' and a.status in ('confirmed', 'en_route', 'arrived', 'in_progress')) or
        (p_scope = 'history' and a.status in ('completed', 'cancelled', 'refunded', 'refund_pending', 'disputed')
           and a.original_professional_id is not null)
      )
      limit 200
    ) t
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- procesos automáticos
-- Ejecutado cada minuto por pg_cron (o por /api/cron/jobs con CRON_SECRET).
create or replace function public.run_scheduled_jobs()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_expired_holds int := 0; v_expired_resp int := 0; v_auto_refunds int := 0;
  v_memb_expired int := 0; v_reminders int := 0;
begin
  -- 1) Reservas temporales sin pago vencidas → Expirada (libera el horario)
  for r in select id from public.appointments
           where status = 'pending_payment' and hold_expires_at < now()
           for update skip locked loop
    perform public.set_appointment_status(r.id, 'expired', 'Venció el tiempo para pagar');
    v_expired_holds := v_expired_holds + 1;
  end loop;
  -- Pagos en procesamiento muy demorados (p. ej. PSE): liberar el horario tras margen extra.
  for r in select id from public.appointments
           where status = 'payment_processing' and hold_expires_at < now() - make_interval(mins => public.setting_int('processing_grace_min', 60))
           for update skip locked loop
    perform public.set_appointment_status(r.id, 'expired', 'El pago no se confirmó a tiempo; si se aprueba después, podrás elegir alternativa o devolución');
    v_expired_holds := v_expired_holds + 1;
  end loop;

  -- 2) Solicitudes sin respuesta del profesional → Expirada → Pendiente de reasignación
  for r in select id, professional_id from public.appointments
           where status in ('pending_acceptance', 'professional_assigned') and response_deadline < now()
           for update skip locked loop
    insert into public.appointment_rejections (appointment_id, professional_id, kind, reason)
    values (r.id, r.professional_id, 'expired', 'Sin respuesta dentro del plazo');
    perform public.set_appointment_status(r.id, 'expired', 'El profesional no respondió a tiempo');
    perform public.move_to_reassignment(r.id, 'El profesional no respondió a tiempo');
    perform public.notify_user(r.professional_id, 'request_expired', 'Solicitud expirada',
      'Una solicitud de cita expiró porque no fue respondida a tiempo.', '/profesional');
    v_expired_resp := v_expired_resp + 1;
  end loop;

  -- 3) Paciente no decidió la reasignación a tiempo → devolución completa
  for r in select id, amount_paid, amount_refunded from public.appointments
           where status = 'pending_reassignment' and reassignment_deadline < now()
           for update skip locked loop
    perform public.set_appointment_status(r.id, 'refund_pending', 'Sin decisión de reasignación: devolución automática');
    perform public.create_refund_internal(r.id, r.amount_paid - r.amount_refunded
      - coalesce((select sum(amount) from public.refunds where appointment_id = r.id and status in ('pending', 'processing')), 0),
      'Devolución automática: no se eligió alternativa');
    v_auto_refunds := v_auto_refunds + 1;
  end loop;

  -- 4) Membresías
  for r in select id, patient_id from public.patient_memberships where status = 'active' and ends_at <= now() for update skip locked loop
    update public.patient_memberships set status = 'expired' where id = r.id;
    perform public.notify_user(r.patient_id, 'membership_expired', 'Tu membresía venció',
      'Tu membresía venció. Renuévala para seguir agendando citas.', '/membresias', '{}', 'memb_expired:' || r.id);
    v_memb_expired := v_memb_expired + 1;
  end loop;
  for r in select m.id, m.patient_id, m.ends_at from public.patient_memberships m
           where m.status = 'active' and m.ends_at between now() and now() + interval '3 days'
             and not exists (select 1 from public.patient_memberships n where n.patient_id = m.patient_id
                             and n.status = 'active' and n.starts_at >= m.ends_at) loop
    perform public.notify_user(r.patient_id, 'membership_expiring', 'Tu membresía está por vencer',
      format('Tu membresía vence el %s.', public.fmt_bogota(r.ends_at)), '/membresias', '{}', 'memb_expiring:' || r.id);
  end loop;

  -- 5) Recordatorios de citas confirmadas (24 h y 2 h antes)
  for r in select a.id, a.patient_id, a.professional_id, a.code, a.starts_at from public.appointments a
           where a.status = 'confirmed' and a.starts_at between now() and now() + interval '24 hours' loop
    perform public.notify_user(r.patient_id, 'appointment_reminder', 'Recordatorio de tu cita',
      format('Tu cita %s es el %s.', r.code, public.fmt_bogota(r.starts_at)), '/paciente/citas/' || r.id, '{}', 'rem24p:' || r.id);
    perform public.notify_user(r.professional_id, 'appointment_reminder', 'Recordatorio de cita',
      format('Tienes la cita %s el %s.', r.code, public.fmt_bogota(r.starts_at)), '/profesional/citas', '{}', 'rem24r:' || r.id);
    if r.starts_at < now() + interval '2 hours' then
      perform public.notify_user(r.patient_id, 'appointment_reminder', 'Tu cita es pronto',
        format('Tu cita %s es hoy a las %s.', r.code, to_char(r.starts_at at time zone 'America/Bogota', 'HH24:MI')),
        '/paciente/citas/' || r.id, '{}', 'rem2p:' || r.id);
    end if;
    v_reminders := v_reminders + 1;
  end loop;

  return jsonb_build_object('expired_holds', v_expired_holds, 'expired_responses', v_expired_resp,
    'auto_refunds', v_auto_refunds, 'memberships_expired', v_memb_expired, 'reminders_checked', v_reminders, 'ran_at', now());
end $$;
