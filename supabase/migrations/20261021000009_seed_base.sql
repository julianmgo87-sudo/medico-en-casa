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
