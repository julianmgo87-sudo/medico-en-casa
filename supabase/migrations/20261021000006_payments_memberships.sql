-- =============================================================================
-- Médico en Casa Palmira — 0006: pagos (Wompi), membresías y reembolsos
-- apply_payment_result SOLO se invoca desde el servidor con la service_role
-- después de verificar la firma del webhook o consultar la transacción en Wompi.
-- =============================================================================

create or replace function public.activate_membership_internal(p_membership uuid, p_price numeric)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.patient_memberships;
  pl public.membership_plans;
  v_start timestamptz;
begin
  select * into m from public.patient_memberships where id = p_membership for update;
  select * into pl from public.membership_plans where id = m.plan_id;
  -- Si ya tiene una membresía activa, la nueva empieza al terminar la vigente (renovación).
  select greatest(now(), coalesce(max(ends_at), now())) into v_start from public.patient_memberships
   where patient_id = m.patient_id and status = 'active' and id <> m.id;
  update public.patient_memberships
     set status = 'active', starts_at = v_start, ends_at = v_start + make_interval(days => pl.duration_days), price_paid = p_price
   where id = m.id;
  perform public.notify_user(m.patient_id, 'membership_activated', 'Membresía activada',
    format('Tu membresía %s está activa hasta el %s.', pl.name, public.fmt_bogota(v_start + make_interval(days => pl.duration_days))),
    '/paciente', '{}', 'memb_active:' || m.id);
end $$;

create or replace function public.create_membership_checkout(p_plan uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.require_role('patient');
  pl public.membership_plans;
  v_m uuid;
  v_ref text;
begin
  select * into pl from public.membership_plans where id = p_plan and is_active;
  if pl.id is null then raise exception 'Plan no disponible.'; end if;
  -- Cancela intentos previos sin pagar
  update public.patient_memberships m set status = 'cancelled', cancelled_at = now()
   where m.patient_id = v_uid and m.status = 'pending_payment'
     and not exists (select 1 from public.payments p where p.membership_id = m.id and p.status in ('processing', 'approved'));

  insert into public.patient_memberships (patient_id, plan_id, status, source, created_by)
  values (v_uid, pl.id, 'pending_payment', case when pl.price = 0 then 'promotion' else 'purchase' end, v_uid)
  returning id into v_m;

  if pl.price = 0 then
    -- Plan gratuito/promocional configurado por el administrador: no hay cobro que simular.
    if exists (select 1 from public.patient_memberships where patient_id = v_uid and source = 'promotion'
               and plan_id = pl.id and status in ('active', 'expired') and id <> v_m) then
      raise exception 'Ya usaste este plan promocional.';
    end if;
    perform public.activate_membership_internal(v_m, 0);
    return jsonb_build_object('membership_id', v_m, 'free', true);
  end if;

  v_ref := 'MEMB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.payments (reference, purpose, patient_id, membership_id, amount)
  values (v_ref, 'membership', v_uid, v_m, pl.price);
  return jsonb_build_object('membership_id', v_m, 'free', false, 'reference', v_ref, 'amount', pl.price,
    'amount_in_cents', (pl.price * 100)::bigint, 'currency', 'COP');
end $$;

create or replace function public.admin_grant_membership(p_patient uuid, p_days int, p_notes text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_start timestamptz;
begin
  perform public.require_role('admin');
  if p_days is null or p_days <= 0 or p_days > 3660 then raise exception 'Número de días inválido.'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Indica el motivo de la exención.'; end if;
  select greatest(now(), coalesce(max(ends_at), now())) into v_start from public.patient_memberships
   where patient_id = p_patient and status = 'active';
  insert into public.patient_memberships (patient_id, status, source, starts_at, ends_at, notes, created_by)
  values (p_patient, 'active', 'admin_grant', v_start, v_start + make_interval(days => p_days), p_notes, auth.uid())
  returning id into v_id;
  perform public.notify_user(p_patient, 'membership_activated', 'Membresía activada',
    format('Se activó una membresía de cortesía por %s días.', p_days), '/paciente');
  return v_id;
end $$;

-- ---------------------------------------------------------------- resultado de pago
create or replace function public.apply_payment_result(
  p_reference text, p_provider_tx_id text, p_status text, p_amount_in_cents bigint,
  p_currency text default 'COP', p_method text default null, p_message text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  p public.payments;
  a public.appointments;
  v_ok boolean;
begin
  select * into p from public.payments where reference = p_reference for update;
  if p.id is null then
    return jsonb_build_object('result', 'unknown_reference');
  end if;
  if p.provider_transaction_id is not null and p_provider_tx_id is not null and p.provider_transaction_id <> p_provider_tx_id then
    -- Wompi genera un id por intento; una referencia nuestra corresponde a un solo intento.
    if p.status = 'approved' then return jsonb_build_object('result', 'already_approved_other_tx'); end if;
  end if;
  if p.status in ('approved', 'declined', 'voided', 'error') then
    return jsonb_build_object('result', 'already_final', 'status', p.status);
  end if;

  if p_status = 'APPROVED' and (p_amount_in_cents <> (p.amount * 100)::bigint or coalesce(p_currency, '') <> 'COP') then
    update public.payments set status = 'error', provider_transaction_id = coalesce(p_provider_tx_id, provider_transaction_id),
      provider_status_message = format('Monto/moneda no coinciden: recibido %s %s, esperado %s COP', p_amount_in_cents, p_currency, (p.amount * 100)::bigint)
     where id = p.id;
    perform public.notify_admins('admin_payment_mismatch', 'Pago con monto inconsistente',
      format('Referencia %s: el monto aprobado no coincide. Requiere conciliación manual.', p.reference), '/admin/pagos');
    return jsonb_build_object('result', 'amount_mismatch');
  end if;

  if p_status = 'PENDING' then
    update public.payments set status = 'processing', provider_transaction_id = coalesce(p_provider_tx_id, provider_transaction_id),
      payment_method_type = coalesce(p_method, payment_method_type) where id = p.id;
    if p.purpose = 'appointment' then
      select * into a from public.appointments where id = p.appointment_id for update;
      if a.status = 'pending_payment' then
        update public.appointments set payment_state = 'processing' where id = a.id;
        perform public.set_appointment_status(a.id, 'payment_processing', 'Pago reportado en procesamiento por la pasarela');
      end if;
    end if;
    return jsonb_build_object('result', 'processing');
  end if;

  if p_status in ('DECLINED', 'VOIDED', 'ERROR') then
    update public.payments set status = lower(p_status)::public.payment_status,
      provider_transaction_id = coalesce(p_provider_tx_id, provider_transaction_id),
      payment_method_type = coalesce(p_method, payment_method_type), provider_status_message = p_message
     where id = p.id;
    if p.purpose = 'appointment' then
      select * into a from public.appointments where id = p.appointment_id for update;
      if a.status = 'payment_processing' then
        update public.appointments set payment_state = 'unpaid' where id = a.id;
        if a.hold_expires_at > now() then
          perform public.set_appointment_status(a.id, 'pending_payment', 'Pago rechazado; puede reintentar');
        else
          perform public.set_appointment_status(a.id, 'expired', 'Pago rechazado y reserva vencida');
        end if;
      end if;
    end if;
    perform public.notify_user(p.patient_id, 'payment_failed', 'Pago no aprobado',
      format('Tu pago %s no fue aprobado%s. No se realizó ningún cobro por esta transacción.', p.reference,
        coalesce(' (' || p_message || ')', '')), case when p.purpose = 'appointment' then '/paciente/citas/' || p.appointment_id else '/membresias' end);
    return jsonb_build_object('result', 'failed', 'status', lower(p_status));
  end if;

  if p_status <> 'APPROVED' then
    return jsonb_build_object('result', 'ignored_status', 'status', p_status);
  end if;

  -- ------------------------------------------------ APROBADO
  -- Doble pago del mismo concepto (p. ej. dos pestañas): no se aplica, requiere devolución manual.
  if exists (select 1 from public.payments o where o.id <> p.id and o.status = 'approved'
             and (o.appointment_id = p.appointment_id or o.membership_id = p.membership_id)) then
    update public.payments set status = 'error', provider_transaction_id = coalesce(p_provider_tx_id, provider_transaction_id),
      provider_status_message = 'PAGO DUPLICADO aprobado por la pasarela: requiere devolución manual al paciente'
     where id = p.id;
    perform public.notify_admins('admin_duplicate_payment', 'Pago duplicado',
      format('La referencia %s fue aprobada pero el concepto ya estaba pagado. Gestiona la devolución desde la pasarela.', p.reference), '/admin/pagos');
    return jsonb_build_object('result', 'duplicate');
  end if;

  update public.payments set status = 'approved', approved_at = now(),
    provider_transaction_id = coalesce(p_provider_tx_id, provider_transaction_id),
    payment_method_type = coalesce(p_method, payment_method_type), provider_status_message = p_message
   where id = p.id;

  if p.purpose = 'membership' then
    perform public.post_ledger('Pago membresía ' || p.reference, jsonb_build_array(
      public.ledger_line('cash_gateway', 'debit', p.amount),
      public.ledger_line('platform_membership_revenue', 'credit', p.amount)), null, p.id, null, null, p.membership_id);
    perform public.activate_membership_internal(p.membership_id, p.amount);
    perform public.notify_user(p.patient_id, 'payment_approved', 'Pago exitoso',
      format('Recibimos tu pago de %s (ref. %s).', public.fmt_cop(p.amount), p.reference), '/paciente/pagos');
    return jsonb_build_object('result', 'approved', 'purpose', 'membership');
  end if;

  -- Pago de cita: el dinero queda como fondos de clientes (pasivo), NO como ingreso.
  perform public.post_ledger('Pago consulta ' || p.reference, jsonb_build_array(
    public.ledger_line('cash_gateway', 'debit', p.amount),
    public.ledger_line('customer_funds_held', 'credit', p.amount)), p.appointment_id, p.id);

  select * into a from public.appointments where id = p.appointment_id for update;
  update public.appointments set amount_paid = p.amount, payment_state = 'paid', hold_expires_at = null where id = a.id;
  perform public.notify_user(p.patient_id, 'payment_approved', 'Pago exitoso',
    format('Recibimos tu pago de %s para la cita %s. Recuerda: el pago no garantiza la aceptación inmediata del profesional.',
      public.fmt_cop(p.amount), a.code), '/paciente/citas/' || a.id);

  if a.status in ('pending_payment', 'payment_processing') then
    v_ok := true;
  elsif a.status = 'expired' then
    -- Pago aprobado después de vencer la reserva: intentar recuperar el mismo horario.
    v_ok := public.slot_is_available(a.professional_id, a.starts_at, a.duration_min, a.care_type, a.id);
    if not v_ok then
      perform public.move_to_reassignment(a.id, 'El pago se aprobó después de que venció la reserva y el horario ya no está disponible');
      return jsonb_build_object('result', 'approved', 'purpose', 'appointment', 'status', 'pending_reassignment');
    end if;
  elsif a.status = 'cancelled' then
    perform public.set_appointment_status(a.id, 'refund_pending', 'Pago aprobado sobre una cita cancelada');
    perform public.create_refund_internal(a.id, p.amount, 'Pago recibido para una cita ya cancelada');
    return jsonb_build_object('result', 'approved', 'purpose', 'appointment', 'status', 'refund_pending');
  else
    perform public.notify_admins('admin_payment_review', 'Pago requiere revisión',
      format('Pago %s aprobado con la cita %s en estado %s.', p.reference, a.code, public.appointment_status_label(a.status)), '/admin/pagos');
    return jsonb_build_object('result', 'approved', 'purpose', 'appointment', 'status', a.status, 'needs_review', true);
  end if;

  begin
    update public.appointments
       set response_deadline = now() + make_interval(mins => public.response_timeout_min(a.care_type))
     where id = a.id;
    perform public.set_appointment_status(a.id, 'pending_acceptance', 'Pago aprobado por la pasarela');
  exception when exclusion_violation then
    perform public.move_to_reassignment(a.id, 'El horario dejó de estar disponible mientras se procesaba el pago');
    return jsonb_build_object('result', 'approved', 'purpose', 'appointment', 'status', 'pending_reassignment');
  end;

  perform public.notify_user(a.professional_id, 'new_appointment_request', 'Nueva solicitud de cita',
    format('Tienes una nueva solicitud (%s) para el %s. Responde antes de %s.', a.code, public.fmt_bogota(a.starts_at),
      public.fmt_bogota(now() + make_interval(mins => public.response_timeout_min(a.care_type)))), '/profesional');
  return jsonb_build_object('result', 'approved', 'purpose', 'appointment', 'status', 'pending_acceptance');
end $$;

-- ---------------------------------------------------------------- reembolsos (administrador)
create or replace function public.admin_complete_refund(p_refund uuid, p_method text, p_provider_reference text, p_notes text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  rf public.refunds;
  a public.appointments;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_provider_reference), '') = '' then
    raise exception 'Debes registrar el número de comprobante de la devolución.';
  end if;
  select * into rf from public.refunds where id = p_refund for update;
  if rf.status not in ('pending', 'processing') then raise exception 'El reembolso no está pendiente.'; end if;

  update public.refunds set status = 'completed', processed_by = auth.uid(), processed_at = now(),
    method = p_method, provider_reference = p_provider_reference, notes = p_notes where id = rf.id;
  perform public.post_ledger('Devolución realizada ' || p_provider_reference, jsonb_build_array(
    public.ledger_line('customer_funds_held', 'debit', rf.amount),
    public.ledger_line('cash_gateway', 'credit', rf.amount)), rf.appointment_id, rf.payment_id, rf.id);

  if rf.appointment_id is not null then
    select * into a from public.appointments where id = rf.appointment_id for update;
    update public.appointments set amount_refunded = amount_refunded + rf.amount,
      payment_state = case
        when amount_refunded + rf.amount >= amount_paid then 'refunded'
        when exists (select 1 from public.refunds where appointment_id = a.id and status in ('pending', 'processing')) then 'refund_pending'
        else 'partially_refunded' end::public.appointment_payment_state
     where id = a.id;
    if a.status = 'refund_pending' and not exists (
         select 1 from public.refunds where appointment_id = a.id and status in ('pending', 'processing')) then
      perform public.set_appointment_status(a.id, 'refunded', 'Devolución confirmada: ' || p_provider_reference);
    end if;
    perform public.notify_user(a.patient_id, 'refund_completed', 'Devolución realizada',
      format('Realizamos la devolución de %s (comprobante %s) de tu cita %s.', public.fmt_cop(rf.amount), p_provider_reference, a.code),
      '/paciente/citas/' || a.id);
  end if;
end $$;

create or replace function public.admin_set_refund_processing(p_refund uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_role('admin');
  update public.refunds set status = 'processing', notes = coalesce(p_notes, notes) where id = p_refund and status = 'pending';
  if not found then raise exception 'El reembolso no está pendiente.'; end if;
end $$;

-- Conciliación: registrar la comisión cobrada por la pasarela y marcar el pago conciliado.
create or replace function public.admin_reconcile_payment(p_payment uuid, p_provider_fee numeric)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare p public.payments;
begin
  perform public.require_role('admin');
  select * into p from public.payments where id = p_payment for update;
  if p.status <> 'approved' then raise exception 'Solo se concilian pagos aprobados.'; end if;
  if p.reconciled_at is not null then raise exception 'Este pago ya fue conciliado.'; end if;
  if p_provider_fee < 0 then raise exception 'Valor inválido.'; end if;
  update public.payments set provider_fee = p_provider_fee, reconciled_at = now(), reconciled_by = auth.uid() where id = p.id;
  if p_provider_fee > 0 then
    perform public.post_ledger('Comisión pasarela ' || p.reference, jsonb_build_array(
      public.ledger_line('gateway_fee_expense', 'debit', p_provider_fee),
      public.ledger_line('cash_gateway', 'credit', p_provider_fee)), p.appointment_id, p.id, null, null, p.membership_id);
  end if;
  perform public.audit('reconcile_payment', 'payments', p.id::text, jsonb_build_object('provider_fee', p_provider_fee));
end $$;
