-- =============================================================================
-- Médico en Casa Palmira — 0007: liquidaciones, reportes y operaciones administrativas
-- =============================================================================

-- ---------------------------------------------------------------- liquidaciones
-- Agrupa citas completadas, pagadas, sin disputa y aún no liquidadas.
create or replace function public.generate_payouts(p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_payout uuid;
  v_count int := 0;
begin
  perform public.require_role('admin');
  if p_period_end < p_period_start then raise exception 'Periodo inválido.'; end if;
  for r in
    select a.professional_id, count(*) n,
           sum(a.base_amount + a.surcharges_amount + a.travel_fee) gross,
           sum(a.commission_amount) comm, sum(a.professional_net_amount) net
    from public.appointments a
    where a.status = 'completed' and a.completion_ledger_at is not null
      and a.payment_state in ('paid', 'partially_refunded')
      and (a.completed_at at time zone 'America/Bogota')::date between p_period_start and p_period_end
      and not exists (select 1 from public.payout_items i where i.appointment_id = a.id)
    group by a.professional_id
  loop
    insert into public.professional_payouts (professional_id, period_start, period_end, gross_amount, commission_amount,
      net_amount, items_count, payout_account_snapshot, created_by)
    values (r.professional_id, p_period_start, p_period_end, r.gross, r.comm, r.net, r.n,
      (select jsonb_build_object('method', method, 'bank_name', bank_name, 'account_type', account_type,
              'account_last4', right(account_number, 4), 'phone_last4', right(phone_number, 4), 'holder_name', holder_name)
         from public.professional_payout_accounts where professional_id = r.professional_id),
      auth.uid())
    returning id into v_payout;
    insert into public.payout_items (payout_id, appointment_id, gross_amount, commission_amount, net_amount)
    select v_payout, a.id, a.base_amount + a.surcharges_amount + a.travel_fee, a.commission_amount, a.professional_net_amount
    from public.appointments a
    where a.professional_id = r.professional_id and a.status = 'completed' and a.completion_ledger_at is not null
      and a.payment_state in ('paid', 'partially_refunded')
      and (a.completed_at at time zone 'America/Bogota')::date between p_period_start and p_period_end
      and not exists (select 1 from public.payout_items i where i.appointment_id = a.id);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('payouts_created', v_count);
end $$;

create or replace function public.recalc_payout(p_payout uuid)
returns void language sql security definer set search_path = public, extensions as $$
  update public.professional_payouts po set
    gross_amount = coalesce((select sum(gross_amount) from public.payout_items where payout_id = po.id), 0),
    commission_amount = coalesce((select sum(commission_amount) from public.payout_items where payout_id = po.id), 0),
    items_count = (select count(*) from public.payout_items where payout_id = po.id),
    net_amount = greatest(0, coalesce((select sum(net_amount) from public.payout_items where payout_id = po.id), 0) + po.adjustments_amount)
  where po.id = p_payout;
$$;

create or replace function public.admin_set_payout_adjustment(p_payout uuid, p_amount numeric, p_notes text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_role('admin');
  if coalesce(trim(p_notes), '') = '' then raise exception 'Describe el motivo del ajuste.'; end if;
  update public.professional_payouts set adjustments_amount = p_amount, adjustments_notes = p_notes
   where id = p_payout and status = 'pending';
  if not found then raise exception 'Solo se ajustan liquidaciones pendientes.'; end if;
  perform public.recalc_payout(p_payout);
end $$;

create or replace function public.approve_payout(p_payout uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  po public.professional_payouts;
  v_bad int;
begin
  perform public.require_role('admin');
  select * into po from public.professional_payouts where id = p_payout for update;
  if po.status <> 'pending' then raise exception 'La liquidación no está pendiente.'; end if;
  if po.items_count = 0 then raise exception 'La liquidación no tiene servicios.'; end if;
  select count(*) into v_bad from public.payout_items i join public.appointments a on a.id = i.appointment_id
   where i.payout_id = po.id and (a.status <> 'completed' or a.payment_state not in ('paid', 'partially_refunded')
         or (a.patient_confirmed_at is null and a.admin_verified_at is null));
  if v_bad > 0 then
    raise exception 'Hay % servicio(s) sin verificar o con estado no liquidable. Verifícalos antes de aprobar.', v_bad;
  end if;
  if not exists (select 1 from public.professional_payout_accounts where professional_id = po.professional_id and verified_at is not null) then
    raise exception 'El profesional no tiene una cuenta de pago verificada.';
  end if;
  update public.professional_payouts set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    payout_account_snapshot = (select jsonb_build_object('method', method, 'bank_name', bank_name, 'account_type', account_type,
              'account_last4', right(account_number, 4), 'phone_last4', right(phone_number, 4), 'holder_name', holder_name)
         from public.professional_payout_accounts where professional_id = po.professional_id)
   where id = po.id;
  perform public.notify_user(po.professional_id, 'payout_approved', 'Liquidación aprobada',
    format('Tu liquidación del %s al %s por %s fue aprobada.', to_char(po.period_start, 'DD/MM/YYYY'),
      to_char(po.period_end, 'DD/MM/YYYY'), public.fmt_cop(po.net_amount)), '/profesional/ganancias');
end $$;

create or replace function public.mark_payout_paid(p_payout uuid, p_method text, p_reference text, p_receipt_path text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  po public.professional_payouts;
  v_items_net numeric;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_reference), '') = '' then raise exception 'Registra el número de la transferencia.'; end if;
  select * into po from public.professional_payouts where id = p_payout for update;
  if po.status <> 'approved' then raise exception 'Solo se pagan liquidaciones aprobadas.'; end if;
  select coalesce(sum(net_amount), 0) into v_items_net from public.payout_items where payout_id = po.id;
  update public.professional_payouts set status = 'paid', paid_by = auth.uid(), paid_at = now(),
    transfer_method = p_method, transfer_reference = p_reference, receipt_path = p_receipt_path where id = po.id;
  perform public.post_ledger('Pago liquidación ' || p_reference, jsonb_build_array(
    public.ledger_line('professional_payable', 'debit', v_items_net),
    public.ledger_line('payout_adjustments', case when po.adjustments_amount >= 0 then 'debit' else 'credit' end, abs(po.adjustments_amount)),
    public.ledger_line('cash_gateway', 'credit', po.net_amount)), null, null, null, po.id);
  perform public.notify_user(po.professional_id, 'payout_paid', 'Liquidación pagada',
    format('Transferimos %s (ref. %s).', public.fmt_cop(po.net_amount), p_reference), '/profesional/ganancias');
end $$;

create or replace function public.cancel_payout(p_payout uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare po public.professional_payouts;
begin
  perform public.require_role('admin');
  select * into po from public.professional_payouts where id = p_payout for update;
  if po.status not in ('pending', 'approved') then raise exception 'No se puede cancelar esta liquidación.'; end if;
  perform public.audit('cancel_payout_items', 'professional_payouts', po.id::text,
    (select jsonb_agg(to_jsonb(i)) from public.payout_items i where i.payout_id = po.id));
  delete from public.payout_items where payout_id = po.id;   -- las citas vuelven a ser liquidables
  update public.professional_payouts set status = 'cancelled', cancelled_reason = p_reason where id = po.id;
end $$;

create or replace function public.professional_earnings_summary()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_uid uuid := public.require_role('professional');
begin
  return jsonb_build_object(
    'completed_count', (select count(*) from public.appointments where professional_id = v_uid and status = 'completed'),
    'gross_amount', (select coalesce(sum(base_amount + surcharges_amount + travel_fee), 0) from public.appointments
                      where professional_id = v_uid and status = 'completed'),
    'commission_amount', (select coalesce(sum(commission_amount), 0) from public.appointments
                      where professional_id = v_uid and status = 'completed'),
    'net_amount', (select coalesce(sum(professional_net_amount), 0) from public.appointments
                      where professional_id = v_uid and status = 'completed'),
    'pending_amount', (select coalesce(sum(a.professional_net_amount), 0) from public.appointments a
                      where a.professional_id = v_uid and a.status = 'completed'
                        and not exists (select 1 from public.payout_items i join public.professional_payouts po on po.id = i.payout_id
                                        where i.appointment_id = a.id and po.status = 'paid')),
    'paid_amount', (select coalesce(sum(net_amount), 0) from public.professional_payouts where professional_id = v_uid and status = 'paid'),
    'adjustments_amount', (select coalesce(sum(adjustments_amount), 0) from public.professional_payouts
                      where professional_id = v_uid and status in ('approved', 'paid'))
  );
end $$;

-- ---------------------------------------------------------------- aprobación de profesionales
create or replace function public.admin_approve_professional(p_professional uuid, p_hourly_rate numeric, p_notes text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pr public.professional_profiles;
begin
  perform public.require_role('admin');
  select * into pr from public.professional_profiles where user_id = p_professional for update;
  if pr.user_id is null then raise exception 'Profesional no encontrado.'; end if;
  if pr.specialty_id is null or pr.category_id is null then raise exception 'El perfil no tiene servicio/especialidad.'; end if;
  if p_hourly_rate is null or p_hourly_rate <= 0 then raise exception 'Define la tarifa final por hora.'; end if;
  if not exists (select 1 from public.professional_service_areas where professional_id = p_professional) then
    raise exception 'El profesional no tiene zonas de atención.';
  end if;
  if not exists (select 1 from public.professional_credentials where professional_id = p_professional
                 and status = 'approved' and credential_type in ('title', 'professional_card', 'rethus')) then
    raise exception 'Debes aprobar al menos un título, tarjeta profesional o registro RETHUS.';
  end if;
  if public.setting_bool('require_rethus_verification', true) and pr.rethus_verified_at is null then
    raise exception 'Verifica primero el registro en RETHUS (consulta en rethus.minsalud.gov.co).';
  end if;
  update public.professional_profiles set status = 'approved', approved_hourly_rate = p_hourly_rate,
    approved_at = now(), approved_by = auth.uid(), rejection_reason = null where user_id = p_professional;
  perform public.audit('approve_professional', 'professional_profiles', p_professional::text,
    jsonb_build_object('hourly_rate', p_hourly_rate, 'notes', p_notes));
  perform public.notify_user(p_professional, 'professional_approved', 'Perfil aprobado',
    'Tu perfil fue aprobado. Ya puedes recibir solicitudes según tu agenda.', '/profesional');
end $$;

create or replace function public.admin_reject_professional(p_professional uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_role('admin');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  update public.professional_profiles set status = 'rejected', rejection_reason = p_reason where user_id = p_professional;
  perform public.notify_user(p_professional, 'professional_rejected', 'Revisión de perfil',
    'Tu perfil requiere ajustes: ' || p_reason, '/profesional/perfil');
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_role('admin');
  if p_user = auth.uid() then raise exception 'No puedes suspender tu propia cuenta.'; end if;
  if p_status = 'suspended' and coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  update public.users set status = p_status, suspended_reason = case when p_status = 'suspended' then p_reason end where id = p_user;
  if p_status = 'suspended' then
    update public.professional_profiles set status = 'suspended' where user_id = p_user and status = 'approved';
  end if;
end $$;

-- ---------------------------------------------------------------- dashboard y reportes
create or replace function public.ledger_balance(p_account public.ledger_account, p_from timestamptz, p_to timestamptz, p_credit_normal boolean)
returns numeric language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(case when direction = 'credit' then amount else -amount end) * case when p_credit_normal then 1 else -1 end, 0)
  from public.financial_ledger
  where account = p_account and (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at < p_to);
$$;

create or replace function public.admin_dashboard_stats(p_from date, p_to date, p_professional uuid default null, p_category uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_from timestamptz := (p_from::timestamp) at time zone 'America/Bogota';
  v_to   timestamptz := ((p_to + 1)::timestamp) at time zone 'America/Bogota';
  v_comm numeric; v_fee numeric; v_memb numeric; v_canc numeric; v_disc numeric; v_gw numeric;
  v_decided int; v_accepted int;
begin
  perform public.require_role('admin');
  v_comm := public.ledger_balance('platform_commission_revenue', v_from, v_to, true);
  v_fee  := public.ledger_balance('platform_service_fee_revenue', v_from, v_to, true);
  v_memb := public.ledger_balance('platform_membership_revenue', v_from, v_to, true);
  v_canc := public.ledger_balance('platform_cancellation_revenue', v_from, v_to, true);
  v_disc := public.ledger_balance('promotional_discount_expense', v_from, v_to, false);
  v_gw   := public.ledger_balance('gateway_fee_expense', v_from, v_to, false);

  select count(*) filter (where to_status in ('confirmed', 'rejected', 'expired') and from_status in ('pending_acceptance', 'professional_assigned')),
         count(*) filter (where to_status = 'confirmed' and from_status in ('pending_acceptance', 'professional_assigned'))
    into v_decided, v_accepted
  from public.appointment_status_history h join public.appointments a on a.id = h.appointment_id
  where h.created_at >= v_from and h.created_at < v_to
    and (p_professional is null or a.professional_id = p_professional) and (p_category is null or a.category_id = p_category);

  return jsonb_build_object(
    'counts', jsonb_build_object(
      'patients', (select count(*) from public.users where role = 'patient'),
      'active_memberships', (select count(*) from public.patient_memberships where status = 'active' and ends_at > now()),
      'approved_professionals', (select count(*) from public.professional_profiles where status = 'approved'),
      'professionals_pending_review', (select count(*) from public.professional_profiles where status = 'pending_review'),
      'pending_requests', (select count(*) from public.appointments where status in ('pending_acceptance', 'professional_assigned', 'pending_reassignment')),
      'refunds_pending', (select count(*) from public.refunds where status in ('pending', 'processing'))
    ),
    'period', (select jsonb_build_object(
        'created', count(*),
        'confirmed', count(*) filter (where accepted_at is not null),
        'rejected', (select count(*) from public.appointment_rejections r join public.appointments x on x.id = r.appointment_id
                     where r.kind = 'rejected' and r.created_at >= v_from and r.created_at < v_to
                       and (p_professional is null or r.professional_id = p_professional) and (p_category is null or x.category_id = p_category)),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status in ('cancelled', 'refund_pending', 'refunded') and cancellation_reason is not null),
        'paid', count(*) filter (where amount_paid > 0))
      from public.appointments a
      where a.created_at >= v_from and a.created_at < v_to
        and (p_professional is null or a.professional_id = p_professional) and (p_category is null or a.category_id = p_category)),
    'money', jsonb_build_object(
      'collected_total', (select coalesce(sum(amount), 0) from public.payments where status = 'approved' and approved_at >= v_from and approved_at < v_to),
      'collected_appointments', (select coalesce(sum(amount), 0) from public.payments where status = 'approved' and purpose = 'appointment' and approved_at >= v_from and approved_at < v_to),
      'membership_revenue', v_memb,
      'commission_revenue', v_comm,
      'service_fee_revenue', v_fee,
      'cancellation_revenue', v_canc,
      'discount_expense', v_disc,
      'gateway_fees', v_gw,
      'platform_estimated_income', v_comm + v_fee + v_memb + v_canc - v_disc - v_gw,
      'customer_funds_held_balance', public.ledger_balance('customer_funds_held', null, null, true),
      'professional_payable_balance', public.ledger_balance('professional_payable', null, null, true),
      'payouts_pending', (select coalesce(sum(net_amount), 0) from public.professional_payouts where status in ('pending', 'approved')),
      'payouts_paid', (select coalesce(sum(net_amount), 0) from public.professional_payouts where status = 'paid' and paid_at >= v_from and paid_at < v_to),
      'refunds_pending', (select coalesce(sum(amount), 0) from public.refunds where status in ('pending', 'processing')),
      'refunds_completed', (select coalesce(sum(amount), 0) from public.refunds where status = 'completed' and processed_at >= v_from and processed_at < v_to)
    ),
    'rates', jsonb_build_object(
      'acceptance_rate', case when v_decided > 0 then round(100.0 * v_accepted / v_decided, 1) end,
      'cancellation_rate', (select case when count(*) > 0 then round(100.0 * count(*) filter (where cancellation_reason is not null) / count(*), 1) end
                            from public.appointments a where a.created_at >= v_from and a.created_at < v_to and a.amount_paid > 0
                              and (p_professional is null or a.professional_id = p_professional) and (p_category is null or a.category_id = p_category))
    ),
    'bookings_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', n) order by d), '[]') from (
        select (a.created_at at time zone 'America/Bogota')::date d, count(*) n from public.appointments a
        where a.created_at >= v_from and a.created_at < v_to and a.amount_paid > 0
          and (p_professional is null or a.professional_id = p_professional) and (p_category is null or a.category_id = p_category)
        group by 1) t),
    'income_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'platform_income', inc, 'collected', col) order by m), '[]') from (
        select to_char(l.occurred_at at time zone 'America/Bogota', 'YYYY-MM') m,
               sum(case when l.account in ('platform_commission_revenue', 'platform_service_fee_revenue', 'platform_membership_revenue', 'platform_cancellation_revenue')
                        then (case when l.direction = 'credit' then l.amount else -l.amount end)
                        when l.account in ('promotional_discount_expense', 'gateway_fee_expense')
                        then (case when l.direction = 'debit' then -l.amount else l.amount end) else 0 end) inc,
               sum(case when l.account = 'cash_gateway' and l.direction = 'debit' and l.payment_id is not null and l.refund_id is null then l.amount else 0 end) col
        from public.financial_ledger l
        where l.occurred_at >= v_from - interval '11 months' and l.occurred_at < v_to
        group by 1) t),
    'top_services', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]') from (
        select s.name, count(*) n from public.appointments a join public.specialties s on s.id = a.specialty_id
        where a.created_at >= v_from and a.created_at < v_to and a.amount_paid > 0
          and (p_professional is null or a.professional_id = p_professional) and (p_category is null or a.category_id = p_category)
        group by s.name order by n desc limit 8) t),
    'top_professionals', (select coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'count', n) order by n desc), '[]') from (
        select u.full_name, count(*) n from public.appointments a join public.users u on u.id = a.professional_id
        where a.created_at >= v_from and a.created_at < v_to and a.status in ('confirmed', 'en_route', 'arrived', 'in_progress', 'completed')
          and (p_category is null or a.category_id = p_category)
        group by u.full_name order by n desc limit 8) t)
  );
end $$;
