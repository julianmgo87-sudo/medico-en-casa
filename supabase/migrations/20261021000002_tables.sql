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
