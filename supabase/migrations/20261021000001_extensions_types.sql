-- =============================================================================
-- Médico en Casa Palmira — 0001: extensiones y tipos
-- =============================================================================
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create extension if not exists citext;

-- Estado OPERATIVO de la cita (separado del estado financiero).
create type public.appointment_status as enum (
  'pending_payment',        -- Pendiente de pago
  'payment_processing',     -- Pago en procesamiento
  'pending_acceptance',     -- Pendiente de aceptación
  'confirmed',              -- Confirmada
  'rejected',               -- Rechazada
  'expired',                -- Expirada
  'pending_reassignment',   -- Pendiente de reasignación
  'professional_assigned',  -- Profesional asignado (esperando aceptación del nuevo profesional)
  'en_route',               -- Profesional en camino
  'arrived',                -- Profesional llegó
  'in_progress',            -- Atención en curso
  'completed',              -- Completada
  'cancelled',              -- Cancelada
  'refund_pending',         -- Reembolso pendiente
  'refunded',               -- Reembolsada
  'disputed'                -- En disputa
);

-- Estado FINANCIERO de la cita.
create type public.appointment_payment_state as enum (
  'unpaid', 'processing', 'paid', 'refund_pending', 'partially_refunded', 'refunded'
);

create type public.care_type as enum ('scheduled', 'priority');
create type public.payment_status as enum ('pending', 'processing', 'approved', 'declined', 'voided', 'error');
create type public.payment_purpose as enum ('membership', 'appointment');
create type public.professional_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'suspended');
create type public.credential_status as enum ('pending', 'approved', 'rejected');
create type public.credential_type as enum ('title', 'certification', 'rethus', 'id_document', 'professional_card', 'other');
create type public.membership_status as enum ('pending_payment', 'active', 'expired', 'suspended', 'cancelled');
create type public.payout_status as enum ('pending', 'approved', 'paid', 'cancelled');
create type public.refund_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');
create type public.notification_channel as enum ('email', 'whatsapp', 'push');
create type public.notification_status as enum ('pending', 'sent', 'failed', 'skipped');
create type public.area_type as enum ('municipio', 'comuna', 'barrio', 'corregimiento', 'zona_rural');
create type public.pricing_rule_type as enum (
  'night_surcharge', 'weekend_surcharge', 'holiday_surcharge', 'priority_surcharge',
  'travel_fee', 'service_fee', 'discount'
);
create type public.rule_scope as enum ('global', 'category', 'specialty', 'professional', 'care_type');
create type public.value_type as enum ('percent', 'fixed');
create type public.ledger_account as enum (
  'cash_gateway',                 -- Efectivo y saldos en pasarela/banco (activo)
  'customer_funds_held',          -- Dinero recaudado de consultas aún no prestadas (pasivo)
  'professional_payable',         -- Por pagar a profesionales (pasivo)
  'refunds_payable',              -- Reembolsos aprobados por pagar (pasivo)
  'platform_commission_revenue',  -- Ingreso propio: comisiones
  'platform_service_fee_revenue', -- Ingreso propio: cargo de servicio
  'platform_membership_revenue',  -- Ingreso propio: membresías
  'platform_cancellation_revenue',-- Ingreso propio: penalidades por cancelación tardía
  'promotional_discount_expense', -- Gasto: descuentos asumidos por la plataforma
  'gateway_fee_expense',          -- Gasto: comisiones de pasarela
  'payout_adjustments'            -- Ajustes a liquidaciones (débito = gasto, crédito = recuperación)
);
create type public.ledger_direction as enum ('debit', 'credit');
