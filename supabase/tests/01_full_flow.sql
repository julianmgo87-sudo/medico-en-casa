-- =============================================================================
-- Prueba de flujo completo sobre PostgreSQL local (scripts/test-db.sh).
-- Registro → Membresía → Profesional aprobado → Reserva → Pago 100 % →
-- Aceptación → Atención completada → Comisión → Liquidación pagada.
-- Más: rechazo, reasignación, reembolso, vencimientos, RLS y anti-doble reserva.
-- Los pagos se aplican llamando a apply_payment_result como service_role, que es
-- exactamente lo que hace el webhook después de validar la firma de Wompi.
-- =============================================================================
\set QUIET on
\pset format unaligned
\pset tuples_only on

create schema test;
grant usage on schema test to public;
create table test.ids (k text primary key, v uuid);
grant select, insert on test.ids to public;
create function test.id(p text) returns uuid language sql stable as $$ select v from test.ids where k = p $$;
create function test.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select v::text from test.ids where k = p), ''), false);
$$;
create function test.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'Error inesperado. Esperado "%", obtenido "%"', p_like, sqlerrm;
    end if;
    raise notice 'OK (error esperado): %', sqlerrm;
    return;
  end;
  raise exception 'Se esperaba un error que contuviera "%" al ejecutar: %', p_like, p_sql;
end $$;
create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALLÓ: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end $$;
grant execute on all functions in schema test to public;

-- ------------------------------------------------------------------ usuarios
insert into auth.users (email, raw_user_meta_data) values
  ('admin@prueba.co', '{"full_name": "Admin Prueba"}'),
  ('medica@prueba.co', '{"full_name": "Dra. Prueba Uno", "role": "professional"}'),
  ('medico2@prueba.co', '{"full_name": "Dr. Prueba Dos", "role": "professional"}'),
  ('paciente@prueba.co', '{"full_name": "Paciente Prueba", "role": "patient", "terms_accepted": "true", "data_consent": "true", "phone": "3000000000"}'),
  ('paciente2@prueba.co', '{"full_name": "Paciente Dos", "role": "admin"}');   -- intenta auto-asignarse admin
insert into test.ids select 'admin', id from auth.users where email = 'admin@prueba.co';
insert into test.ids select 'pro1', id from auth.users where email = 'medica@prueba.co';
insert into test.ids select 'pro2', id from auth.users where email = 'medico2@prueba.co';
insert into test.ids select 'pat', id from auth.users where email = 'paciente@prueba.co';
insert into test.ids select 'pat2', id from auth.users where email = 'paciente2@prueba.co';
select test.ok((select role from public.users where id = test.id('pat2')) = 'patient', 'El registro no puede crear administradores');
update public.users set role = 'admin' where id = test.id('admin');   -- bootstrap del primer admin (SQL directo)
insert into test.ids select 'medgen', id from public.service_categories where slug = 'medicina-general';
insert into test.ids select 'comuna1', id from public.service_areas where name = 'Comuna 1';
insert into test.ids select 'palmira', id from public.service_areas where name = 'Palmira';
insert into test.ids select 'rozo', id from public.service_areas where name = 'Rozo';

-- ------------------------------------------------------------------ profesional completa su perfil
select test.act_as('pro1'); set role authenticated;
update public.professional_profiles set profession = 'Médica general', category_id = test.id('medgen'),
  specialty_id = (select id from public.specialties where slug = 'consulta-medicina-general'),
  document_type = 'CC', document_number = '123456', professional_registration = 'RM-0001', rethus_number = 'R-0001',
  years_experience = 8, bio = 'Perfil de prueba', proposed_hourly_rate = 110000
where user_id = test.id('pro1');
select test.expect_error($$update public.professional_profiles set approved_hourly_rate = 999999 where user_id = test.id('pro1')$$, 'administrador');
select test.expect_error($$update public.professional_profiles set status = 'approved' where user_id = test.id('pro1')$$, 'estado de verificación');
select test.expect_error($$update public.users set role = 'admin' where id = test.id('pro1')$$, 'rol');
insert into public.professional_credentials (professional_id, credential_type, title, institution, status)
values (test.id('pro1'), 'title', 'Médica y cirujana', 'Universidad de prueba', 'approved');
select test.ok((select status from public.professional_credentials where professional_id = test.id('pro1')) = 'pending', 'Las credenciales nuevas quedan pendientes aunque se envíen como aprobadas');
insert into public.professional_service_areas values (test.id('pro1'), test.id('palmira'));
insert into public.professional_availability (professional_id, weekday, start_time, end_time)
select test.id('pro1'), d, '00:00', '23:59' from generate_series(0, 6) d;
insert into public.professional_payout_accounts (professional_id, method, bank_name, account_type, account_number, holder_name, holder_document)
values (test.id('pro1'), 'bank_account', 'Banco de prueba', 'ahorros', '0001112223', 'Dra. Prueba Uno', '123456');
update public.professional_profiles set status = 'pending_review' where user_id = test.id('pro1');
select test.ok((select count(*) from public.public_professionals) = 0, 'Un profesional no aprobado no aparece en el directorio');
reset role;

-- segundo profesional (para reasignaciones)
select test.act_as('pro2'); set role authenticated;
update public.professional_profiles set profession = 'Médico general', category_id = test.id('medgen'),
  specialty_id = (select id from public.specialties where slug = 'consulta-medicina-general'), rethus_number = 'R-0002'
where user_id = test.id('pro2');
insert into public.professional_credentials (professional_id, credential_type, title) values (test.id('pro2'), 'professional_card', 'Tarjeta profesional');
insert into public.professional_service_areas values (test.id('pro2'), test.id('comuna1'));
insert into public.professional_availability (professional_id, weekday, start_time, end_time)
select test.id('pro2'), d, '00:00', '23:59' from generate_series(0, 6) d;
insert into public.professional_payout_accounts (professional_id, method, holder_name, holder_document, phone_number)
values (test.id('pro2'), 'nequi', 'Dr. Prueba Dos', '654321', '3001112233');
update public.professional_profiles set status = 'pending_review' where user_id = test.id('pro2');
reset role;

-- ------------------------------------------------------------------ administrador aprueba
select test.act_as('admin'); set role authenticated;
select test.expect_error($$select public.admin_approve_professional(test.id('pro1'), 100000)$$, 'título');
update public.professional_credentials set status = 'approved', reviewed_by = test.id('admin'), reviewed_at = now()
 where professional_id in (test.id('pro1'), test.id('pro2'));
select test.expect_error($$select public.admin_approve_professional(test.id('pro1'), 100000)$$, 'RETHUS');
update public.professional_profiles set rethus_verified_at = now(), rethus_verified_by = test.id('admin')
 where user_id in (test.id('pro1'), test.id('pro2'));
select public.admin_approve_professional(test.id('pro1'), 100000, 'Tarifa final definida por administración');
select public.admin_approve_professional(test.id('pro2'), 100000);
update public.professional_payout_accounts set verified_at = now(), verified_by = test.id('admin');
select test.ok((select count(*) from public.audit_logs where action = 'approve_professional') = 2, 'La aprobación queda en auditoría');
reset role;

select set_config('request.jwt.claim.sub', '', false); set role anon;
select test.ok((select count(*) from public.public_professionals) = 2, 'El directorio público muestra los aprobados');
select test.ok((select count(*) from public.users) = 0, 'Anónimo no puede leer usuarios');
select test.ok((select booking_enabled from public.category_catalog where slug = 'medicina-general') = false, 'Categoría no reservable sin verificación regulatoria');
reset role;

select test.act_as('admin'); set role authenticated;
select test.expect_error($$update public.service_categories set booking_enabled = true where slug = 'medicina-general'$$, 'booking_requires_verification');
update public.service_categories set booking_enabled = true, regulatory_verified_at = now(), regulatory_verified_by = test.id('admin')
 where slug = 'medicina-general';
reset role;

-- ------------------------------------------------------------------ motor de precios (fechas fijas)
do $$
declare q jsonb;
begin
  q := public.compute_quote(test.id('pro1'), 'scheduled', '2026-11-04 10:00-05', 60, test.id('comuna1'));
  perform test.ok((q ->> 'total_amount')::numeric = 110000, 'Miércoles diurno: 100.000 + 10.000 desplazamiento = 110.000');
  q := public.compute_quote(test.id('pro1'), 'scheduled', '2026-11-04 21:00-05', 60, test.id('comuna1'));
  perform test.ok((q ->> 'total_amount')::numeric = 140000, 'Ejemplo del documento: 100.000 + 30 % nocturno + 10.000 = 140.000');
  perform test.ok((q ->> 'commission_amount')::numeric = 26000, 'Comisión 20 % sobre valor del servicio (130.000) = 26.000');
  perform test.ok((q ->> 'professional_net_amount')::numeric = 114000, 'Neto profesional = 130.000 + 10.000 − 26.000');
  q := public.compute_quote(test.id('pro1'), 'scheduled', '2026-11-16 10:00-05', 60, test.id('comuna1'));
  perform test.ok((q ->> 'surcharges_amount')::numeric = 20000, 'Festivo (Independencia de Cartagena, lunes) aplica 20 %');
  q := public.compute_quote(test.id('pro1'), 'scheduled', '2026-11-07 10:00-05', 90, test.id('rozo'));
  perform test.ok((q ->> 'base_amount')::numeric = 150000 and (q ->> 'surcharges_amount')::numeric = 22500 and (q ->> 'travel_fee')::numeric = 20000,
    'Sábado, 90 min, Rozo: 150.000 + 15 % + 20.000');
  q := public.compute_quote(test.id('pro1'), 'priority', '2026-11-04 10:00-05', 60, test.id('comuna1'));
  perform test.ok((q ->> 'total_amount')::numeric = 135000, 'Prioritaria: +25 %');
  q := public.get_price_quote(test.id('pro1'), 'scheduled', '2026-11-04 10:00-05', 60, test.id('comuna1'));
  perform test.ok(not (q ? 'commission_amount'), 'La cotización pública no expone la comisión');
end $$;

-- ------------------------------------------------------------------ paciente: membresía
select test.act_as('pat'); set role authenticated;
insert into public.patient_addresses (patient_id, label, address_line, neighborhood, service_area_id, is_default)
values (test.id('pat'), 'Casa', 'Calle 1 # 2-3', 'Centro', test.id('comuna1'), true);
reset role;
insert into test.ids select 'addr', id from public.patient_addresses where patient_id = test.id('pat');
-- primer horario disponible del profesional 1
create table test.slot as
  select s.starts_at from public.get_available_slots(test.id('pro1'), current_date, current_date + 2, 'scheduled', 60) s limit 3;
grant select on test.slot to public;
select test.ok((select count(*) from test.slot) = 3, 'Hay horarios disponibles generados desde la agenda');

select test.act_as('pat'); set role authenticated;
select test.expect_error($$select public.create_appointment_hold(test.id('pro1'), 'scheduled', (select min(starts_at) from test.slot), 60, test.id('addr'))$$, 'membresía');
create temp table memb as select public.create_membership_checkout((select id from public.membership_plans where code = 'mensual')) as r;
grant select on memb to public;
select test.ok((select (r ->> 'amount')::numeric from memb) = 9900, 'Checkout de membresía por $9.900');
select test.ok((select status from public.patient_memberships where patient_id = test.id('pat')) = 'pending_payment', 'Membresía pendiente hasta confirmar el pago');
reset role;

-- El paciente NO puede aplicar resultados de pago (solo service_role / webhook)
select test.act_as('pat'); set role authenticated;
select test.expect_error(format($$select public.apply_payment_result(%L, 'tx-1', 'APPROVED', 990000)$$, (select r ->> 'reference' from memb)), 'permission denied');
reset role;

set role service_role;
select test.ok((public.apply_payment_result((select r ->> 'reference' from memb), 'tx-m-1', 'APPROVED', 990000, 'COP', 'NEQUI') ->> 'result') = 'approved', 'Webhook aprueba la membresía');
select test.ok((public.apply_payment_result((select r ->> 'reference' from memb), 'tx-m-1', 'APPROVED', 990000, 'COP', 'NEQUI') ->> 'result') = 'already_final', 'Evento repetido es idempotente');
reset role;
select test.ok(public.has_active_membership(test.id('pat')), 'Membresía activa tras el pago');

-- ------------------------------------------------------------------ reserva + pago + aceptación
select test.act_as('pat'); set role authenticated;
create temp table hold1 as select public.create_appointment_hold(test.id('pro1'), 'scheduled', (select min(starts_at) from test.slot), 60, test.id('addr'), null, 'Control general') as r;
grant select on hold1 to public;
select test.ok((select status from public.appointments where id = (select (r ->> 'appointment_id')::uuid from hold1)) = 'pending_payment', 'Cita creada en Pendiente de pago con horario bloqueado');
reset role;
insert into test.ids select 'a1', (r ->> 'appointment_id')::uuid from hold1;

-- Otro paciente no puede tomar el mismo horario (anti doble reserva)
select test.act_as('pat2'); set role authenticated;
insert into public.patient_addresses (patient_id, address_line, service_area_id) values (test.id('pat2'), 'Cra 5 # 6-7', test.id('comuna1'));
select test.ok((select count(*) from public.appointments) = 0, 'Un paciente no ve citas de otros');
reset role;
select test.act_as('admin'); set role authenticated;
select public.admin_grant_membership(test.id('pat2'), 30, 'Exención de prueba');
reset role;
select test.act_as('pat2'); set role authenticated;
select test.expect_error($$select public.create_appointment_hold(test.id('pro1'), 'scheduled', (select min(starts_at) from test.slot), 60,
  (select id from public.patient_addresses where patient_id = test.id('pat2')))$$, 'ya no está disponible');
reset role;
-- Incluso saltándose la validación, la restricción de exclusión impide el solapamiento
select test.expect_error($$insert into public.appointments (patient_id, professional_id, original_professional_id, category_id, specialty_id, care_type,
  starts_at, ends_at, duration_min, travel_buffer_min, blocked_range, patient_range, service_area_id, address_snapshot, hourly_rate, base_amount,
  total_amount, price_breakdown, commission_percent, commission_base_rule, commission_base_amount, commission_amount, professional_net_amount)
  select test.id('pat2'), test.id('pro1'), test.id('pro1'), test.id('medgen'), specialty_id, 'scheduled', (select min(starts_at) from test.slot) + interval '30 min',
  (select min(starts_at) from test.slot) + interval '90 min', 60, 30, 'empty', 'empty', test.id('comuna1'), '{}', 100000, 100000, 100000, '{}', 20, 'service_amount', 100000, 20000, 80000
  from public.professional_profiles where user_id = test.id('pro1')$$, 'no_professional_overlap');

set role service_role;
select test.ok((public.apply_payment_result((select r ->> 'reference' from hold1), 'tx-a-1', 'PENDING', ((select (r ->> 'amount')::numeric from hold1) * 100)::bigint) ->> 'result') = 'processing', 'PSE en procesamiento');
select test.ok((select status from public.appointments where id = test.id('a1')) = 'payment_processing', 'Cita en Pago en procesamiento');
select test.ok((public.apply_payment_result((select r ->> 'reference' from hold1), 'tx-a-1', 'APPROVED', 100) ->> 'result') = 'amount_mismatch', 'Monto alterado se rechaza');
reset role;
-- La referencia con monto inconsistente queda en error; el paciente genera un nuevo intento
update public.appointments set hold_expires_at = now() + interval '20 min', status = 'pending_payment' where id = test.id('a1');
select test.act_as('pat'); set role authenticated;
create temp table pay2 as select public.create_appointment_payment(test.id('a1')) as r;
grant select on pay2 to public;
reset role;
set role service_role;
select test.ok((public.apply_payment_result((select r ->> 'reference' from pay2), 'tx-a-2', 'APPROVED', (select (r ->> 'amount_in_cents')::bigint from pay2), 'COP', 'CARD') ->> 'status') = 'pending_acceptance', 'Pago aprobado → Pendiente de aceptación');
reset role;
select test.ok((select payment_state from public.appointments where id = test.id('a1')) = 'paid', 'Estado financiero separado: pagado');
select test.ok((select response_deadline between now() + interval '29 min' and now() + interval '31 min' from public.appointments where id = test.id('a1')), 'Plazo de respuesta de 30 min para consulta programada');

select test.act_as('pro1'); set role authenticated;
select test.ok((select count(*) from public.appointments) = 0, 'El profesional no lee la tabla de citas directamente');
select test.ok((select public.professional_appointments('pending') -> 0 ->> 'patient_phone') is null, 'Antes de aceptar no ve el teléfono del paciente');
select public.respond_to_appointment(test.id('a1'), true);
select test.ok((select public.professional_appointments('upcoming') -> 0 ->> 'patient_phone') = '3000000000', 'Tras aceptar ve los datos necesarios para la atención');
select public.update_service_progress(test.id('a1'), 'en_route');
select public.update_service_progress(test.id('a1'), 'arrived');
select public.update_service_progress(test.id('a1'), 'in_progress');
select test.expect_error($$select public.update_service_progress(test.id('a1'), 'completed')$$, 'antes de su hora');
reset role;
-- Simula que ya pasó la hora de la cita (ajuste de reloj para la prueba)
update public.appointments set starts_at = now() - interval '61 min', ends_at = now() - interval '1 min' where id = test.id('a1');
select test.act_as('pro1'); set role authenticated;
select public.update_service_progress(test.id('a1'), 'completed');
reset role;
select test.expect_error($$update public.appointments set status = 'pending_payment' where id = test.id('a1')$$, 'Transición de estado no permitida');

select test.act_as('pat'); set role authenticated;
select public.patient_confirm_completion(test.id('a1'));
select public.submit_review(test.id('a1'), 5, 'Excelente atención');
select test.expect_error($$select public.submit_review(test.id('a1'), 4, 'otra')$$, 'Ya calificaste');
reset role;
select test.ok((select rating_avg from public.professional_profiles where user_id = test.id('pro1')) = 5, 'Calificación actualizada');

-- ------------------------------------------------------------------ liquidación
select test.act_as('admin'); set role authenticated;
select test.ok((public.generate_payouts(current_date - 7, current_date + 1) ->> 'payouts_created')::int = 1, 'Se genera una liquidación');
select test.ok((public.generate_payouts(current_date - 7, current_date + 1) ->> 'payouts_created')::int = 0, 'No se generan liquidaciones duplicadas');
insert into test.ids select 'po1', id from public.professional_payouts where professional_id = test.id('pro1');
select test.ok((select net_amount = (select professional_net_amount from public.appointments where id = test.id('a1'))
                from public.professional_payouts where id = test.id('po1')), 'Neto liquidado = valor − comisión congelada');
select public.approve_payout(test.id('po1'));
select test.expect_error($$select public.mark_payout_paid(test.id('po1'), 'transferencia', '')$$, 'transferencia');
select public.mark_payout_paid(test.id('po1'), 'transferencia', 'TRF-0001');
reset role;
select test.ok((select coalesce(sum(case when direction = 'debit' then amount else -amount end), 0) from public.financial_ledger) = 0, 'Libro contable cuadrado');
select test.ok(public.ledger_balance('customer_funds_held', null, null, true) = 0, 'Sin fondos de clientes pendientes tras prestar el servicio');
select test.ok(public.ledger_balance('professional_payable', null, null, true) = 0, 'Nada por pagar al profesional tras la transferencia');
select test.ok(public.ledger_balance('platform_commission_revenue', null, null, true) = (select commission_amount from public.appointments where id = test.id('a1')), 'Comisión registrada como ingreso propio');

-- ------------------------------------------------------------------ rechazo → alternativa → devolución de diferencia
select test.act_as('pat'); set role authenticated;
create temp table hold2 as select public.create_appointment_hold(test.id('pro1'), 'scheduled', (select max(starts_at) from test.slot), 60, test.id('addr')) as r;
grant select on hold2 to public;
reset role;
insert into test.ids select 'a2', (r ->> 'appointment_id')::uuid from hold2;
set role service_role;
select public.apply_payment_result((select r ->> 'reference' from hold2), 'tx-a-3', 'APPROVED', (select (r ->> 'amount_in_cents')::bigint from hold2));
reset role;
select test.act_as('pro1'); set role authenticated;
select test.expect_error($$select public.respond_to_appointment(test.id('a2'), false, 'otro', '')$$, 'Describe');
select public.respond_to_appointment(test.id('a2'), false, 'conflicto_agenda');
reset role;
select test.ok((select status from public.appointments where id = test.id('a2')) = 'pending_reassignment', 'Rechazo → Pendiente de reasignación');
select test.ok((select count(*) from public.appointment_status_history where appointment_id = test.id('a2') and to_status = 'rejected') = 1, 'El rechazo queda en el historial');
select test.act_as('pat'); set role authenticated;
select test.ok((select count(*) from public.find_alternatives(test.id('a2')) where professional_id = test.id('pro2')) = 1, 'Se ofrece el profesional alternativo');
select test.ok((select count(*) from public.find_alternatives(test.id('a2')) where professional_id = test.id('pro1')) = 0, 'No se ofrece quien rechazó');
select public.accept_alternative(test.id('a2'), test.id('pro2'), (select starts_at from public.find_alternatives(test.id('a2')) limit 1), true);
reset role;
select test.ok((select status from public.appointments where id = test.id('a2')) = 'professional_assigned', 'Paciente aprueba → Profesional asignado (requiere aceptación)');
-- vencimiento automático del nuevo profesional
update public.appointments set response_deadline = now() - interval '1 min' where id = test.id('a2');
select public.run_scheduled_jobs();
select test.ok((select status from public.appointments where id = test.id('a2')) = 'pending_reassignment', 'Sin respuesta → Expirada → Pendiente de reasignación (proceso del servidor)');
select test.act_as('pat'); set role authenticated;
select public.request_refund_instead(test.id('a2'));
reset role;
select test.ok((select status from public.appointments where id = test.id('a2')) = 'refund_pending', 'Paciente elige devolución');
select test.act_as('admin'); set role authenticated;
select test.expect_error($$select public.admin_complete_refund((select id from public.refunds where appointment_id = test.id('a2')), 'transferencia', '')$$, 'comprobante');
select public.admin_complete_refund((select id from public.refunds where appointment_id = test.id('a2')), 'transferencia', 'DEV-0001');
reset role;
select test.ok((select status::text || '/' || payment_state::text from public.appointments where id = test.id('a2')) = 'refunded/refunded', 'Reembolso confirmado con comprobante');
select test.ok(public.ledger_balance('customer_funds_held', null, null, true) = 0, 'Fondos de clientes en cero tras la devolución');
select test.act_as('admin'); set role authenticated;
select test.ok((public.generate_payouts(current_date - 7, current_date + 1) ->> 'payouts_created')::int = 0, 'Citas reembolsadas no se liquidan');
reset role;

-- ------------------------------------------------------------------ vencimiento de reserva sin pago
select test.act_as('pat'); set role authenticated;
create temp table hold3 as select public.create_appointment_hold(test.id('pro1'), 'scheduled',
  (select starts_at from test.slot order by starts_at offset 1 limit 1), 60, test.id('addr')) as r;
grant select on hold3 to public;
reset role;
update public.appointments set hold_expires_at = now() - interval '1 min' where id = (select (r ->> 'appointment_id')::uuid from hold3);
select public.run_scheduled_jobs();
select test.ok((select status from public.appointments where id = (select (r ->> 'appointment_id')::uuid from hold3)) = 'expired', 'Reserva sin pago expira y libera el horario');
select test.ok(public.slot_is_available(test.id('pro1'), (select starts_at from test.slot order by starts_at offset 1 limit 1), 60, 'scheduled'), 'El horario vuelve a estar disponible');
-- Pago aprobado tarde: se recupera el horario si sigue libre
set role service_role;
select test.ok((public.apply_payment_result((select r ->> 'reference' from hold3), 'tx-a-4', 'APPROVED', (select (r ->> 'amount_in_cents')::bigint from hold3)) ->> 'status') = 'pending_acceptance', 'Pago tardío recupera el horario libre');
reset role;

-- ------------------------------------------------------------------ RLS financiero y dashboard
select test.act_as('pat'); set role authenticated;
select test.ok((select count(*) from public.financial_ledger) = 0, 'Paciente no ve el libro contable');
select test.ok((select count(*) from public.professional_payout_accounts) = 0, 'Paciente no ve cuentas bancarias');
select test.expect_error($$select public.admin_dashboard_stats(current_date - 30, current_date)$$, 'permisos');
reset role;
select test.act_as('admin'); set role authenticated;
do $$
declare s jsonb := public.admin_dashboard_stats(current_date - 30, current_date);
begin
  perform test.ok((s -> 'money' ->> 'collected_total')::numeric > (s -> 'money' ->> 'platform_estimated_income')::numeric, 'El recaudo NO se presenta como utilidad');
  perform test.ok((s -> 'money' ->> 'membership_revenue')::numeric = 9900, 'Ingreso por membresías');
  raise notice 'Dashboard: %', s -> 'money';
end $$;
reset role;

-- ------------------------------------------------------------------ moderación de valoraciones
select test.act_as('admin'); set role authenticated;
update public.reviews set is_visible = false where appointment_id = test.id('a1');
reset role;
select test.ok((select rating_count from public.professional_profiles where user_id = test.id('pro1')) = 0, 'Ocultar una valoración recalcula el promedio público');
select test.ok(exists (select 1 from public.audit_logs where entity_type = 'reviews' and action = 'update'), 'La moderación queda en auditoría');

select 'TODAS LAS PRUEBAS PASARON';
