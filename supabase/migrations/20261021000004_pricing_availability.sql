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
