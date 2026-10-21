-- Médico en Casa Palmira — instalación completa de la base de datos.
-- Generado por scripts/build-production-sql.sh. Ejecutar UNA sola vez en un proyecto nuevo.
-- Supabase → SQL Editor → New query → pegar todo → Run.

-- >>>>>>>>>> 20261021000001_extensions_types.sql
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

-- >>>>>>>>>> 20261021000002_tables.sql
-- =============================================================================
-- Médico en Casa Palmira — 0002: tablas
-- Montos en pesos colombianos (COP) enteros. Fechas en timestamptz (UTC);
-- la presentación y las reglas horarias usan America/Bogota.
-- =============================================================================

-- ---------------------------------------------------------------- usuarios
create table public.roles (
  id   text primary key check (id in ('patient', 'professional', 'admin')),
  name text not null
);

create table public.users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  role               text not null default 'patient' references public.roles (id),
  full_name          text not null default '',
  email              citext not null,
  phone              text,
  status             text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason   text,
  terms_accepted_at  timestamptz,
  data_consent_at    timestamptz,          -- Autorización tratamiento de datos (Ley 1581 de 2012)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index users_role_idx on public.users (role);

create table public.patient_profiles (
  user_id                  uuid primary key references public.users (id) on delete cascade,
  document_type            text check (document_type in ('CC', 'CE', 'TI', 'PA', 'PPT')),
  document_number          text,
  birth_date               date,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------- catálogo
create table public.service_categories (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  description             text not null default '',
  icon                    text not null default 'stethoscope',
  sort_order              int not null default 0,
  is_active               boolean not null default true,     -- visible en el catálogo
  booking_enabled         boolean not null default false,    -- reservable (requiere verificación regulatoria)
  regulatory_notes        text not null default '',
  regulatory_verified_at  timestamptz,
  regulatory_verified_by  uuid references public.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint booking_requires_verification check (not booking_enabled or regulatory_verified_at is not null)
);

create table public.specialties (
  id                    uuid primary key default gen_random_uuid(),
  category_id           uuid not null references public.service_categories (id),
  slug                  text not null unique,
  name                  text not null,
  description           text not null default '',
  default_hourly_rate   numeric(12, 0) check (default_hourly_rate >= 0),
  default_duration_min  int not null default 60 check (default_duration_min between 15 and 480),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index specialties_category_idx on public.specialties (category_id);

-- ---------------------------------------------------------------- cobertura
create table public.service_areas (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.service_areas (id),
  name          text not null,
  area_type     public.area_type not null,
  municipality  text not null default 'Palmira',
  department    text not null default 'Valle del Cauca',
  travel_fee    numeric(12, 0) not null default 0 check (travel_fee >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (parent_id, name)
);
create index service_areas_parent_idx on public.service_areas (parent_id);

-- ---------------------------------------------------------------- profesionales
create table public.professional_profiles (
  user_id               uuid primary key references public.users (id) on delete cascade,
  status                public.professional_status not null default 'draft',
  document_type         text check (document_type in ('CC', 'CE', 'PA', 'PPT')),
  document_number       text,
  profession            text not null default '',
  category_id           uuid references public.service_categories (id),
  specialty_id          uuid references public.specialties (id),
  professional_registration text,
  rethus_number         text,
  rethus_verified_at    timestamptz,
  rethus_verified_by    uuid references public.users (id),
  years_experience      int check (years_experience between 0 and 70),
  bio                   text not null default '',
  photo_path            text,                                -- bucket público professional-photos
  proposed_hourly_rate  numeric(12, 0) check (proposed_hourly_rate >= 0),
  approved_hourly_rate  numeric(12, 0) check (approved_hourly_rate >= 0),  -- decide el administrador
  default_duration_min  int not null default 60 check (default_duration_min between 15 and 480),
  travel_buffer_min     int not null default 30 check (travel_buffer_min between 0 and 240),
  rating_avg            numeric(3, 2) not null default 0,
  rating_count          int not null default 0,
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references public.users (id),
  rejection_reason      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint approved_needs_rate check (status <> 'approved' or approved_hourly_rate is not null),
  constraint approved_needs_specialty check (status <> 'approved' or specialty_id is not null)
);
create index professional_profiles_status_idx on public.professional_profiles (status);
create index professional_profiles_specialty_idx on public.professional_profiles (specialty_id);

-- Datos bancarios en tabla separada: nunca se exponen públicamente.
create table public.professional_payout_accounts (
  professional_id   uuid primary key references public.professional_profiles (user_id) on delete cascade,
  method            text not null check (method in ('bank_account', 'nequi', 'daviplata')),
  bank_name         text,
  account_type      text check (account_type in ('ahorros', 'corriente')),
  account_number    text,
  holder_name       text not null,
  holder_document   text not null,
  phone_number      text,
  verified_at       timestamptz,
  verified_by       uuid references public.users (id),
  updated_at        timestamptz not null default now(),
  constraint bank_fields check (method <> 'bank_account' or (bank_name is not null and account_type is not null and account_number is not null)),
  constraint wallet_fields check (method = 'bank_account' or phone_number is not null)
);

create table public.professional_credentials (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professional_profiles (user_id) on delete cascade,
  credential_type  public.credential_type not null,
  title            text not null,
  institution      text,
  issued_on        date,
  file_path        text,              -- bucket privado professional-documents
  status           public.credential_status not null default 'pending',
  reviewed_by      uuid references public.users (id),
  reviewed_at      timestamptz,
  review_notes     text,
  created_at       timestamptz not null default now()
);
create index professional_credentials_prof_idx on public.professional_credentials (professional_id);

create table public.professional_service_areas (
  professional_id  uuid not null references public.professional_profiles (user_id) on delete cascade,
  service_area_id  uuid not null references public.service_areas (id) on delete cascade,
  primary key (professional_id, service_area_id)
);

-- Ventanas recurrentes semanales. Varias ventanas por día = descansos entre ellas.
create table public.professional_availability (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professional_profiles (user_id) on delete cascade,
  weekday          smallint not null check (weekday between 0 and 6),   -- 0 = domingo
  start_time       time not null,
  end_time         time not null,
  valid_from       date not null default current_date,
  valid_until      date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint window_order check (end_time > start_time),
  constraint valid_range check (valid_until is null or valid_until >= valid_from)
);
create index professional_availability_prof_idx on public.professional_availability (professional_id, weekday);

create table public.availability_exceptions (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professional_profiles (user_id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  reason           text,
  created_at       timestamptz not null default now(),
  constraint exception_order check (ends_at > starts_at)
);
create index availability_exceptions_prof_idx on public.availability_exceptions (professional_id, starts_at);

create table public.holidays (
  day   date primary key,
  name  text not null
);

-- ---------------------------------------------------------------- pacientes
create table public.patient_addresses (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.users (id) on delete cascade,
  label            text not null default 'Casa',
  address_line     text not null,
  neighborhood     text,
  service_area_id  uuid references public.service_areas (id),
  reference_notes  text,
  is_default       boolean not null default false,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now()
);
create index patient_addresses_patient_idx on public.patient_addresses (patient_id);

-- ---------------------------------------------------------------- membresías
create table public.membership_plans (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  description    text not null default '',
  period_type    text not null check (period_type in ('monthly', 'annual', 'custom')),
  duration_days  int not null check (duration_days > 0),
  price          numeric(12, 0) not null check (price >= 0),
  is_active      boolean not null default true,
  is_promotional boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.patient_memberships (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.users (id) on delete cascade,
  plan_id       uuid references public.membership_plans (id),
  status        public.membership_status not null default 'pending_payment',
  source        text not null default 'purchase' check (source in ('purchase', 'admin_grant', 'promotion')),
  price_paid    numeric(12, 0) not null default 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  cancelled_at  timestamptz,
  notes         text,
  created_by    uuid references public.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint active_has_dates check (status not in ('active', 'expired') or (starts_at is not null and ends_at is not null))
);
create index patient_memberships_patient_idx on public.patient_memberships (patient_id, status, ends_at);

-- ---------------------------------------------------------------- precios y comisiones
create table public.pricing_rules (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  rule_type        public.pricing_rule_type not null,
  scope            public.rule_scope not null default 'global',
  category_id      uuid references public.service_categories (id),
  specialty_id     uuid references public.specialties (id),
  professional_id  uuid references public.professional_profiles (user_id),
  value_type       public.value_type not null,
  value            numeric(12, 2) not null check (value >= 0),
  promo_code       citext,                -- solo para 'discount'; null = automático
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scope_target check (
    (scope = 'global' and category_id is null and specialty_id is null and professional_id is null) or
    (scope = 'category' and category_id is not null) or
    (scope = 'specialty' and specialty_id is not null) or
    (scope = 'professional' and professional_id is not null)
  ),
  constraint percent_range check (value_type <> 'percent' or value <= 100)
);
create index pricing_rules_type_idx on public.pricing_rules (rule_type, is_active);

create table public.commissions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  scope            public.rule_scope not null default 'global',
  category_id      uuid references public.service_categories (id),
  specialty_id     uuid references public.specialties (id),
  professional_id  uuid references public.professional_profiles (user_id),
  care_type        public.care_type,
  percent          numeric(5, 2) not null check (percent between 0 and 100),
  valid_from       timestamptz,
  valid_until      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint commission_scope_target check (
    (scope = 'global') or
    (scope = 'category' and category_id is not null) or
    (scope = 'specialty' and specialty_id is not null) or
    (scope = 'professional' and professional_id is not null) or
    (scope = 'care_type' and care_type is not null)
  )
);

-- ---------------------------------------------------------------- citas
create sequence public.appointment_code_seq start 1001;

create table public.appointments (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique default ('MCP-' || nextval('public.appointment_code_seq')),
  patient_id               uuid not null references public.users (id),
  professional_id          uuid not null references public.professional_profiles (user_id),
  original_professional_id uuid not null references public.professional_profiles (user_id),
  category_id              uuid not null references public.service_categories (id),
  specialty_id             uuid not null references public.specialties (id),
  care_type                public.care_type not null,
  status                   public.appointment_status not null default 'pending_payment',
  payment_state            public.appointment_payment_state not null default 'unpaid',

  starts_at                timestamptz not null,
  ends_at                  timestamptz not null,
  duration_min             int not null check (duration_min between 15 and 480),
  travel_buffer_min        int not null default 0,
  blocked_range            tstzrange not null,       -- [inicio, fin + desplazamiento) — mantenido por trigger
  patient_range            tstzrange not null,       -- [inicio, fin)
  blocks_slot              boolean not null default true,  -- mantenido por trigger según estado

  address_id               uuid references public.patient_addresses (id),
  service_area_id          uuid not null references public.service_areas (id),
  address_snapshot         jsonb not null,           -- copia inmutable de la dirección
  promo_code               citext,
  patient_notes            text check (char_length(patient_notes) <= 500),  -- motivo breve, NO historia clínica

  -- Desglose de precio congelado al reservar (no cambia con nuevas tarifas)
  hourly_rate              numeric(12, 0) not null,
  base_amount              numeric(12, 0) not null,
  surcharges_amount        numeric(12, 0) not null default 0,
  travel_fee               numeric(12, 0) not null default 0,
  service_fee              numeric(12, 0) not null default 0,
  discount_amount          numeric(12, 0) not null default 0,
  total_amount             numeric(12, 0) not null check (total_amount >= 0),
  price_breakdown          jsonb not null,
  -- Comisión congelada al reservar
  commission_percent       numeric(5, 2) not null,
  commission_base_rule     text not null,
  commission_base_amount   numeric(12, 0) not null,
  commission_amount        numeric(12, 0) not null,
  professional_net_amount  numeric(12, 0) not null,
  amount_paid              numeric(12, 0) not null default 0,
  amount_refunded          numeric(12, 0) not null default 0,

  hold_expires_at          timestamptz,             -- vence la reserva temporal sin pago
  response_deadline        timestamptz,             -- vence el plazo de aceptación del profesional
  accepted_at              timestamptz,
  rejection_reason         text,
  rejection_notes          text,
  cancellation_reason      text,
  cancelled_by             uuid references public.users (id),
  reassignment_count       int not null default 0,
  reassignment_deadline    timestamptz,
  completed_at             timestamptz,
  completion_ledger_at     timestamptz,
  patient_confirmed_at     timestamptz,
  admin_verified_at        timestamptz,
  admin_verified_by        uuid references public.users (id),
  dispute_reason           text,
  dispute_opened_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint appointment_time_order check (ends_at > starts_at),
  constraint price_consistency check (
    total_amount = base_amount + surcharges_amount + travel_fee + service_fee - discount_amount
  ),
  constraint split_consistency check (
    professional_net_amount = base_amount + surcharges_amount + travel_fee - commission_amount
  ),
  -- Impide reservas simultáneas incompatibles del mismo profesional (incluye desplazamiento)
  constraint no_professional_overlap exclude using gist (
    professional_id with =, blocked_range with &&
  ) where (blocks_slot),
  -- Impide que un paciente tenga dos citas activas solapadas
  constraint no_patient_overlap exclude using gist (
    patient_id with =, patient_range with &&
  ) where (blocks_slot)
);
create index appointments_patient_idx on public.appointments (patient_id, starts_at desc);
create index appointments_professional_idx on public.appointments (professional_id, starts_at desc);
create index appointments_status_idx on public.appointments (status);
create index appointments_deadline_idx on public.appointments (response_deadline) where status in ('pending_acceptance', 'professional_assigned');
create index appointments_hold_idx on public.appointments (hold_expires_at) where status in ('pending_payment', 'payment_processing');

create table public.appointment_status_history (
  id              bigserial primary key,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  from_status     public.appointment_status,
  to_status       public.appointment_status not null,
  changed_by      uuid references public.users (id),
  actor_role      text not null,         -- patient | professional | admin | system
  reason          text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index appointment_status_history_appt_idx on public.appointment_status_history (appointment_id, created_at);

-- Profesionales que rechazaron o dejaron vencer una cita (se excluyen de alternativas).
create table public.appointment_rejections (
  id               bigserial primary key,
  appointment_id   uuid not null references public.appointments (id) on delete cascade,
  professional_id  uuid not null references public.professional_profiles (user_id),
  kind             text not null check (kind in ('rejected', 'expired')),
  reason           text,
  notes            text,
  created_at       timestamptz not null default now()
);
create index appointment_rejections_appt_idx on public.appointment_rejections (appointment_id);

-- ---------------------------------------------------------------- pagos
create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  reference                text not null unique,
  purpose                  public.payment_purpose not null,
  patient_id               uuid not null references public.users (id),
  appointment_id           uuid references public.appointments (id),
  membership_id            uuid references public.patient_memberships (id),
  amount                   numeric(12, 0) not null check (amount > 0),
  currency                 text not null default 'COP' check (currency = 'COP'),
  status                   public.payment_status not null default 'pending',
  provider                 text not null default 'wompi',
  provider_transaction_id  text unique,
  payment_method_type      text,
  provider_fee             numeric(12, 0),       -- registrado en conciliación
  provider_status_message  text,
  approved_at              timestamptz,
  reconciled_at            timestamptz,
  reconciled_by            uuid references public.users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint payment_target check (
    (purpose = 'appointment' and appointment_id is not null and membership_id is null) or
    (purpose = 'membership' and membership_id is not null and appointment_id is null)
  )
);
create index payments_patient_idx on public.payments (patient_id, created_at desc);
create index payments_appointment_idx on public.payments (appointment_id);
create index payments_membership_idx on public.payments (membership_id);
-- Un solo pago aprobado por cita y por membresía.
create unique index payments_one_approved_appt on public.payments (appointment_id) where status = 'approved' and appointment_id is not null;
create unique index payments_one_approved_memb on public.payments (membership_id) where status = 'approved' and membership_id is not null;

-- Eventos recibidos de la pasarela (webhooks). event_key único => idempotencia.
create table public.payment_events (
  id                       bigserial primary key,
  provider                 text not null default 'wompi',
  event_key                text not null,
  event_type               text not null,
  provider_transaction_id  text,
  reference                text,
  signature_valid          boolean not null,
  payload                  jsonb not null,
  processed_at             timestamptz,
  processing_result        text,
  received_at              timestamptz not null default now(),
  unique (provider, event_key)
);

create table public.refunds (
  id                  uuid primary key default gen_random_uuid(),
  payment_id          uuid not null references public.payments (id),
  appointment_id      uuid references public.appointments (id),
  amount              numeric(12, 0) not null check (amount > 0),
  reason              text not null,
  status              public.refund_status not null default 'pending',
  requested_by        uuid references public.users (id),
  requested_at        timestamptz not null default now(),
  processed_by        uuid references public.users (id),
  processed_at        timestamptz,
  method              text,                 -- p. ej. transferencia, anulación en pasarela
  provider_reference  text,                 -- comprobante obligatorio para completar
  notes               text,
  constraint completed_needs_reference check (status <> 'completed' or provider_reference is not null)
);
create index refunds_payment_idx on public.refunds (payment_id);
create index refunds_status_idx on public.refunds (status);

-- ---------------------------------------------------------------- liquidaciones
create table public.professional_payouts (
  id                  uuid primary key default gen_random_uuid(),
  professional_id     uuid not null references public.professional_profiles (user_id),
  period_start        date not null,
  period_end          date not null,
  status              public.payout_status not null default 'pending',
  gross_amount        numeric(14, 0) not null default 0,
  commission_amount   numeric(14, 0) not null default 0,
  adjustments_amount  numeric(14, 0) not null default 0,
  net_amount          numeric(14, 0) not null default 0,
  items_count         int not null default 0,
  adjustments_notes   text,
  payout_account_snapshot jsonb,
  approved_by         uuid references public.users (id),
  approved_at         timestamptz,
  paid_by             uuid references public.users (id),
  paid_at             timestamptz,
  transfer_method     text,
  transfer_reference  text,
  receipt_path        text,               -- bucket privado payout-receipts
  cancelled_reason    text,
  created_by          uuid references public.users (id),
  created_at          timestamptz not null default now(),
  constraint payout_period check (period_end >= period_start),
  constraint paid_needs_reference check (status <> 'paid' or transfer_reference is not null),
  constraint payout_net check (net_amount >= 0)
);
create index professional_payouts_prof_idx on public.professional_payouts (professional_id, created_at desc);

create table public.payout_items (
  id                 uuid primary key default gen_random_uuid(),
  payout_id          uuid not null references public.professional_payouts (id) on delete cascade,
  appointment_id     uuid not null unique references public.appointments (id),  -- impide liquidar dos veces
  gross_amount       numeric(12, 0) not null,
  commission_amount  numeric(12, 0) not null,
  net_amount         numeric(12, 0) not null
);
create index payout_items_payout_idx on public.payout_items (payout_id);

-- Libro contable de partida doble. Cada entry_group suma débitos = créditos.
create table public.financial_ledger (
  id              bigserial primary key,
  entry_group     uuid not null,
  occurred_at     timestamptz not null default now(),
  account         public.ledger_account not null,
  direction       public.ledger_direction not null,
  amount          numeric(14, 0) not null check (amount > 0),
  description     text not null,
  appointment_id  uuid references public.appointments (id),
  payment_id      uuid references public.payments (id),
  refund_id       uuid references public.refunds (id),
  payout_id       uuid references public.professional_payouts (id),
  membership_id   uuid references public.patient_memberships (id),
  created_by      uuid references public.users (id)
);
create index financial_ledger_group_idx on public.financial_ledger (entry_group);
create index financial_ledger_account_idx on public.financial_ledger (account, occurred_at);

-- ---------------------------------------------------------------- otros
create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null unique references public.appointments (id),
  patient_id       uuid not null references public.users (id),
  professional_id  uuid not null references public.professional_profiles (user_id),
  rating           smallint not null check (rating between 1 and 5),
  comment          text check (char_length(comment) <= 1000),
  is_visible       boolean not null default true,
  created_at       timestamptz not null default now()
);
create index reviews_professional_idx on public.reviews (professional_id);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  channel     public.notification_channel not null default 'email',
  template    text not null,
  title       text not null,
  body        text not null,
  link        text,
  payload     jsonb not null default '{}',
  status      public.notification_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  sent_at     timestamptz,
  read_at     timestamptz,
  dedupe_key  text unique,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (status, created_at) where status = 'pending';

create table public.audit_logs (
  id           bigserial primary key,
  actor_id     uuid,
  actor_role   text,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.application_settings (
  key          text primary key,
  value        jsonb not null,
  description  text not null default '',
  is_public    boolean not null default false,
  updated_by   uuid references public.users (id),
  updated_at   timestamptz not null default now()
);

-- >>>>>>>>>> 20261021000003_core_functions.sql
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

-- >>>>>>>>>> 20261021000004_pricing_availability.sql
-- =============================================================================
-- Médico en Casa Palmira — 0004: motor de precios, comisiones, cobertura y agenda
-- =============================================================================

-- ---------------------------------------------------------------- cobertura
create or replace function public.area_ancestors(p_area uuid)
returns table (id uuid) language sql stable security definer set search_path = public, extensions as $$
  with recursive up as (
    select a.id, a.parent_id, 0 as depth from public.service_areas a where a.id = p_area
    union all
    select p.id, p.parent_id, up.depth + 1 from public.service_areas p join up on p.id = up.parent_id where up.depth < 10
  )
  select up.id from up;
$$;

-- Un profesional cubre un área si cubre el área o alguno de sus ancestros (p. ej. la comuna o el municipio).
create or replace function public.professional_covers_area(p_prof uuid, p_area uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.service_areas where id = p_area and is_active)
     and exists (
       select 1 from public.professional_service_areas psa
       where psa.professional_id = p_prof and psa.service_area_id in (select id from public.area_ancestors(p_area))
     );
$$;

-- ---------------------------------------------------------------- reglas de precio
create or replace function public.pick_pricing_rule(
  p_type public.pricing_rule_type, p_prof uuid, p_spec uuid, p_cat uuid, p_promo text default null
) returns public.pricing_rules language sql stable security definer set search_path = public, extensions as $$
  select r.* from public.pricing_rules r
  where r.rule_type = p_type and r.is_active
    and (r.valid_from is null or r.valid_from <= now())
    and (r.valid_until is null or r.valid_until > now())
    and (r.scope = 'global'
      or (r.scope = 'category' and r.category_id = p_cat)
      or (r.scope = 'specialty' and r.specialty_id = p_spec)
      or (r.scope = 'professional' and r.professional_id = p_prof))
    and (p_type <> 'discount' or r.promo_code is null or r.promo_code = p_promo::citext)
  order by
    case r.scope when 'professional' then 1 when 'specialty' then 2 when 'category' then 3 else 4 end,
    (r.promo_code is not null) desc,
    r.created_at desc
  limit 1;
$$;

create or replace function public.pick_commission_percent(p_prof uuid, p_spec uuid, p_cat uuid, p_care public.care_type)
returns numeric language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select c.percent from public.commissions c
    where c.is_active
      and (c.valid_from is null or c.valid_from <= now())
      and (c.valid_until is null or c.valid_until > now())
      and (c.scope = 'global'
        or (c.scope = 'professional' and c.professional_id = p_prof)
        or (c.scope = 'specialty' and c.specialty_id = p_spec)
        or (c.scope = 'category' and c.category_id = p_cat)
        or (c.scope = 'care_type' and c.care_type = p_care))
    order by case c.scope when 'professional' then 1 when 'specialty' then 2 when 'category' then 3
                          when 'care_type' then 4 else 5 end, c.created_at desc
    limit 1
  ), 20);
$$;

create or replace function public.round_cop(p numeric)
returns numeric language sql immutable as $$ select round(p / 100.0) * 100 $$;

create or replace function public.rule_amount(r public.pricing_rules, p_base numeric)
returns numeric language sql immutable as $$
  select case when r.id is null then 0
              when r.value_type = 'percent' then public.round_cop(p_base * r.value / 100.0)
              else r.value end;
$$;

-- Cálculo INTERNO completo (incluye comisión). No expuesto a clientes.
--
-- Definiciones (documentadas también en docs/FINANZAS.md):
--   valor_servicio   = tarifa_base + recargos (nocturno, fin de semana/festivo, prioritario)
--   total_paciente   = valor_servicio + desplazamiento + cargo_servicio − descuento
--   base_comision    = según ajuste 'commission_base':
--                        'service_amount'     → valor_servicio (predeterminado)
--                        'base_only'          → solo tarifa base
--                        'service_and_travel' → valor_servicio + desplazamiento
--   comision         = round(base_comision × %)
--   neto_profesional = valor_servicio + desplazamiento − comision
--   El cargo de servicio es ingreso de la plataforma; los descuentos los asume la
--   plataforma; las comisiones de pasarela son gasto de la plataforma.
--   Los servicios de salud se consideran excluidos de IVA (art. 476 E.T.) — validar con contador.
create or replace function public.compute_quote(
  p_prof uuid, p_care public.care_type, p_starts_at timestamptz, p_duration_min int,
  p_area uuid, p_promo text default null
) returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_tz        constant text := 'America/Bogota';
  pr          public.professional_profiles;
  v_local     timestamp := p_starts_at at time zone v_tz;
  v_tod       time := (p_starts_at at time zone v_tz)::time;
  v_dow       int := extract(dow from (p_starts_at at time zone v_tz));
  v_night_s   time := public.setting_text('night_start', '20:00')::time;
  v_night_e   time := public.setting_text('night_end', '06:00')::time;
  v_is_night  boolean;
  v_is_hol    boolean;
  v_is_wkd    boolean;
  v_hol_name  text;
  v_base      numeric;
  v_surch     jsonb := '[]'::jsonb;
  v_surch_tot numeric := 0;
  v_amt       numeric;
  r           public.pricing_rules;
  v_travel    numeric := 0;
  v_svc_fee   numeric := 0;
  v_disc      numeric := 0;
  v_disc_lbl  text;
  v_service   numeric;
  v_total     numeric;
  v_comm_pct  numeric;
  v_comm_rule text := public.setting_text('commission_base', 'service_amount');
  v_comm_base numeric;
  v_comm      numeric;
  v_lines     jsonb := '[]'::jsonb;
begin
  select * into pr from public.professional_profiles where user_id = p_prof;
  if pr.user_id is null then raise exception 'Profesional no encontrado.'; end if;
  if pr.approved_hourly_rate is null then raise exception 'El profesional aún no tiene una tarifa aprobada.'; end if;
  if p_duration_min is null or p_duration_min < 15 or p_duration_min > 480 then
    raise exception 'Duración inválida.';
  end if;

  v_base := public.round_cop(pr.approved_hourly_rate * p_duration_min / 60.0);
  v_lines := v_lines || jsonb_build_object('label', format('Consulta (%s min)', p_duration_min), 'amount', v_base);

  v_is_night := case when v_night_s > v_night_e then (v_tod >= v_night_s or v_tod < v_night_e)
                     else (v_tod >= v_night_s and v_tod < v_night_e) end;
  select name into v_hol_name from public.holidays where day = v_local::date;
  v_is_hol := v_hol_name is not null;
  v_is_wkd := v_dow in (0, 6);

  -- Recargo nocturno (se acumula con festivo/fin de semana)
  if v_is_night then
    r := public.pick_pricing_rule('night_surcharge', p_prof, pr.specialty_id, pr.category_id);
    v_amt := public.rule_amount(r, v_base);
    if v_amt > 0 then
      v_surch := v_surch || jsonb_build_object('code', 'night', 'label', 'Recargo nocturno' || case when r.value_type = 'percent' then format(' (%s%%)', r.value::numeric(6,0)) else '' end, 'amount', v_amt);
      v_surch_tot := v_surch_tot + v_amt;
    end if;
  end if;
  -- Festivo tiene prioridad sobre fin de semana (no se acumulan entre sí)
  if v_is_hol then
    r := public.pick_pricing_rule('holiday_surcharge', p_prof, pr.specialty_id, pr.category_id);
    v_amt := public.rule_amount(r, v_base);
    if v_amt > 0 then
      v_surch := v_surch || jsonb_build_object('code', 'holiday', 'label', 'Recargo festivo — ' || v_hol_name || case when r.value_type = 'percent' then format(' (%s%%)', r.value::numeric(6,0)) else '' end, 'amount', v_amt);
      v_surch_tot := v_surch_tot + v_amt;
    end if;
  elsif v_is_wkd then
    r := public.pick_pricing_rule('weekend_surcharge', p_prof, pr.specialty_id, pr.category_id);
    v_amt := public.rule_amount(r, v_base);
    if v_amt > 0 then
      v_surch := v_surch || jsonb_build_object('code', 'weekend', 'label', 'Recargo fin de semana' || case when r.value_type = 'percent' then format(' (%s%%)', r.value::numeric(6,0)) else '' end, 'amount', v_amt);
      v_surch_tot := v_surch_tot + v_amt;
    end if;
  end if;
  if p_care = 'priority' then
    r := public.pick_pricing_rule('priority_surcharge', p_prof, pr.specialty_id, pr.category_id);
    v_amt := public.rule_amount(r, v_base);
    if v_amt > 0 then
      v_surch := v_surch || jsonb_build_object('code', 'priority', 'label', 'Atención prioritaria' || case when r.value_type = 'percent' then format(' (%s%%)', r.value::numeric(6,0)) else '' end, 'amount', v_amt);
      v_surch_tot := v_surch_tot + v_amt;
    end if;
  end if;
  v_lines := v_lines || (select coalesce(jsonb_agg(jsonb_build_object('label', s ->> 'label', 'amount', (s ->> 'amount')::numeric)), '[]') from jsonb_array_elements(v_surch) s);
  v_service := v_base + v_surch_tot;

  -- Desplazamiento: tarifa de la zona + recargo adicional configurable
  if p_area is not null then
    select travel_fee into v_travel from public.service_areas where id = p_area;
    v_travel := coalesce(v_travel, 0);
  end if;
  r := public.pick_pricing_rule('travel_fee', p_prof, pr.specialty_id, pr.category_id);
  v_travel := v_travel + public.rule_amount(r, v_service);
  if v_travel > 0 then
    v_lines := v_lines || jsonb_build_object('label', 'Desplazamiento', 'amount', v_travel);
  end if;

  r := public.pick_pricing_rule('service_fee', p_prof, pr.specialty_id, pr.category_id);
  v_svc_fee := public.rule_amount(r, v_service);
  if v_svc_fee > 0 then
    v_lines := v_lines || jsonb_build_object('label', 'Cargo de servicio de la plataforma', 'amount', v_svc_fee);
  end if;

  r := public.pick_pricing_rule('discount', p_prof, pr.specialty_id, pr.category_id, p_promo);
  if r.id is not null then
    v_disc := least(public.rule_amount(r, v_service), v_service);
    v_disc_lbl := r.name;
    if v_disc > 0 then
      v_lines := v_lines || jsonb_build_object('label', 'Descuento: ' || r.name, 'amount', -v_disc);
    end if;
  end if;

  v_total := v_service + v_travel + v_svc_fee - v_disc;

  v_comm_pct := public.pick_commission_percent(p_prof, pr.specialty_id, pr.category_id, p_care);
  v_comm_base := case v_comm_rule
    when 'base_only' then v_base
    when 'service_and_travel' then v_service + v_travel
    else v_service end;
  v_comm := round(v_comm_base * v_comm_pct / 100.0);

  return jsonb_build_object(
    'currency', 'COP',
    'professional_id', p_prof,
    'care_type', p_care,
    'starts_at', p_starts_at,
    'duration_min', p_duration_min,
    'hourly_rate', pr.approved_hourly_rate,
    'base_amount', v_base,
    'surcharges', v_surch,
    'surcharges_amount', v_surch_tot,
    'travel_fee', v_travel,
    'service_fee', v_svc_fee,
    'discount_amount', v_disc,
    'discount_label', v_disc_lbl,
    'total_amount', v_total,
    'lines', v_lines,
    'is_night', v_is_night, 'is_weekend', v_is_wkd, 'is_holiday', v_is_hol,
    'commission_percent', v_comm_pct,
    'commission_base_rule', v_comm_rule,
    'commission_base_amount', v_comm_base,
    'commission_amount', v_comm,
    'professional_net_amount', v_service + v_travel - v_comm,
    'computed_at', now()
  );
end $$;

-- Cotización PÚBLICA: sin datos de comisión.
create or replace function public.get_price_quote(
  p_prof uuid, p_care public.care_type, p_starts_at timestamptz, p_duration_min int,
  p_area uuid default null, p_promo text default null
) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select public.compute_quote(p_prof, p_care, p_starts_at, p_duration_min, p_area, p_promo)
         - 'commission_percent' - 'commission_base_rule' - 'commission_base_amount'
         - 'commission_amount' - 'professional_net_amount'
  where exists (select 1 from public.professional_profiles where user_id = p_prof and status = 'approved');
$$;

-- ---------------------------------------------------------------- disponibilidad
create or replace function public.get_available_slots(
  p_prof uuid, p_from date, p_to date,
  p_care public.care_type default 'scheduled',
  p_duration_min int default null,
  p_exclude_appointment uuid default null
) returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_tz      constant text := 'America/Bogota';
  pr        public.professional_profiles;
  v_dur     int;
  v_gran    int := public.setting_int('slot_granularity_min', 30);
  v_min_at  timestamptz;
  v_max_at  timestamptz;
begin
  select * into pr from public.professional_profiles p
  where p.user_id = p_prof and p.status = 'approved'
    and exists (select 1 from public.users u where u.id = p.user_id and u.status = 'active');
  if pr.user_id is null then return; end if;

  v_dur := coalesce(p_duration_min, pr.default_duration_min);
  if p_care = 'priority' then
    v_min_at := now() + make_interval(mins => public.setting_int('priority_min_lead_min', 30));
    v_max_at := now() + make_interval(hours => public.setting_int('priority_window_hours', 8));
  else
    v_min_at := now() + make_interval(mins => public.setting_int('scheduled_min_lead_min', 120));
    v_max_at := now() + make_interval(days => public.setting_int('booking_max_days_ahead', 30));
  end if;

  return query
  with days as (
    select d::date as d from generate_series(p_from, least(p_to, p_from + 62), interval '1 day') d
  ), windows as (
    select distinct days.d, a.start_time, a.end_time
    from days join public.professional_availability a
      on a.professional_id = p_prof and a.is_active
     and a.weekday = extract(dow from days.d)
     and a.valid_from <= days.d and (a.valid_until is null or a.valid_until >= days.d)
  ), cand as (
    select distinct gs as s
    from windows w,
    lateral generate_series(
      (w.d + w.start_time) at time zone v_tz,
      ((w.d + w.end_time) at time zone v_tz) - make_interval(mins => v_dur),
      make_interval(mins => v_gran)) gs
  )
  select c.s, c.s + make_interval(mins => v_dur)
  from cand c
  where c.s >= v_min_at and c.s <= v_max_at
    and not exists (
      select 1 from public.availability_exceptions e
      where e.professional_id = p_prof
        and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(c.s, c.s + make_interval(mins => v_dur), '[)'))
    and not exists (
      select 1 from public.appointments ap
      where ap.professional_id = p_prof and ap.blocks_slot
        and (p_exclude_appointment is null or ap.id <> p_exclude_appointment)
        and ap.blocked_range && tstzrange(c.s, c.s + make_interval(mins => v_dur + pr.travel_buffer_min), '[)'))
  order by c.s;
end $$;

create or replace function public.slot_is_available(
  p_prof uuid, p_start timestamptz, p_duration_min int, p_care public.care_type,
  p_exclude_appointment uuid default null
) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.get_available_slots(
      p_prof, (p_start at time zone 'America/Bogota')::date, (p_start at time zone 'America/Bogota')::date,
      p_care, p_duration_min, p_exclude_appointment) s
    where s.starts_at = p_start
  );
$$;

-- Primer profesional disponible de una especialidad/categoría que cubra el área.
create or replace function public.find_first_available(
  p_category uuid, p_specialty uuid, p_care public.care_type, p_area uuid,
  p_from date, p_to date
) returns table (professional_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select p.user_id, s.starts_at, s.ends_at
  from public.professional_profiles p
  cross join lateral public.get_available_slots(p.user_id, p_from, p_to, p_care, null, null) s
  where p.status = 'approved'
    and (p_category is null or p.category_id = p_category)
    and (p_specialty is null or p.specialty_id = p_specialty)
    and (p_area is null or public.professional_covers_area(p.user_id, p_area))
  order by s.starts_at, p.rating_avg desc
  limit 20;
$$;

-- >>>>>>>>>> 20261021000005_booking_flow.sql
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

-- >>>>>>>>>> 20261021000006_payments_memberships.sql
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

-- >>>>>>>>>> 20261021000007_finance_admin.sql
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

-- >>>>>>>>>> 20261021000008_rls_views_grants.sql
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

-- >>>>>>>>>> 20261021000009_seed_base.sql
-- =============================================================================
-- Médico en Casa Palmira — 0009: datos base (NO incluye profesionales ni pacientes)
-- Todos los valores son iniciales/ilustrativos y el administrador puede modificarlos.
-- =============================================================================

insert into public.roles (id, name) values
  ('patient', 'Paciente'), ('professional', 'Profesional de la salud'), ('admin', 'Administrador');

insert into public.application_settings (key, value, description, is_public) values
  ('membership_required', 'true', 'Exigir membresía activa para solicitar citas', true),
  ('response_timeout_scheduled_min', '30', 'Minutos para que el profesional responda una consulta programada', true),
  ('response_timeout_priority_min', '15', 'Minutos para que el profesional responda una atención prioritaria', true),
  ('payment_hold_min', '20', 'Minutos que se reserva un horario mientras el paciente paga', true),
  ('processing_grace_min', '60', 'Minutos extra de espera para pagos en procesamiento (PSE)', false),
  ('reassignment_decision_hours', '12', 'Horas para que el paciente elija alternativa antes de la devolución automática', true),
  ('scheduled_min_lead_min', '120', 'Anticipación mínima (minutos) para consultas programadas', true),
  ('priority_min_lead_min', '30', 'Anticipación mínima (minutos) para atención prioritaria', true),
  ('priority_window_hours', '8', 'Ventana (horas) en la que se ofrecen horarios prioritarios', true),
  ('booking_max_days_ahead', '30', 'Días máximos de anticipación para reservar', true),
  ('slot_granularity_min', '30', 'Intervalo en minutos entre horarios ofrecidos', false),
  ('night_start', '"20:00"', 'Hora de inicio del recargo nocturno', true),
  ('night_end', '"06:00"', 'Hora de fin del recargo nocturno', true),
  ('commission_base', '"service_amount"', 'Base de la comisión: service_amount | base_only | service_and_travel', false),
  ('free_cancellation_hours', '24', 'Horas de anticipación para cancelar con devolución total', true),
  ('late_cancellation_refund_percent', '50', 'Porcentaje devuelto en cancelaciones tardías de citas confirmadas (validar con asesor legal)', true),
  ('payout_frequency', '"weekly"', 'Frecuencia de liquidación: weekly | biweekly | monthly', false),
  ('require_rethus_verification', 'true', 'Exigir verificación RETHUS antes de aprobar profesionales', false),
  ('support_contact', '{"email": "", "phone": "", "whatsapp": ""}', 'Datos de contacto de soporte (configurar antes del lanzamiento)', true),
  ('legal_entity', '{"name": "", "nit": "", "address": "", "city": "Palmira, Valle del Cauca"}', 'Razón social y NIT del responsable (configurar antes del lanzamiento)', true);

-- Categorías iniciales: visibles en el catálogo pero NO reservables hasta que el
-- administrador verifique los requisitos regulatorios de cada servicio domiciliario.
insert into public.service_categories (slug, name, description, icon, sort_order, regulatory_notes) values
  ('medicina-general', 'Medicina general', 'Valoración médica general en la comodidad de tu hogar.', 'stethoscope', 1,
   'Verificar: RETHUS del médico; inscripción en REPS del prestador responsable (profesional independiente o IPS) con servicio habilitado en modalidad domiciliaria (Res. 3100 de 2019); póliza de responsabilidad civil; manejo de historia clínica (Res. 1995 de 1999 y Ley 2015 de 2020) a cargo del prestador.'),
  ('fisioterapia', 'Fisioterapia', 'Sesiones de fisioterapia y rehabilitación a domicilio.', 'activity', 2,
   'Verificar: RETHUS del fisioterapeuta; habilitación del servicio domiciliario en REPS del prestador; alcance de las técnicas que pueden aplicarse en domicilio con seguridad.'),
  ('enfermeria', 'Enfermería', 'Cuidados y procedimientos básicos de enfermería en casa.', 'heart-pulse', 3,
   'Verificar: RETHUS (profesional o auxiliar según el caso); habilitación en REPS; definir qué procedimientos se ofrecen (p. ej. curaciones, toma de signos, administración de medicamentos con fórmula) y cuáles NO.'),
  ('odontologia', 'Odontología', 'Valoración odontológica en casa para quienes no pueden desplazarse.', 'smile', 4,
   'Precaución: la mayoría de procedimientos odontológicos requieren unidad odontológica, esterilización y condiciones de infraestructura que no existen en un domicilio. Habilitar solo actividades verificadas y permitidas en modalidad domiciliaria (p. ej. valoración/orientación).');

insert into public.specialties (category_id, slug, name, description, default_hourly_rate, default_duration_min)
select c.id, s.slug, s.name, s.description, s.rate, s.dur
from (values
  ('medicina-general', 'consulta-medicina-general', 'Consulta de medicina general', 'Valoración médica general a domicilio.', 100000, 60),
  ('fisioterapia', 'fisioterapia-domiciliaria', 'Fisioterapia domiciliaria', 'Sesión de fisioterapia en casa.', 80000, 60),
  ('enfermeria', 'enfermeria-basica', 'Enfermería domiciliaria', 'Cuidados básicos de enfermería en casa.', 60000, 60),
  ('odontologia', 'valoracion-odontologica', 'Valoración odontológica', 'Valoración y orientación odontológica en casa.', 90000, 30)
) as s(cat, slug, name, description, rate, dur)
join public.service_categories c on c.slug = s.cat;

-- Cobertura inicial: Palmira (comunas urbanas y algunos corregimientos).
-- Verificar la división político-administrativa vigente y completar barrios desde el panel.
with mun as (
  insert into public.service_areas (name, area_type, travel_fee) values ('Palmira', 'municipio', 10000) returning id
)
insert into public.service_areas (parent_id, name, area_type, travel_fee)
select mun.id, a.name, a.t::public.area_type, a.fee from mun, (values
  ('Comuna 1', 'comuna', 10000), ('Comuna 2', 'comuna', 10000), ('Comuna 3', 'comuna', 10000),
  ('Comuna 4', 'comuna', 10000), ('Comuna 5', 'comuna', 10000), ('Comuna 6', 'comuna', 10000),
  ('Comuna 7', 'comuna', 10000),
  ('Rozo', 'corregimiento', 20000), ('Amaime', 'corregimiento', 20000), ('La Torre', 'corregimiento', 20000),
  ('Tienda Nueva', 'corregimiento', 20000), ('Guanabanal', 'corregimiento', 20000), ('Potrerillo', 'corregimiento', 25000),
  ('Palmaseca', 'corregimiento', 20000), ('Matapalo', 'corregimiento', 20000)
) as a(name, t, fee);

insert into public.membership_plans (code, name, description, period_type, duration_days, price, sort_order) values
  ('mensual', 'Membresía mensual', 'Acceso al sistema de reservas durante 30 días. No incluye el valor de las consultas.', 'monthly', 30, 9900, 1),
  ('anual', 'Membresía anual', 'Acceso al sistema de reservas durante 365 días. No incluye el valor de las consultas.', 'annual', 365, 99000, 2);

insert into public.pricing_rules (name, rule_type, scope, value_type, value) values
  ('Recargo nocturno general', 'night_surcharge', 'global', 'percent', 30),
  ('Recargo fin de semana general', 'weekend_surcharge', 'global', 'percent', 15),
  ('Recargo festivo general', 'holiday_surcharge', 'global', 'percent', 20),
  ('Recargo atención prioritaria', 'priority_surcharge', 'global', 'percent', 25);

insert into public.commissions (name, scope, percent) values ('Comisión general', 'global', 20);

insert into public.holidays (day, name) values
  ('2026-01-01', 'Año Nuevo'), ('2026-01-12', 'Reyes Magos'), ('2026-03-23', 'San José'),
  ('2026-04-02', 'Jueves Santo'), ('2026-04-03', 'Viernes Santo'), ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-18', 'Ascensión del Señor'), ('2026-06-08', 'Corpus Christi'), ('2026-06-15', 'Sagrado Corazón de Jesús'),
  ('2026-06-29', 'San Pedro y San Pablo'), ('2026-07-20', 'Día de la Independencia'), ('2026-08-07', 'Batalla de Boyacá'),
  ('2026-08-17', 'Asunción de la Virgen'), ('2026-10-12', 'Día de la Diversidad Étnica y Cultural'),
  ('2026-11-02', 'Todos los Santos'), ('2026-11-16', 'Independencia de Cartagena'),
  ('2026-12-08', 'Inmaculada Concepción'), ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'), ('2027-01-11', 'Reyes Magos'), ('2027-03-22', 'San José'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'), ('2027-05-01', 'Día del Trabajo'),
  ('2027-05-10', 'Ascensión del Señor'), ('2027-05-31', 'Corpus Christi'), ('2027-06-07', 'Sagrado Corazón de Jesús'),
  ('2027-07-05', 'San Pedro y San Pablo'), ('2027-07-20', 'Día de la Independencia'), ('2027-08-07', 'Batalla de Boyacá'),
  ('2027-08-16', 'Asunción de la Virgen'), ('2027-10-18', 'Día de la Diversidad Étnica y Cultural'),
  ('2027-11-01', 'Todos los Santos'), ('2027-11-15', 'Independencia de Cartagena'),
  ('2027-12-08', 'Inmaculada Concepción'), ('2027-12-25', 'Navidad');

-- >>>>>>>>>> 20261021000010_storage.sql
-- =============================================================================
-- Médico en Casa Palmira — 0010: almacenamiento de archivos (Supabase Storage)
-- Rutas: <bucket>/<user_id>/<archivo>. Solo se ejecuta si existe el esquema storage.
-- =============================================================================
do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Esquema storage no existe: se omiten buckets (entorno sin Supabase).';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('professional-photos', 'professional-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
    ('professional-documents', 'professional-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
    ('payout-receipts', 'payout-receipts', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;

  -- Fotos: lectura pública; escritura solo en la carpeta propia.
  execute $p$create policy photos_owner_write on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy photos_owner_update on storage.objects for update to authenticated
    using (bucket_id = 'professional-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy photos_owner_delete on storage.objects for delete to authenticated
    using (bucket_id = 'professional-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy photos_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-photos' and public.is_admin())$p$;

  -- Documentos privados: el profesional ve y sube lo suyo; el administrador ve todo.
  execute $p$create policy docs_owner_read on storage.objects for select to authenticated
    using (bucket_id = 'professional-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy docs_owner_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;

  -- Comprobantes de liquidación: solo administrador escribe; el profesional lee su carpeta.
  execute $p$create policy receipts_read on storage.objects for select to authenticated
    using (bucket_id = 'payout-receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy receipts_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'payout-receipts' and public.is_admin())$p$;
end $outer$;

-- >>>>>>>>>> 20261021000011_cron.sql
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

-- >>>>>>>>>> 20261022000012_reviews_rating_trigger.sql
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

