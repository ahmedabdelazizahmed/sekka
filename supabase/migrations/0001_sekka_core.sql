-- Sekka — operations hub for a university student-transport company (demo, fictional data).
-- Principles
--  * The browser only holds the public anon key. Tables that hold personal data (students, subscriptions,
--    payments, requests, outbox, audit) have NO direct API access at all: everything goes through
--    SECURITY DEFINER functions that check the caller's role and write an audit trail.
--  * A bus (or a driver) can never be scheduled on two overlapping trips: enforced by exclusion constraints.
--  * Automations are idempotent (dedupe keys), so running them twice never double-sends a message.

create extension if not exists btree_gist;

-- ───────────────────────── staff & roles ─────────────────────────
create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','dispatcher','accountant')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── company settings (single row) ─────────────────────────
create table public.company_settings (
  id int primary key default 1 check (id = 1),
  name_ar text not null, name_en text not null,
  tagline_ar text not null default '', tagline_en text not null default '',
  phone text not null default '', whatsapp text not null default '', owner_phone text not null default '',
  term_code text not null, term_name_ar text not null, term_name_en text not null, term_start date not null, term_end date not null,
  next_term_code text, next_term_name_ar text, next_term_name_en text, next_term_start date, next_term_end date,
  operating_days int[] not null default '{6,0,1,2,3,4}',           -- 0=Sunday … 6=Saturday
  reminder_days int[] not null default '{14,7,1}',
  grace_days int not null default 7,
  delay_alert_minutes int not null default 10,
  low_load_pct int not null default 45, high_load_pct int not null default 95,
  planning_margin_pct int not null default 8, turnaround_min int not null default 20,
  whatsapp_enabled boolean not null default false,                  -- true only once the WhatsApp Business worker is connected
  demo_mode boolean not null default false,                         -- shows the simulation controls in the UI
  demo_shift_min int not null default 0,                            -- demo clock offset (always 0 in production)
  payment_note_ar text not null default '', payment_note_en text not null default '',
  site_url text not null default 'http://localhost:5173'
);

-- ───────────────────────── network ─────────────────────────
create table public.universities (id serial primary key, name_ar text not null, name_en text not null, city_ar text not null default '', city_en text not null default '');
create table public.routes (
  id serial primary key, code text not null unique, name_ar text not null, name_en text not null,
  university_id int not null references public.universities(id),
  term_price numeric(10,2) not null check (term_price >= 0), duration_min int not null check (duration_min between 10 and 300),
  is_active boolean not null default true
);
-- Stops are listed from the city to the university gate (the last seq). "to" trips follow seq ascending, "from" trips descending.
create table public.stops (
  id serial primary key, route_id int not null references public.routes(id) on delete cascade, seq int not null check (seq >= 1),
  name_ar text not null, name_en text not null, offset_min int not null check (offset_min >= 0),
  lat numeric(9,6) not null default 0, lng numeric(9,6) not null default 0,
  unique (route_id, seq)
);
create table public.slots (id serial primary key, direction text not null check (direction in ('to','from')), depart_time time not null, unique (direction, depart_time));

-- ───────────────────────── fleet ─────────────────────────
create table public.buses (
  id serial primary key, plate text not null unique, model text not null default '', year int, capacity int not null check (capacity > 0),
  odometer_km int not null default 0, service_interval_km int not null default 10000, last_service_km int not null default 0, last_service_on date,
  status text not null default 'active' check (status in ('active','workshop','retired'))
);
create table public.drivers (id serial primary key, full_name text not null, phone text not null default '', bus_id int unique references public.buses(id), is_active boolean not null default true);

-- ───────────────────────── students & money (no direct API access) ─────────────────────────
create sequence public.student_seq;
create table public.students (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('ST-' || lpad(nextval('public.student_seq')::text, 5, '0')),
  full_name text not null check (char_length(full_name) between 2 and 80),
  phone text not null, phone_norm text not null unique,
  lang text not null default 'ar' check (lang in ('ar','en')),
  university_id int not null references public.universities(id),
  route_id int not null references public.routes(id),
  stop_id int not null references public.stops(id),
  to_slot_id int not null references public.slots(id),
  from_slot_id int not null references public.slots(id),
  track_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
  term_code text not null, starts_on date not null, ends_on date not null, price numeric(10,2) not null check (price >= 0),
  status text not null default 'pending' check (status in ('pending','active','expired','cancelled')),
  due_on date, created_at timestamptz not null default now(), unique (student_id, term_code)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0), method text not null check (method in ('cash','instapay','vodafone_cash','bank')),
  reference text, received_by uuid, paid_at timestamptz not null default now()
);

-- ───────────────────────── trips ─────────────────────────
create table public.trips (
  id uuid primary key default gen_random_uuid(), trip_date date not null,
  slot_id int not null references public.slots(id), route_id int not null references public.routes(id),
  status text not null default 'planned' check (status in ('planned','running','completed','cancelled')),
  delay_minutes int not null default 0, enrolled int not null default 0, expected int not null default 0, unassigned_seats int not null default 0,
  starts_at timestamp not null, ends_at timestamp not null,
  driver_token text not null unique default replace(gen_random_uuid()::text, '-', ''), cancel_reason text,
  unique (trip_date, slot_id, route_id)
);
create table public.trip_buses (
  id serial primary key, trip_id uuid not null references public.trips(id) on delete cascade,
  bus_id int not null references public.buses(id), driver_id int references public.drivers(id),
  starts_at timestamp not null, ends_at timestamp not null,
  constraint bus_no_overlap    exclude using gist (bus_id with =, tsrange(starts_at, ends_at) with &&),
  constraint driver_no_overlap exclude using gist (driver_id with =, tsrange(starts_at, ends_at) with &&) where (driver_id is not null)
);
-- pos = position along the direction of travel (1 = departure stop … n = last stop)
create table public.trip_events (
  id serial primary key, trip_id uuid not null references public.trips(id) on delete cascade, pos int not null check (pos >= 1),
  at timestamp not null, delay_minutes int not null default 0, unique (trip_id, pos)
);
create table public.trip_positions (   -- real GPS pings sent from the driver's phone while sharing (demo: unused, the map interpolates between stop events)
  id bigserial primary key, trip_id uuid not null references public.trips(id) on delete cascade, lat numeric(9,6) not null, lng numeric(9,6) not null, at timestamp not null
);
create index on public.trip_positions (trip_id, at desc);
create table public.trip_ratings (
  trip_id uuid not null references public.trips(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade,
  rating int not null check (rating between 1 and 5), comment text, at timestamptz not null default now(), primary key (trip_id, student_id)
);
create table public.boardings (
  id serial primary key, trip_id uuid not null references public.trips(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade,
  at timestamp not null, unique (trip_id, student_id)
);

-- ───────────────────────── maintenance ─────────────────────────
create table public.bus_checks (
  id serial primary key, bus_id int not null references public.buses(id) on delete cascade, checked_on date not null, odometer_km int not null,
  brake_pad_pct numeric(5,1) not null, oil_life_pct numeric(5,1) not null, tire_depth_mm numeric(4,1) not null, engine_temp_c numeric(5,1) not null default 90,
  fault_codes int not null default 0, unique (bus_id, checked_on)
);
create table public.breakdowns (id serial primary key, bus_id int not null references public.buses(id) on delete cascade, happened_on date not null, kind text not null, delay_minutes int not null default 0, cost numeric(10,2) not null default 0);
create table public.maintenance_orders (
  id uuid primary key default gen_random_uuid(), bus_id int not null references public.buses(id) on delete cascade,
  kind text not null check (kind in ('routine','brakes','oil','tires','other')), reason text not null default '',
  status text not null default 'open' check (status in ('open','done')), created_by text not null default 'auto',
  created_at timestamptz not null default now(), scheduled_for date, done_on date, cost numeric(10,2)
);
create unique index one_open_order_per_bus on public.maintenance_orders (bus_id) where status = 'open';

-- ───────────────────────── requests, messages, audit ─────────────────────────
create table public.student_requests (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('stop_change','renewal','absence','complaint')), payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','done','rejected')),
  created_at timestamptz not null default now(), handled_by uuid, handled_at timestamptz, note text
);
create table public.outbox (
  id uuid primary key default gen_random_uuid(), kind text not null, student_id uuid references public.students(id) on delete set null,
  to_phone text not null, lang text not null default 'ar', body text not null,
  status text not null default 'queued' check (status in ('queued','sent','skipped')),
  dedupe_key text unique, created_at timestamptz not null default now()
);
create table public.audit_log (
  id bigserial primary key, at timestamptz not null default now(), staff_id uuid, staff_name text, action text not null, entity text not null, entity_id text, detail text
);
create table public.verify_attempts (id bigserial primary key, phone_norm text not null, at timestamptz not null default now(), ok boolean not null);
create index on public.verify_attempts (phone_norm, at);
create index on public.students (route_id, to_slot_id, from_slot_id);
create index on public.boardings (trip_id);
create index on public.trips (trip_date);

-- ───────────────────────── helpers ─────────────────────────
create function public.app_now() returns timestamp language sql stable security definer set search_path = public as
$$ select (now() at time zone 'Africa/Cairo') + make_interval(mins => coalesce((select demo_shift_min from company_settings where id = 1), 0)) $$;
create function public.app_today() returns date language sql stable security definer set search_path = public as $$ select public.app_now()::date $$;

-- Canonical phone: digits only; Egyptian local forms 01xxxxxxxxx / 002010… / +2010… all become 2010…
create function public.normalize_phone(p text) returns text language sql immutable as $$
  select case when d like '00%' then regexp_replace(d, '^00', '') when d ~ '^0[0-9]{9,10}$' then '20' || substr(d, 2) else d end
  from (select regexp_replace(coalesce(p,''), '[^0-9]', '', 'g') as d) s
$$;
create function public.mask_phone(p text) returns text language sql immutable as $$ select case when length(p) >= 8 then substr(p,1,4) || '****' || right(p,3) else '****' end $$;

create function public.staff_role() returns text language sql stable security definer set search_path = public as $$ select role from staff where id = auth.uid() $$;
create function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from staff where id = auth.uid()) $$;
create function public._need(variadic p_roles text[]) returns text language plpgsql stable security definer set search_path = public as $$
declare r text; begin
  select role into r from staff where id = auth.uid();
  if r is null or not (r = any(p_roles)) then raise exception 'forbidden'; end if;
  return r;
end $$;
create function public._audit(p_action text, p_entity text, p_id text, p_detail text default null) returns void language plpgsql security definer set search_path = public as $$
begin insert into audit_log (staff_id, staff_name, action, entity, entity_id, detail) values (auth.uid(), (select full_name from staff where id = auth.uid()), p_action, p_entity, p_id, p_detail); end $$;

-- students: normalise phone, validate stop/slots, audit columns
create function public._student_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.phone_norm := normalize_phone(new.phone);
  if new.phone_norm !~ '^20[0-9]{10}$' then raise exception 'invalid_phone'; end if;
  if not exists (select 1 from stops s where s.id = new.stop_id and s.route_id = new.route_id and s.seq < (select max(seq) from stops where route_id = new.route_id)) then raise exception 'invalid_stop'; end if;
  if not exists (select 1 from slots where id = new.to_slot_id and direction = 'to') or not exists (select 1 from slots where id = new.from_slot_id and direction = 'from') then raise exception 'invalid_slot'; end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger students_guard before insert or update on public.students for each row execute function public._student_guard();

-- ───────────────────────── row level security ─────────────────────────
alter table public.staff enable row level security;
alter table public.company_settings enable row level security;
alter table public.universities enable row level security;
alter table public.routes enable row level security;
alter table public.stops enable row level security;
alter table public.slots enable row level security;
alter table public.buses enable row level security;
alter table public.drivers enable row level security;
alter table public.students enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.trips enable row level security;
alter table public.trip_buses enable row level security;
alter table public.trip_events enable row level security;
alter table public.boardings enable row level security;
alter table public.trip_ratings enable row level security;
alter table public.trip_positions enable row level security;
alter table public.bus_checks enable row level security;
alter table public.breakdowns enable row level security;
alter table public.maintenance_orders enable row level security;
alter table public.student_requests enable row level security;
alter table public.outbox enable row level security;
alter table public.audit_log enable row level security;
alter table public.verify_attempts enable row level security;

create policy staff_self on public.staff for select to authenticated using (id = auth.uid());
-- public catalogue (what a student or a visitor may read): universities, routes, stops, slots. No write policies: the owner edits through functions.
create policy cat_u on public.universities for select to anon, authenticated using (true);
create policy cat_r on public.routes for select to anon, authenticated using (is_active);
create policy cat_s on public.stops for select to anon, authenticated using (true);
create policy cat_t on public.slots for select to anon, authenticated using (true);

-- A public view with only the safe company columns (owner_phone etc. stay private).
create view public.public_company as
  select name_ar, name_en, tagline_ar, tagline_en, phone, whatsapp, term_name_ar, term_name_en, term_start, term_end,
         next_term_name_ar, next_term_name_en, next_term_start, next_term_end, payment_note_ar, payment_note_en, demo_mode, site_url
  from public.company_settings where id = 1;

-- ═════════════════════════ trips: shared view (student tracking, driver, staff) ═════════════════════════
-- Builds the "parcel tracking" picture of one trip: every stop with scheduled / expected / actual time, where the bus is, and the phase.
create function public._trip_view(p_trip uuid, p_me_stop int default null, p_student uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t trips%rowtype; sl slots%rowtype; rt routes%rowtype; n int; me_pos int; last_pos int; stops_j jsonb; phase text; eta_me timestamp;
  nb int; idx int; v_plate text; v_driver text; now_ts timestamp := app_now(); lt timestamp; nt timestamp; frac numeric; pf numeric; gps jsonb; myr int;
begin
  select * into t from trips where id = p_trip; if not found then return null; end if;
  select * into sl from slots where id = t.slot_id;
  select * into rt from routes where id = t.route_id;
  select max(seq) into n from stops where route_id = t.route_id;
  select coalesce(max(pos), 0) into last_pos from trip_events where trip_id = t.id;
  if p_me_stop is not null then
    select case when sl.direction = 'to' then s.seq else n - s.seq + 1 end into me_pos from stops s where s.id = p_me_stop;
  end if;
  select jsonb_agg(jsonb_build_object('pos', x.pos, 'stop_id', x.id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'lat', x.lat, 'lng', x.lng,
           'sched', to_char(x.sched, 'HH24:MI'), 'eta', to_char(coalesce(ev.at, x.sched + make_interval(mins => t.delay_minutes)), 'HH24:MI'),
           'actual', to_char(ev.at, 'HH24:MI'), 'done', ev.id is not null, 'is_me', x.pos = me_pos) order by x.pos)
    into stops_j
  from (select s.*, case when sl.direction = 'to' then s.seq else n - s.seq + 1 end as pos,
               t.starts_at + make_interval(mins => case when sl.direction = 'to' then s.offset_min else rt.duration_min - s.offset_min end) as sched
        from stops s where s.route_id = t.route_id) x
  left join trip_events ev on ev.trip_id = t.id and ev.pos = x.pos;

  phase := case when t.status = 'cancelled' then 'cancelled' when t.status = 'completed' then 'done' when last_pos = 0 then 'planned'
                when me_pos is null then 'on_way' when last_pos = me_pos then 'arrived' when last_pos > me_pos then 'passed'
                when last_pos = me_pos - 1 then 'near' else 'on_way' end;
  if me_pos is not null then
    select coalesce(ev.at, x.sched + make_interval(mins => t.delay_minutes)) into eta_me
    from (select t.starts_at + make_interval(mins => case when sl.direction = 'to' then s.offset_min else rt.duration_min - s.offset_min end) as sched
          from stops s where s.id = p_me_stop) x
    left join trip_events ev on ev.trip_id = t.id and ev.pos = me_pos;
  end if;
  -- where is the bus right now? interpolate between the last stop it reached and the next one (the "Uber dot")
  if t.status = 'completed' then pf := n;
  elsif last_pos >= 1 and last_pos < n then
    select at into lt from trip_events where trip_id = t.id and pos = last_pos;
    select t.starts_at + make_interval(mins => case when sl.direction = 'to' then s.offset_min else rt.duration_min - s.offset_min end + t.delay_minutes) into nt
      from stops s where s.route_id = t.route_id and (case when sl.direction = 'to' then s.seq else n - s.seq + 1 end) = last_pos + 1;
    frac := case when nt is null or nt <= lt then 0.5 else least(0.97, greatest(0, extract(epoch from (now_ts - lt)) / extract(epoch from (nt - lt)))) end;
    pf := last_pos + frac;
  end if;
  select jsonb_build_object('lat', lat, 'lng', lng, 'age_s', round(extract(epoch from (now_ts - at)))::int) into gps
    from trip_positions where trip_id = t.id and at > now_ts - interval '2 minutes' order by at desc limit 1;
  if p_student is not null then select rating into myr from trip_ratings where trip_id = t.id and student_id = p_student; end if;
  select count(*) into nb from trip_buses where trip_id = t.id;
  if nb > 0 then
    idx := case when p_student is null then 0 else abs(hashtext(p_student::text)) % nb end;
    select b.plate, split_part(d.full_name, ' ', 1) into v_plate, v_driver
    from trip_buses tb join buses b on b.id = tb.bus_id left join drivers d on d.id = tb.driver_id where tb.trip_id = t.id order by tb.id offset idx limit 1;
  end if;
  return jsonb_build_object('trip_id', t.id, 'direction', sl.direction, 'time', to_char(sl.depart_time, 'HH24:MI'), 'date', t.trip_date,
    'status', t.status, 'phase', phase, 'delay_minutes', t.delay_minutes, 'plate', v_plate, 'driver_first', v_driver, 'stops', coalesce(stops_j, '[]'::jsonb),
    'me_pos', me_pos, 'last_pos', last_pos, 'n', n, 'eta_at', to_char(eta_me, 'HH24:MI'),
    'eta_min', case when eta_me is null then null else greatest(0, round(extract(epoch from (eta_me - now_ts)) / 60))::int end,
    'route_ar', rt.name_ar, 'route_en', rt.name_en, 'expected', t.expected, 'cancel_reason', t.cancel_reason,
    'pos_float', pf, 'gps', gps, 'my_rating', myr);
end $$;

-- Students who ride a given trip (active subscription covering the day), as rows.
create function public._trip_students(p_trip uuid) returns setof public.students language sql stable security definer set search_path = public as $$
  select st.* from trips t join slots sl on sl.id = t.slot_id
  join students st on st.route_id = t.route_id and st.status = 'active' and (case when sl.direction = 'to' then st.to_slot_id else st.from_slot_id end) = t.slot_id
  where t.id = p_trip and exists (select 1 from subscriptions sb where sb.student_id = st.id and sb.status = 'active' and t.trip_date between sb.starts_on and sb.ends_on)
$$;

-- Queue a message (idempotent through dedupe_key). Returns 1 when a new row was queued.
create function public._enqueue(p_kind text, p_student uuid, p_phone text, p_lang text, p_body text, p_key text) returns int language plpgsql security definer set search_path = public as $$
declare k int; begin
  insert into outbox (kind, student_id, to_phone, lang, body, dedupe_key) values (p_kind, p_student, p_phone, p_lang, p_body, p_key) on conflict (dedupe_key) do nothing;
  get diagnostics k = row_count; return k;
end $$;

-- Delay automation: tell every student who has not been passed yet, again for each extra ~5 minutes of delay.
create function public._notify_delay(p_trip uuid) returns int language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; cs company_settings%rowtype; s students%rowtype; v jsonb; k int := 0; bucket int; v_dir text; v_time text; msg text;
begin
  select * into t from trips where id = p_trip; select * into cs from company_settings where id = 1;
  if t.status not in ('planned','running') or t.delay_minutes < cs.delay_alert_minutes then return 0; end if;
  bucket := (t.delay_minutes / 5) * 5;
  for s in select * from _trip_students(p_trip) loop
    v := _trip_view(p_trip, s.stop_id, s.id);
    continue when v->>'phase' in ('passed','arrived','done','cancelled');
    v_dir := case when v->>'direction' = 'to' then 'ذهاب' else 'عودة' end; v_time := v->>'time';
    msg := case when s.lang = 'en' then format('Heads-up: your %s trip (%s) is running about %s min late. Expected at your stop: %s. Track it: %s/track/%s',
                  case when v->>'direction' = 'to' then 'morning' else 'return' end, v_time, t.delay_minutes, v->>'eta_at', cs.site_url, s.track_token)
           else format('تنبيه: رحلة %s الساعة %s متأخرة حوالي %s دقيقة. الوصول المتوقع لمحطتك %s. تابع الباص: %s/track/%s', v_dir, v_time, t.delay_minutes, v->>'eta_at', cs.site_url, s.track_token) end;
    k := k + _enqueue('trip_delay', s.id, s.phone, s.lang, msg, 'delay:' || p_trip || ':' || s.id || ':' || bucket);
  end loop;
  return k;
end $$;

-- ═════════════════════════ student-facing functions (no login: phone + student code, rate limited) ═════════════════════════
create function public._verify(p_phone text, p_code text, out sid uuid, out err text) language plpgsql security definer set search_path = public as $$
declare pn text := normalize_phone(p_phone);
begin
  delete from verify_attempts where at < now() - interval '1 day';
  if (select count(*) from verify_attempts where phone_norm = pn and not ok and at > now() - interval '15 minutes') >= 5 then err := 'try_later'; return; end if;
  select id into sid from students where phone_norm = pn and upper(code) = upper(trim(coalesce(p_code, ''))) and status = 'active';
  insert into verify_attempts (phone_norm, ok) values (pn, sid is not null);
  if sid is null then err := 'verification_failed'; end if;
end $$;

create function public.student_status(p_phone text, p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; s record; cs company_settings%rowtype; sub subscriptions%rowtype; nsub subscriptions%rowtype; paid numeric; npaid numeric; days_left int; open_req boolean;
begin
  select * into v from _verify(p_phone, p_code); if v.err is not null then return jsonb_build_object('error', v.err); end if;
  select * into cs from company_settings where id = 1;
  select st.id, st.code, st.full_name, st.lang, st.track_token, r.name_ar r_ar, r.name_en r_en, r.term_price, u.name_ar u_ar, u.name_en u_en,
         sp.id stop_id, sp.name_ar sp_ar, sp.name_en sp_en, to_char(ts.depart_time, 'HH24:MI') to_t, to_char(fs.depart_time, 'HH24:MI') from_t
    into s from students st join routes r on r.id = st.route_id join universities u on u.id = st.university_id join stops sp on sp.id = st.stop_id
    join slots ts on ts.id = st.to_slot_id join slots fs on fs.id = st.from_slot_id where st.id = v.sid;
  select * into sub from subscriptions where student_id = s.id and term_code = cs.term_code;
  paid := coalesce((select sum(amount) from payments where subscription_id = sub.id), 0);
  select * into nsub from subscriptions where student_id = s.id and term_code = cs.next_term_code;
  npaid := coalesce((select sum(amount) from payments where subscription_id = nsub.id), 0);
  days_left := case when sub.id is null then null else sub.ends_on - app_today() end;
  open_req := exists (select 1 from student_requests where student_id = s.id and kind = 'renewal' and status = 'open');
  return jsonb_build_object('ok', true, 'today', app_today(),
    'student', jsonb_build_object('first_name', split_part(s.full_name, ' ', 1), 'code', s.code, 'lang', s.lang),
    'route', jsonb_build_object('name_ar', s.r_ar, 'name_en', s.r_en, 'price', s.term_price, 'university_ar', s.u_ar, 'university_en', s.u_en),
    'stop', jsonb_build_object('id', s.stop_id, 'name_ar', s.sp_ar, 'name_en', s.sp_en), 'to_time', s.to_t, 'from_time', s.from_t,
    'subscription', case when sub.id is null then null else jsonb_build_object('status', sub.status, 'ends_on', sub.ends_on, 'price', sub.price, 'paid', paid, 'balance', sub.price - paid, 'days_left', days_left, 'term_ar', cs.term_name_ar, 'term_en', cs.term_name_en) end,
    'renewal', jsonb_build_object('term_ar', cs.next_term_name_ar, 'term_en', cs.next_term_name_en, 'price', s.term_price, 'requested', nsub.id is not null or open_req,
        'status', nsub.status, 'paid', npaid, 'balance', case when nsub.id is null then s.term_price else nsub.price - npaid end, 'reference', 'RN-' || substr(s.code, 4)),
    'track_token', s.track_token,
    'company', (select jsonb_build_object('name_ar', name_ar, 'name_en', name_en, 'phone', phone, 'whatsapp', whatsapp, 'payment_note_ar', payment_note_ar, 'payment_note_en', payment_note_en) from company_settings where id = 1));
end $$;

-- Student requests: stop_change {stop_id}, absence {date, note}, complaint {text}, renewal {}.
create function public.student_request(p_phone text, p_code text, p_kind text, p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; s students%rowtype; cs company_settings%rowtype; price numeric; sub subscriptions%rowtype; txt text; d date; rid uuid;
begin
  select * into v from _verify(p_phone, p_code); if v.err is not null then return jsonb_build_object('error', v.err); end if;
  select * into s from students where id = v.sid; select * into cs from company_settings where id = 1;
  if (select count(*) from student_requests where student_id = s.id and status = 'open') >= 6 then return jsonb_build_object('error', 'too_many_requests'); end if;
  if p_kind = 'stop_change' then
    if not exists (select 1 from stops where id = (p_payload->>'stop_id')::int and route_id = s.route_id and seq < (select max(seq) from stops where route_id = s.route_id)) then return jsonb_build_object('error', 'invalid_stop'); end if;
    if (p_payload->>'stop_id')::int = s.stop_id then return jsonb_build_object('error', 'same_stop'); end if;
    if exists (select 1 from student_requests where student_id = s.id and kind = 'stop_change' and status = 'open') then return jsonb_build_object('error', 'already_requested'); end if;
    insert into student_requests (student_id, kind, payload) values (s.id, p_kind, jsonb_build_object('stop_id', (p_payload->>'stop_id')::int)) returning id into rid;
  elsif p_kind = 'absence' then
    d := coalesce(nullif(p_payload->>'date', '')::date, app_today());
    if d < app_today() or d > app_today() + 30 then return jsonb_build_object('error', 'invalid_date'); end if;
    insert into student_requests (student_id, kind, payload) values (s.id, p_kind, jsonb_build_object('date', d, 'note', left(coalesce(p_payload->>'note', ''), 140))) returning id into rid;
  elsif p_kind = 'complaint' then
    txt := trim(coalesce(p_payload->>'text', ''));
    if char_length(txt) < 3 then return jsonb_build_object('error', 'invalid_text'); end if;
    insert into student_requests (student_id, kind, payload) values (s.id, p_kind, jsonb_build_object('text', left(txt, 300))) returning id into rid;
  elsif p_kind = 'renewal' then
    if cs.next_term_code is null then return jsonb_build_object('error', 'renewal_closed'); end if;
    select term_price into price from routes where id = s.route_id;
    insert into subscriptions (student_id, term_code, starts_on, ends_on, price, status, due_on) values (s.id, cs.next_term_code, cs.next_term_start, cs.next_term_end, price, 'pending', cs.term_end)
      on conflict (student_id, term_code) do nothing;
    if not exists (select 1 from student_requests where student_id = s.id and kind = 'renewal' and status = 'open') then
      insert into student_requests (student_id, kind, payload) values (s.id, p_kind, '{}'::jsonb) returning id into rid;
    end if;
    return jsonb_build_object('ok', true, 'amount', price, 'reference', 'RN-' || substr(s.code, 4), 'term_ar', cs.next_term_name_ar, 'term_en', cs.next_term_name_en);
  else return jsonb_build_object('error', 'invalid_kind'); end if;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

-- The parcel-tracking page: a private link per student, shows only his own trips today.
create function public.track_by_token(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s students%rowtype; trips_j jsonb; cs company_settings%rowtype;
begin
  select * into s from students where track_token = p_token and status = 'active'; if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into cs from company_settings where id = 1;
  select jsonb_agg(_trip_view(t.id, s.stop_id, s.id) order by sl.depart_time) into trips_j
  from trips t join slots sl on sl.id = t.slot_id
  where t.trip_date = app_today() and t.route_id = s.route_id and t.slot_id in (s.to_slot_id, s.from_slot_id);
  return jsonb_build_object('ok', true, 'first_name', split_part(s.full_name, ' ', 1), 'now', to_char(app_now(), 'HH24:MI'), 'trips', coalesce(trips_j, '[]'::jsonb),
    'company', jsonb_build_object('name_ar', cs.name_ar, 'name_en', cs.name_en, 'phone', cs.phone),
    'active', exists (select 1 from subscriptions sb where sb.student_id = s.id and sb.status = 'active' and app_today() between sb.starts_on and sb.ends_on));
end $$;

-- ═════════════════════════ driver functions (private link per trip) ═════════════════════════
create function public._trip_by_token(p_token text) returns trips language sql stable security definer set search_path = public as $$ select * from trips where driver_token = p_token $$;

create function public.driver_trip(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t trips%rowtype; v jsonb; last_pos int; nxt int; counts jsonb; sts jsonb;
begin
  t := _trip_by_token(p_token); if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  v := _trip_view(t.id); last_pos := (v->>'last_pos')::int; nxt := last_pos + 1;
  select jsonb_object_agg(x.stop_id::text, x.c) into counts from (select s.stop_id, count(*) c from _trip_students(t.id) s group by s.stop_id) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'first_name', split_part(s.full_name, ' ', 1), 'boarded', exists (select 1 from boardings b where b.trip_id = t.id and b.student_id = s.id)) order by s.full_name), '[]'::jsonb) into sts
  from _trip_students(t.id) s join stops sp on sp.id = s.stop_id join slots sl on sl.id = t.slot_id
  where (case when sl.direction = 'to' then sp.seq else (v->>'n')::int - sp.seq + 1 end) = nxt;
  return v || jsonb_build_object('counts', coalesce(counts, '{}'::jsonb), 'next_students', sts, 'boarded', (select count(*) from boardings where trip_id = t.id));
end $$;

create function public.driver_start(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; d int;
begin
  t := _trip_by_token(p_token); if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if t.status <> 'planned' then return jsonb_build_object('error', 'invalid_state'); end if;
  d := greatest(0, round(extract(epoch from (app_now() - t.starts_at)) / 60)::int);
  insert into trip_events (trip_id, pos, at, delay_minutes) values (t.id, 1, app_now(), d);
  update trips set status = 'running', delay_minutes = d where id = t.id;
  perform _notify_delay(t.id);
  return jsonb_build_object('ok', true, 'delay_minutes', d);
end $$;

create function public.driver_arrive(p_token text, p_pos int) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; v jsonb; sched time; d int; n int; notified int := 0;
begin
  t := _trip_by_token(p_token); if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if t.status <> 'running' then return jsonb_build_object('error', 'invalid_state'); end if;
  v := _trip_view(t.id); n := (v->>'n')::int;
  if p_pos <> (v->>'last_pos')::int + 1 or p_pos > n then return jsonb_build_object('error', 'invalid_pos'); end if;
  select (x->>'sched')::time into sched from jsonb_array_elements(v->'stops') x where (x->>'pos')::int = p_pos;
  d := greatest(0, round(extract(epoch from (app_now()::time - sched)) / 60)::int);
  insert into trip_events (trip_id, pos, at, delay_minutes) values (t.id, p_pos, app_now(), d);
  update trips set delay_minutes = d, status = case when p_pos = n then 'completed' else 'running' end where id = t.id;
  if p_pos < n then notified := _notify_delay(t.id); end if;
  return jsonb_build_object('ok', true, 'delay_minutes', d, 'notified', notified, 'done', p_pos = n);
end $$;

create function public.driver_board(p_token text, p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; s students%rowtype;
begin
  t := _trip_by_token(p_token); if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if t.status not in ('planned','running') then return jsonb_build_object('error', 'invalid_state'); end if;
  select * into s from _trip_students(t.id) where upper(code) = upper(trim(coalesce(p_code, ''))) limit 1;
  if s.id is null then return jsonb_build_object('error', 'not_on_trip'); end if;
  insert into boardings (trip_id, student_id, at) values (t.id, s.id, app_now()) on conflict do nothing;
  return jsonb_build_object('ok', true, 'first_name', split_part(s.full_name, ' ', 1));
end $$;

-- Driver phone shares GPS while the trip runs (production path; the demo map interpolates instead).
create function public.driver_ping(p_token text, p_lat numeric, p_lng numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype;
begin
  t := _trip_by_token(p_token); if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if t.status <> 'running' then return jsonb_build_object('error', 'invalid_state'); end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then return jsonb_build_object('error', 'invalid_position'); end if;
  insert into trip_positions (trip_id, lat, lng, at) values (t.id, p_lat, p_lng, app_now());
  delete from trip_positions where trip_id = t.id and at < app_now() - interval '10 minutes';   -- keep almost nothing: location is only needed while the trip runs
  return jsonb_build_object('ok', true);
end $$;

-- Rate a finished trip (1-5) from the private tracking link.
create function public.rate_trip(p_token text, p_trip uuid, p_rating int, p_comment text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare s students%rowtype; t trips%rowtype;
begin
  select * into s from students where track_token = p_token and status = 'active'; if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into t from trips where id = p_trip;
  if t.id is null or t.status <> 'completed' or t.route_id <> s.route_id or t.slot_id not in (s.to_slot_id, s.from_slot_id) then return jsonb_build_object('error', 'not_rateable'); end if;
  if p_rating not between 1 and 5 then return jsonb_build_object('error', 'invalid_rating'); end if;
  insert into trip_ratings (trip_id, student_id, rating, comment) values (t.id, s.id, p_rating, left(nullif(trim(coalesce(p_comment, '')), ''), 200))
    on conflict (trip_id, student_id) do update set rating = excluded.rating, comment = excluded.comment, at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════════════════ predictive maintenance (transparent statistics, no black box) ═════════════════════════
-- Score 0-100 from: km since last service, brake-pad wear TREND (linear regression of the last checks → days left before the safety limit),
-- oil life, tyre depth, engine temperature, fault codes and breakdown history. Every point comes with a reason a human can read.
create function public.bus_risk(p_bus int) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b buses%rowtype; c bus_checks%rowtype; slope numeric; kmday numeric; n int; km_since int; ratio numeric; score int := 0; rs jsonb := '[]'::jsonb;
        brake_days int; faults int; bd int; lvl text; today date := app_today(); km_left int;
begin
  select * into b from buses where id = p_bus; if not found then return null; end if;
  select * into c from bus_checks where bus_id = p_bus order by checked_on desc limit 1;
  km_since := b.odometer_km - b.last_service_km; ratio := km_since::numeric / nullif(b.service_interval_km, 0); km_left := b.service_interval_km - km_since;
  if ratio >= 1 then score := score + 35; rs := rs || jsonb_build_array(jsonb_build_object('code', 'service_overdue', 'km', km_since - b.service_interval_km, 'w', 35));
  elsif ratio >= 0.8 then score := score + 20; rs := rs || jsonb_build_array(jsonb_build_object('code', 'service_due', 'km', km_left, 'w', 20));
  elsif ratio >= 0.6 then score := score + 8; rs := rs || jsonb_build_array(jsonb_build_object('code', 'service_soon', 'km', km_left, 'w', 8)); end if;
  if c.id is not null then
    select regr_slope(brake_pad_pct, odometer_km), (max(odometer_km) - min(odometer_km))::numeric / greatest(1, max(checked_on) - min(checked_on)), count(*)
      into slope, kmday, n from bus_checks where bus_id = p_bus and checked_on >= today - 21;
    if slope is not null and slope < 0 and n >= 3 and coalesce(kmday, 0) > 0 then brake_days := ceil(((c.brake_pad_pct - 15) / -slope) / kmday)::int; end if;
    if c.brake_pad_pct <= 20 then score := score + 35; rs := rs || jsonb_build_array(jsonb_build_object('code', 'brakes_low', 'pct', c.brake_pad_pct, 'w', 35));
    elsif brake_days is not null and brake_days <= 7 then score := score + 35; rs := rs || jsonb_build_array(jsonb_build_object('code', 'brakes_days', 'days', greatest(brake_days, 0), 'w', 35));
    elsif brake_days is not null and brake_days <= 21 then score := score + 22; rs := rs || jsonb_build_array(jsonb_build_object('code', 'brakes_days', 'days', brake_days, 'w', 22));
    elsif brake_days is not null and brake_days <= 45 then score := score + 10; rs := rs || jsonb_build_array(jsonb_build_object('code', 'brakes_days', 'days', brake_days, 'w', 10)); end if;
    if c.oil_life_pct <= 10 then score := score + 15; rs := rs || jsonb_build_array(jsonb_build_object('code', 'oil_low', 'pct', c.oil_life_pct, 'w', 15));
    elsif c.oil_life_pct <= 25 then score := score + 8; rs := rs || jsonb_build_array(jsonb_build_object('code', 'oil_low', 'pct', c.oil_life_pct, 'w', 8)); end if;
    if c.tire_depth_mm <= 2.0 then score := score + 15; rs := rs || jsonb_build_array(jsonb_build_object('code', 'tires_low', 'mm', c.tire_depth_mm, 'w', 15));
    elsif c.tire_depth_mm <= 3.0 then score := score + 7; rs := rs || jsonb_build_array(jsonb_build_object('code', 'tires_low', 'mm', c.tire_depth_mm, 'w', 7)); end if;
    if c.engine_temp_c > 105 then score := score + 10; rs := rs || jsonb_build_array(jsonb_build_object('code', 'engine_hot', 'c', c.engine_temp_c, 'w', 10)); end if;
  end if;
  select coalesce(sum(fault_codes), 0) into faults from bus_checks where bus_id = p_bus and checked_on >= greatest(today - 14, coalesce(b.last_service_on, today - 14));   -- faults before the last service are fixed
  if faults >= 3 then score := score + 15; rs := rs || jsonb_build_array(jsonb_build_object('code', 'faults', 'n', faults, 'w', 15));
  elsif faults >= 1 then score := score + 7; rs := rs || jsonb_build_array(jsonb_build_object('code', 'faults', 'n', faults, 'w', 7)); end if;
  select count(*) into bd from breakdowns where bus_id = p_bus and happened_on >= today - 90;
  if bd >= 2 then score := score + 10; rs := rs || jsonb_build_array(jsonb_build_object('code', 'breakdowns', 'n', bd, 'w', 10));
  elsif bd = 1 then score := score + 4; rs := rs || jsonb_build_array(jsonb_build_object('code', 'breakdowns', 'n', bd, 'w', 4)); end if;
  score := least(100, score);
  lvl := case when score >= 60 then 'urgent' when score >= 35 then 'soon' when score >= 15 then 'watch' else 'ok' end;
  return jsonb_build_object('bus_id', b.id, 'plate', b.plate, 'score', score, 'level', lvl, 'brake_days', brake_days, 'km_since_service', km_since, 'km_left', km_left,
    'reasons', coalesce((select jsonb_agg(x order by (x->>'w')::int desc) from jsonb_array_elements(rs) x), '[]'::jsonb));
end $$;

create function public.staff_fleet() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _need('owner', 'dispatcher');
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'plate', b.plate, 'model', b.model, 'year', b.year, 'capacity', b.capacity, 'status', b.status, 'odometer_km', b.odometer_km,
      'driver', (select split_part(d.full_name, ' ', 1) from drivers d where d.bus_id = b.id and d.is_active), 'risk', bus_risk(b.id),
      'order', (select jsonb_build_object('id', o.id, 'kind', o.kind, 'reason', o.reason, 'created_by', o.created_by, 'scheduled_for', o.scheduled_for) from maintenance_orders o where o.bus_id = b.id and o.status = 'open'),
      'checks', (select coalesce(jsonb_agg(jsonb_build_object('on', c.checked_on, 'brake', c.brake_pad_pct, 'km', c.odometer_km) order by c.checked_on), '[]'::jsonb) from (select * from bus_checks where bus_id = b.id order by checked_on desc limit 12) c))
    order by (bus_risk(b.id)->>'score')::int desc, b.plate) from buses b where b.status <> 'retired'), '[]'::jsonb);
end $$;

create function public.staff_create_order(p_bus int, p_kind text, p_reason text default '', p_date date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  perform _need('owner', 'dispatcher');
  if exists (select 1 from maintenance_orders where bus_id = p_bus and status = 'open') then return jsonb_build_object('error', 'order_exists'); end if;
  insert into maintenance_orders (bus_id, kind, reason, created_by, scheduled_for) values (p_bus, p_kind, left(coalesce(p_reason, ''), 200), coalesce((select full_name from staff where id = auth.uid()), 'staff'), coalesce(p_date, app_today() + 2)) returning maintenance_orders.id into id;
  perform _audit('create_order', 'bus', p_bus::text, p_kind);
  return jsonb_build_object('ok', true, 'id', id);
end $$;

create function public.staff_complete_order(p_id uuid, p_cost numeric default 0) returns jsonb language plpgsql security definer set search_path = public as $$
declare o maintenance_orders%rowtype; b buses%rowtype; c bus_checks%rowtype;
begin
  perform _need('owner', 'dispatcher');
  select * into o from maintenance_orders where id = p_id and status = 'open'; if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into b from buses where id = o.bus_id; select * into c from bus_checks where bus_id = b.id order by checked_on desc limit 1;
  update maintenance_orders set status = 'done', done_on = app_today(), cost = p_cost where id = p_id;
  update buses set last_service_km = odometer_km, last_service_on = app_today(), status = 'active' where id = b.id;
  insert into bus_checks (bus_id, checked_on, odometer_km, brake_pad_pct, oil_life_pct, tire_depth_mm, engine_temp_c, fault_codes)
    values (b.id, app_today(), b.odometer_km, case when o.kind in ('brakes','routine') then 100 else coalesce(c.brake_pad_pct, 100) end,
            case when o.kind in ('oil','routine') then 100 else coalesce(c.oil_life_pct, 100) end, case when o.kind = 'tires' then 9.0 else coalesce(c.tire_depth_mm, 9) end, 88, 0)
    on conflict (bus_id, checked_on) do update set brake_pad_pct = excluded.brake_pad_pct, oil_life_pct = excluded.oil_life_pct, tire_depth_mm = excluded.tire_depth_mm, engine_temp_c = 88, fault_codes = 0;
  perform _audit('complete_order', 'bus', b.id::text, o.kind);
  return jsonb_build_object('ok', true);
end $$;

create function public.staff_add_check(p_bus int, p_km int, p_brake numeric, p_oil numeric, p_tire numeric, p_temp numeric default 90, p_faults int default 0) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _need('owner', 'dispatcher');
  if p_brake not between 0 and 100 or p_oil not between 0 and 100 or p_tire not between 0 and 30 or p_km < 0 then return jsonb_build_object('error', 'invalid_values'); end if;
  insert into bus_checks (bus_id, checked_on, odometer_km, brake_pad_pct, oil_life_pct, tire_depth_mm, engine_temp_c, fault_codes) values (p_bus, app_today(), p_km, p_brake, p_oil, p_tire, p_temp, p_faults)
    on conflict (bus_id, checked_on) do update set odometer_km = excluded.odometer_km, brake_pad_pct = excluded.brake_pad_pct, oil_life_pct = excluded.oil_life_pct, tire_depth_mm = excluded.tire_depth_mm, engine_temp_c = excluded.engine_temp_c, fault_codes = excluded.fault_codes;
  update buses set odometer_km = greatest(odometer_km, p_km) where id = p_bus;
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════════════════ planning: demand forecast + automatic bus assignment ═════════════════════════
-- Expected riders = enrolled × historical attendance for the same route, slot and weekday (falls back to all days, then to 85%).
create function public.attendance_rate(p_route int, p_slot int, p_date date) returns numeric language plpgsql stable security definer set search_path = public as $$
declare r numeric; k int;
begin
  select avg(b.c::numeric / nullif(t.enrolled, 0)), count(*) into r, k from trips t, lateral (select count(*) c from boardings where trip_id = t.id) b
   where t.route_id = p_route and t.slot_id = p_slot and t.status = 'completed' and t.trip_date < p_date and t.trip_date >= p_date - 56 and extract(dow from t.trip_date) = extract(dow from p_date);
  if k >= 3 then return least(1, greatest(0.2, r)); end if;
  select avg(b.c::numeric / nullif(t.enrolled, 0)), count(*) into r, k from trips t, lateral (select count(*) c from boardings where trip_id = t.id) b
   where t.route_id = p_route and t.slot_id = p_slot and t.status = 'completed' and t.trip_date < p_date and t.trip_date >= p_date - 56;
  if k >= 3 then return least(1, greatest(0.2, r)); end if;
  return 0.85;
end $$;

create function public._plan_day(p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare cs company_settings%rowtype; r record; v_enrolled int; v_exp int; v_need int; v_start timestamp; v_end timestamp; t uuid; remaining int; bus record; drv int;
        n_trips int := 0; n_assigned int := 0; short int := 0; buses_used int[] := '{}'; urg int[];
begin
  select * into cs from company_settings where id = 1;
  if not (extract(dow from p_date)::int = any (cs.operating_days)) then return jsonb_build_object('operating', false); end if;
  select coalesce(array_agg(id), '{}') into urg from buses where status = 'active' and (bus_risk(id)->>'score')::int >= 60;   -- risky buses are used last
  for r in select rt.id route_id, rt.duration_min, sl.id slot_id, sl.direction, sl.depart_time from routes rt cross join slots sl where rt.is_active order by (p_date + sl.depart_time), rt.id loop
    select count(*) into v_enrolled from students st where st.status = 'active' and st.route_id = r.route_id
      and (case when r.direction = 'to' then st.to_slot_id else st.from_slot_id end) = r.slot_id
      and exists (select 1 from subscriptions sb where sb.student_id = st.id and sb.status = 'active' and p_date between sb.starts_on and sb.ends_on);
    continue when v_enrolled = 0;
    v_exp := least(v_enrolled, ceil(v_enrolled * attendance_rate(r.route_id, r.slot_id, p_date))::int);
    v_need := least(v_enrolled, ceil(v_exp * (1 + cs.planning_margin_pct / 100.0))::int);
    v_start := p_date + r.depart_time; v_end := v_start + make_interval(mins => r.duration_min + cs.turnaround_min);
    t := null;
    insert into trips (trip_date, slot_id, route_id, enrolled, expected, starts_at, ends_at) values (p_date, r.slot_id, r.route_id, v_enrolled, v_exp, v_start, v_end)
      on conflict (trip_date, slot_id, route_id) do update set enrolled = excluded.enrolled, expected = excluded.expected, starts_at = excluded.starts_at, ends_at = excluded.ends_at where trips.status = 'planned'
      returning id into t;
    continue when t is null;                       -- already running / completed: never touch it
    n_trips := n_trips + 1;
    delete from trip_buses where trip_id = t;
    remaining := v_need;
    while remaining > 0 loop
      select b.id, b.capacity into bus from buses b
       where b.status = 'active' and not exists (select 1 from trip_buses tb where tb.bus_id = b.id and tsrange(tb.starts_at, tb.ends_at) && tsrange(v_start, v_end))
       order by (b.id = any (urg)), (b.capacity >= remaining) desc, case when b.capacity >= remaining then b.capacity end asc, b.capacity desc, b.id limit 1;
      exit when not found;
      select d.id into drv from drivers d where d.bus_id = bus.id and d.is_active and not exists (select 1 from trip_buses tb where tb.driver_id = d.id and tsrange(tb.starts_at, tb.ends_at) && tsrange(v_start, v_end));
      insert into trip_buses (trip_id, bus_id, driver_id, starts_at, ends_at) values (t, bus.id, drv, v_start, v_end);
      remaining := remaining - bus.capacity; n_assigned := n_assigned + 1; buses_used := buses_used || bus.id;
    end loop;
    update trips set unassigned_seats = greatest(remaining, 0) where id = t;
    if remaining > 0 then short := short + remaining; end if;
  end loop;
  return jsonb_build_object('operating', true, 'trips', n_trips, 'assignments', n_assigned, 'buses_used', (select count(distinct x) from unnest(buses_used) x), 'shortfall_seats', short);
end $$;

create function public.plan_day(p_date date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, app_today()); res jsonb;
begin
  perform _need('owner', 'dispatcher');
  if d < app_today() - 1 or d > app_today() + 14 then return jsonb_build_object('error', 'invalid_date'); end if;
  res := _plan_day(d);
  perform _audit('plan_day', 'trips', d::text, res::text);
  return res;
end $$;

create function public.staff_trips(p_date date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, app_today());
begin
  perform _need('owner', 'dispatcher');
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'time', to_char(sl.depart_time, 'HH24:MI'), 'direction', sl.direction, 'route_id', rt.id, 'route_ar', rt.name_ar, 'route_en', rt.name_en,
      'status', t.status, 'delay_minutes', t.delay_minutes, 'enrolled', t.enrolled, 'expected', t.expected, 'unassigned_seats', t.unassigned_seats, 'driver_token', t.driver_token,
      'capacity', coalesce((select sum(b.capacity) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id), 0),
      'buses', (select coalesce(jsonb_agg(jsonb_build_object('plate', b.plate, 'capacity', b.capacity, 'driver', split_part(d2.full_name, ' ', 1)) order by tb.id), '[]'::jsonb) from trip_buses tb join buses b on b.id = tb.bus_id left join drivers d2 on d2.id = tb.driver_id where tb.trip_id = t.id),
      'boarded', (select count(*) from boardings where trip_id = t.id), 'last_pos', (select coalesce(max(pos), 0) from trip_events where trip_id = t.id),
      'n', (select max(seq) from stops where route_id = rt.id), 'rating', (select round(avg(rating), 1) from trip_ratings where trip_id = t.id))
    order by sl.depart_time, rt.id) from trips t join slots sl on sl.id = t.slot_id join routes rt on rt.id = t.route_id where t.trip_date = d), '[]'::jsonb);
end $$;

-- Live board: every trip that has started today (or that is about to), with the "Uber dot" position.
create function public.staff_live() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _need('owner', 'dispatcher');
  return coalesce((select jsonb_agg(_trip_view(t.id) || jsonb_build_object('route_id', t.route_id, 'notified', (select count(*) from outbox o where o.kind = 'trip_delay' and o.dedupe_key like 'delay:' || t.id || ':%'),
       'enrolled', t.enrolled, 'buses', (select coalesce(jsonb_agg(b.plate order by tb.id), '[]'::jsonb) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id)) order by t.starts_at)
    from trips t where t.trip_date = app_today() and (t.status = 'running' or (t.status = 'planned' and t.starts_at between app_now() - interval '15 minutes' and app_now() + interval '45 minutes'))), '[]'::jsonb);
end $$;

create function public.staff_set_delay(p_trip uuid, p_minutes int, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare k int;
begin
  perform _need('owner', 'dispatcher');
  if p_minutes not between 0 and 240 then return jsonb_build_object('error', 'invalid_delay'); end if;
  update trips set delay_minutes = p_minutes where id = p_trip and status in ('planned','running');
  if not found then return jsonb_build_object('error', 'invalid_state'); end if;
  k := _notify_delay(p_trip);
  perform _audit('set_delay', 'trip', p_trip::text, p_minutes || ' min ' || coalesce(p_reason, ''));
  return jsonb_build_object('ok', true, 'notified', k);
end $$;

create function public.staff_cancel_trip(p_trip uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; s students%rowtype; cs company_settings%rowtype; k int := 0; v jsonb;
begin
  perform _need('owner', 'dispatcher');
  select * into t from trips where id = p_trip and status = 'planned'; if not found then return jsonb_build_object('error', 'invalid_state'); end if;
  select * into cs from company_settings where id = 1;
  update trips set status = 'cancelled', cancel_reason = left(p_reason, 140) where id = p_trip;
  for s in select * from _trip_students(p_trip) loop
    v := _trip_view(p_trip, s.stop_id, s.id);
    k := k + _enqueue('trip_cancelled', s.id, s.phone, s.lang,
      case when s.lang = 'en' then format('Update: the %s trip at %s today is cancelled%s. Sorry for the inconvenience.', case when v->>'direction' = 'to' then 'morning' else 'return' end, v->>'time', coalesce(' (' || p_reason || ')', ''))
           else format('تنبيه: رحلة %s الساعة %s النهارده اتلغت%s. نعتذر عن الإزعاج.', case when v->>'direction' = 'to' then 'الذهاب' else 'العودة' end, v->>'time', coalesce(' (' || p_reason || ')', '')) end, 'cancel:' || p_trip || ':' || s.id);
  end loop;
  perform _audit('cancel_trip', 'trip', p_trip::text, p_reason);
  return jsonb_build_object('ok', true, 'notified', k);
end $$;

-- Demo only: move a trip along its stops so the tracking screens can be shown at any time of day.
create function public.staff_simulate(p_trip uuid, p_pos int, p_delay int default 0) returns jsonb language plpgsql security definer set search_path = public as $$
declare t trips%rowtype; sl slots%rowtype; rt routes%rowtype; n int; k int; sched timestamp; at_ts timestamp; s students%rowtype; notified int := 0;
begin
  perform _need('owner', 'dispatcher');
  if not (select demo_mode from company_settings where id = 1) then return jsonb_build_object('error', 'demo_only'); end if;
  select * into t from trips where id = p_trip and status in ('planned','running'); if not found then return jsonb_build_object('error', 'invalid_state'); end if;
  select * into sl from slots where id = t.slot_id; select * into rt from routes where id = t.route_id; select max(seq) into n from stops where route_id = t.route_id;
  if p_pos not between 1 and n or p_delay not between 0 and 120 then return jsonb_build_object('error', 'invalid_values'); end if;
  delete from trip_events where trip_id = p_trip;
  for k in 1..p_pos loop
    select t.starts_at + make_interval(mins => case when sl.direction = 'to' then s2.offset_min else rt.duration_min - s2.offset_min end) into sched
      from stops s2 where s2.route_id = t.route_id and (case when sl.direction = 'to' then s2.seq else n - s2.seq + 1 end) = k;
    at_ts := least(sched + make_interval(mins => p_delay), app_now() - make_interval(mins => p_pos - k));
    insert into trip_events (trip_id, pos, at, delay_minutes) values (p_trip, k, at_ts, p_delay);
  end loop;
  update trips set status = case when p_pos = n then 'completed' else 'running' end, delay_minutes = p_delay where id = p_trip;
  insert into boardings (trip_id, student_id, at)
    select p_trip, st.id, t.starts_at from _trip_students(p_trip) st where abs(hashtext(st.id::text || p_trip::text)) % 100 < 82 on conflict do nothing;
  if p_pos < n then notified := _notify_delay(p_trip); end if;
  perform _audit('simulate', 'trip', p_trip::text, 'pos ' || p_pos || ' delay ' || p_delay);
  return jsonb_build_object('ok', true, 'notified', notified);
end $$;

create function public.staff_set_demo_clock(p_time timestamp default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare shift int;
begin
  perform _need('owner', 'dispatcher');
  if not (select demo_mode from company_settings where id = 1) then return jsonb_build_object('error', 'demo_only'); end if;
  shift := case when p_time is null then 0 else ceil(extract(epoch from (p_time - (now() at time zone 'Africa/Cairo'))) / 60)::int end;
  update company_settings set demo_shift_min = shift where id = 1;
  return jsonb_build_object('ok', true, 'now', to_char(app_now(), 'YYYY-MM-DD"T"HH24:MI'));
end $$;

create function public.staff_demand(p_date date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, app_today()); cs company_settings%rowtype;
begin
  perform _need('owner', 'dispatcher');
  select * into cs from company_settings where id = 1;
  return jsonb_build_object('routes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name_ar', r.name_ar, 'name_en', r.name_en, 'students', x.c, 'price', r.term_price) order by r.id)
        from routes r left join lateral (select count(*) c from students where route_id = r.id and status = 'active') x on true where r.is_active), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(row_to_json(q)::jsonb order by q.time, q.route_id) from (
      select r.id route_id, r.name_ar, r.name_en, sl.direction, to_char(sl.depart_time, 'HH24:MI') as time,
             (select count(*) from students st where st.status = 'active' and st.route_id = r.id and (case when sl.direction = 'to' then st.to_slot_id else st.from_slot_id end) = sl.id) as enrolled,
             round(attendance_rate(r.id, sl.id, d) * 100)::int as rate,
             t.expected, t.unassigned_seats as shortfall, coalesce((select sum(b.capacity) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id), 0) as capacity, (select count(*) from trip_buses where trip_id = t.id) as buses,
             case when t.id is null then 'unplanned'
                  when t.unassigned_seats > 0 then 'shortfall'
                  when coalesce((select sum(b.capacity) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id), 0) = 0 then 'unplanned'
                  when t.expected * 100.0 / (select sum(b.capacity) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id) >= cs.high_load_pct then 'overload'
                  when t.expected * 100.0 / (select sum(b.capacity) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id) <= cs.low_load_pct then 'low' else 'ok' end as advice
      from routes r cross join slots sl left join trips t on t.trip_date = d and t.route_id = r.id and t.slot_id = sl.id where r.is_active) q where q.enrolled > 0), '[]'::jsonb));
end $$;

-- ═════════════════════════ students, subscriptions, payments (confidential: phone masking + audit trail) ═════════════════════════
create function public.staff_students(p_q text default null, p_route int default null, p_limit int default 60) returns jsonb language plpgsql security definer set search_path = public as $$
declare role text := _need('owner', 'dispatcher', 'accountant'); cs company_settings%rowtype; q text := nullif(trim(coalesce(p_q, '')), '');
begin
  select * into cs from company_settings where id = 1;
  return jsonb_build_object('total', (select count(*) from students st where (p_route is null or st.route_id = p_route) and (q is null or st.full_name ilike '%' || q || '%' or st.code ilike '%' || q || '%' or st.phone_norm like '%' || regexp_replace(q, '\D', '', 'g') || '%')),
    'rows', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', st.id, 'code', st.code, 'name', st.full_name, 'phone', case when role = 'dispatcher' then mask_phone(st.phone) else st.phone end, 'status', st.status,
        'route_ar', r.name_ar, 'route_en', r.name_en, 'stop_ar', sp.name_ar, 'stop_en', sp.name_en, 'university_ar', u.name_ar, 'university_en', u.name_en,
        'to_time', to_char(ts.depart_time, 'HH24:MI'), 'from_time', to_char(fs.depart_time, 'HH24:MI'),
        'sub_status', sb.status, 'ends_on', sb.ends_on, 'days_left', sb.ends_on - app_today()) x
      from students st join routes r on r.id = st.route_id join stops sp on sp.id = st.stop_id join universities u on u.id = st.university_id
        join slots ts on ts.id = st.to_slot_id join slots fs on fs.id = st.from_slot_id left join subscriptions sb on sb.student_id = st.id and sb.term_code = cs.term_code
      where (p_route is null or st.route_id = p_route) and (q is null or st.full_name ilike '%' || q || '%' or st.code ilike '%' || q || '%' or st.phone_norm like '%' || regexp_replace(q, '\D', '', 'g') || '%')
      order by st.code limit least(greatest(p_limit, 1), 200)) z), '[]'::jsonb));
end $$;

create function public.staff_student_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare role text := _need('owner', 'dispatcher', 'accountant'); s students%rowtype;
begin
  select * into s from students where id = p_id; if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform _audit('view_student', 'student', s.code, role);
  return jsonb_build_object('id', s.id, 'code', s.code, 'name', s.full_name, 'phone', case when role = 'dispatcher' then mask_phone(s.phone) else s.phone end, 'lang', s.lang, 'status', s.status,
    'route_id', s.route_id, 'stop_id', s.stop_id,
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('id', sb.id, 'term', sb.term_code, 'status', sb.status, 'starts_on', sb.starts_on, 'ends_on', sb.ends_on, 'price', sb.price,
         'paid', coalesce((select sum(amount) from payments where subscription_id = sb.id), 0)) order by sb.starts_on desc) from subscriptions sb where sb.student_id = s.id), '[]'::jsonb),
    'payments', case when role = 'dispatcher' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'method', p.method, 'reference', p.reference, 'at', p.paid_at) order by p.paid_at desc)
         from payments p join subscriptions sb on sb.id = p.subscription_id where sb.student_id = s.id), '[]'::jsonb) end,
    'stops', (select jsonb_agg(jsonb_build_object('id', id, 'name_ar', name_ar, 'name_en', name_en) order by seq) from stops where route_id = s.route_id and seq < (select max(seq) from stops where route_id = s.route_id)));
end $$;

create function public.staff_update_student_stop(p_id uuid, p_stop int) returns jsonb language plpgsql security definer set search_path = public as $$
declare s students%rowtype;
begin
  perform _need('owner', 'dispatcher');
  select * into s from students where id = p_id; if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not exists (select 1 from stops where id = p_stop and route_id = s.route_id and seq < (select max(seq) from stops where route_id = s.route_id)) then return jsonb_build_object('error', 'invalid_stop'); end if;
  update students set stop_id = p_stop, updated_at = now(), updated_by = auth.uid() where id = p_id;
  perform _audit('change_stop', 'student', s.code, s.stop_id || ' -> ' || p_stop);
  return jsonb_build_object('ok', true);
end $$;

-- Renewal pipeline for the accountant: who is about to expire, who asked to renew, who paid.
create function public.staff_subscriptions() returns jsonb language plpgsql security definer set search_path = public as $$
declare cs company_settings%rowtype; today date := app_today();
begin
  perform _need('owner', 'accountant');
  select * into cs from company_settings where id = 1;
  return coalesce((select jsonb_agg(z order by (z->>'rank')::int, z->>'code') from (
    select jsonb_build_object('student_id', st.id, 'code', st.code, 'name', st.full_name, 'route_ar', r.name_ar, 'route_en', r.name_en,
      'days_left', cur.ends_on - today, 'sub_id', coalesce(nxt.id, cur.id), 'price', coalesce(nxt.price, r.term_price),
      'balance', case when nxt.id is not null then nxt.price - coalesce((select sum(amount) from payments where subscription_id = nxt.id), 0) else r.term_price end,
      'stage', case when nxt.status = 'active' then 'renewed' when nxt.status = 'pending' then 'awaiting_payment' when cur.status = 'expired' or cur.ends_on < today then 'expired'
                    when cur.ends_on - today <= (select max(x) from unnest(cs.reminder_days) x) then 'expiring' else 'healthy' end,
      'rank', case when nxt.status = 'pending' then 1 when cur.status = 'expired' or cur.ends_on < today then 2 when nxt.status = 'active' then 4 else 3 end) z
    from students st join routes r on r.id = st.route_id
      join subscriptions cur on cur.student_id = st.id and cur.term_code = cs.term_code
      left join subscriptions nxt on nxt.student_id = st.id and nxt.term_code = cs.next_term_code
    where st.status = 'active' and (nxt.id is not null or cur.ends_on - today <= (select max(x) from unnest(cs.reminder_days) x) or cur.status <> 'active')) q), '[]'::jsonb);
end $$;

create function public.staff_record_payment(p_sub uuid, p_amount numeric, p_method text, p_ref text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare sb subscriptions%rowtype; s students%rowtype; paid numeric; cs company_settings%rowtype; msg text;
begin
  perform _need('owner', 'accountant');
  select * into sb from subscriptions where id = p_sub and status in ('pending','active'); if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into s from students where id = sb.student_id; select * into cs from company_settings where id = 1;
  paid := coalesce((select sum(amount) from payments where subscription_id = sb.id), 0);
  if p_amount is null or p_amount <= 0 or p_amount > sb.price - paid then return jsonb_build_object('error', 'invalid_amount', 'balance', sb.price - paid); end if;
  if p_method not in ('cash','instapay','vodafone_cash','bank') then return jsonb_build_object('error', 'invalid_method'); end if;
  insert into payments (subscription_id, amount, method, reference, received_by) values (sb.id, p_amount, p_method, left(p_ref, 60), auth.uid());
  paid := paid + p_amount;
  if paid >= sb.price then update subscriptions set status = 'active' where id = sb.id; end if;
  msg := case when s.lang = 'en' then format('Payment received: %s EGP for %s. %s', p_amount, case when sb.term_code = cs.term_code then cs.term_name_en else cs.next_term_name_en end,
                case when paid >= sb.price then 'Your subscription is active. Thank you!' else format('Remaining: %s EGP.', sb.price - paid) end)
         else format('تم استلام %s جنيه للاشتراك (%s). %s', p_amount, case when sb.term_code = cs.term_code then cs.term_name_ar else cs.next_term_name_ar end,
                case when paid >= sb.price then 'اشتراكك اتفعّل. شكراً ليك!' else format('المتبقي: %s جنيه.', sb.price - paid) end) end;
  perform _enqueue('receipt', s.id, s.phone, s.lang, msg, 'receipt:' || sb.id || ':' || (select count(*) from payments where subscription_id = sb.id));
  update student_requests set status = 'done', handled_by = auth.uid(), handled_at = now() where student_id = s.id and kind = 'renewal' and status = 'open' and paid >= sb.price and sb.term_code = cs.next_term_code;
  perform _audit('record_payment', 'subscription', s.code, p_amount || ' ' || p_method);
  return jsonb_build_object('ok', true, 'activated', paid >= sb.price, 'balance', sb.price - paid);
end $$;

create function public.staff_cashbox(p_days int default 7) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _need('owner', 'accountant');
  return jsonb_build_object('total', coalesce((select sum(amount) from payments where paid_at >= now() - make_interval(days => p_days)), 0),
    'by_method', coalesce((select jsonb_object_agg(method, s) from (select method, sum(amount) s from payments where paid_at >= now() - make_interval(days => p_days) group by method) q), '{}'::jsonb),
    'outstanding', coalesce((select sum(sb.price - coalesce((select sum(amount) from payments where subscription_id = sb.id), 0)) from subscriptions sb where sb.status = 'pending'), 0));
end $$;

-- ═════════════════════════ requests & messages ═════════════════════════
create function public.staff_requests() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _need('owner', 'dispatcher', 'accountant');
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'status', q.status, 'at', q.created_at, 'student', st.full_name, 'code', st.code, 'payload', q.payload,
      'stop_ar', (select name_ar from stops where id = (q.payload->>'stop_id')::int), 'stop_en', (select name_en from stops where id = (q.payload->>'stop_id')::int),
      'current_stop_ar', cs2.name_ar, 'current_stop_en', cs2.name_en) order by (q.status = 'open') desc, q.created_at desc)
    from (select * from student_requests order by created_at desc limit 80) q join students st on st.id = q.student_id join stops cs2 on cs2.id = st.stop_id), '[]'::jsonb);
end $$;

create function public.staff_resolve_request(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare q student_requests%rowtype; s students%rowtype; msg text; nm_ar text; nm_en text;
begin
  perform _need('owner', 'dispatcher', 'accountant');
  select * into q from student_requests where id = p_id and status = 'open'; if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into s from students where id = q.student_id;
  if q.kind = 'stop_change' and p_approve then
    update students set stop_id = (q.payload->>'stop_id')::int, updated_at = now(), updated_by = auth.uid() where id = s.id;
  end if;
  update student_requests set status = case when p_approve then 'done' else 'rejected' end, handled_by = auth.uid(), handled_at = now(), note = left(p_note, 140) where id = p_id;
  if q.kind = 'stop_change' then
    select name_ar, name_en into nm_ar, nm_en from stops where id = (q.payload->>'stop_id')::int;
    msg := case when s.lang = 'en' then case when p_approve then format('Your stop change was approved. New stop: %s.', nm_en) else 'Sorry, we could not change your stop this term.' || coalesce(' ' || p_note, '') end
           else case when p_approve then format('تمت الموافقة على تغيير محطتك. محطتك الجديدة: %s.', nm_ar) else 'للأسف مقدرناش نغيّر محطتك الترم ده.' || coalesce(' ' || p_note, '') end end;
    perform _enqueue('request_reply', s.id, s.phone, s.lang, msg, 'reqreply:' || q.id);
  elsif q.kind in ('absence','complaint') then
    msg := case when s.lang = 'en' then 'We received your message. Thank you.' || coalesce(' ' || p_note, '') else 'وصلتنا رسالتك. شكراً ليك.' || coalesce(' ' || p_note, '') end;
    perform _enqueue('request_reply', s.id, s.phone, s.lang, msg, 'reqreply:' || q.id);
  end if;
  perform _audit('resolve_request', 'request', s.code, q.kind || ' ' || case when p_approve then 'approved' else 'rejected' end);
  return jsonb_build_object('ok', true);
end $$;

create function public.staff_outbox(p_limit int default 60) returns jsonb language plpgsql security definer set search_path = public as $$
declare role text := _need('owner', 'dispatcher', 'accountant');
begin
  return jsonb_build_object('whatsapp_enabled', (select whatsapp_enabled from company_settings where id = 1),
    'queued', (select count(*) from outbox where status = 'queued'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'to', case when role = 'dispatcher' then mask_phone(o.to_phone) else o.to_phone end, 'name', st.full_name, 'lang', o.lang, 'body', o.body, 'status', o.status, 'at', o.created_at) order by o.created_at desc)
      from (select * from outbox order by created_at desc limit least(greatest(p_limit, 1), 200)) o left join students st on st.id = o.student_id), '[]'::jsonb));
end $$;

create function public.staff_mark_sent(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _need('owner', 'dispatcher', 'accountant'); update outbox set status = 'sent' where id = p_id and status = 'queued'; return jsonb_build_object('ok', true); end $$;

create function public.staff_audit(p_limit int default 100) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _need('owner');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'who', a.staff_name, 'action', a.action, 'entity', a.entity, 'ref', a.entity_id, 'detail', a.detail) order by a.id desc)
    from (select * from audit_log order by id desc limit least(greatest(p_limit, 1), 300)) a), '[]'::jsonb);
end $$;

-- ═════════════════════════ settings ═════════════════════════
create function public.staff_settings() returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _need('owner'); return (select to_jsonb(c) from company_settings c where id = 1); end $$;

create function public.staff_update_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _need('owner');
  update company_settings set
    phone = coalesce(p->>'phone', phone), whatsapp = coalesce(p->>'whatsapp', whatsapp), owner_phone = coalesce(p->>'owner_phone', owner_phone),
    delay_alert_minutes = coalesce(least(greatest((p->>'delay_alert_minutes')::int, 3), 60), delay_alert_minutes),
    low_load_pct = coalesce(least(greatest((p->>'low_load_pct')::int, 5), 90), low_load_pct),
    high_load_pct = coalesce(least(greatest((p->>'high_load_pct')::int, 50), 100), high_load_pct),
    planning_margin_pct = coalesce(least(greatest((p->>'planning_margin_pct')::int, 0), 30), planning_margin_pct),
    payment_note_ar = coalesce(left(p->>'payment_note_ar', 300), payment_note_ar), payment_note_en = coalesce(left(p->>'payment_note_en', 300), payment_note_en)
  where id = 1;
  perform _audit('update_settings', 'settings', '1', left(p::text, 200));
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════════════════ automations (safe to run any number of times) ═════════════════════════
create function public._run_automations() returns jsonb language plpgsql security definer set search_path = public as $$
declare cs company_settings%rowtype; today date := app_today(); s record; thr int; msg text; k int; expired int := 0; reminders int := 0; overdue int := 0; orders int := 0; alerts int := 0; b record; rk jsonb; ttl text;
begin
  select * into cs from company_settings where id = 1;
  -- 1) expire finished subscriptions
  update subscriptions set status = 'expired' where status = 'active' and ends_on < today; get diagnostics expired = row_count;
  -- 2) renewal reminders: one message per threshold (14 / 7 / 1 days), only for students who have not renewed yet
  if cs.next_term_code is not null then
    for s in select st.id sid, st.phone, st.lang, st.code, cur.id cur_id, cur.ends_on, r.term_price from students st join routes r on r.id = st.route_id
        join subscriptions cur on cur.student_id = st.id and cur.term_code = cs.term_code and cur.status = 'active'
        where st.status = 'active' and not exists (select 1 from subscriptions n where n.student_id = st.id and n.term_code = cs.next_term_code and n.status = 'active')
          and cur.ends_on - today between 0 and (select max(x) from unnest(cs.reminder_days) x) loop
      select min(x) into thr from unnest(cs.reminder_days) x where x >= s.ends_on - today;
      msg := case when s.lang = 'en' then format('Your subscription ends in %s day(s). Renew for %s (%s EGP) – reply "renew" in the assistant or pay with reference RN-%s. %s', s.ends_on - today, cs.next_term_name_en, s.term_price, substr(s.code, 4), cs.payment_note_en)
             else format('اشتراكك بينتهي بعد %s يوم. جدّد لـ %s (%s جنيه) – اكتب "تجديد" للمساعد أو ادفع بالرقم المرجعي RN-%s. %s', s.ends_on - today, cs.next_term_name_ar, s.term_price, substr(s.code, 4), cs.payment_note_ar) end;
      k := _enqueue('renewal_reminder', s.sid, s.phone, s.lang, msg, 'renew:' || s.cur_id || ':' || thr);
      reminders := reminders + k;
    end loop;
    -- 3) unpaid renewals, weekly nudge after the grace period
    for s in select st.id sid, st.phone, st.lang, st.code, n.id nid, n.price, n.due_on from students st join subscriptions n on n.student_id = st.id and n.term_code = cs.next_term_code and n.status = 'pending'
        where st.status = 'active' and n.due_on is not null and today > n.due_on + cs.grace_days loop
      msg := case when s.lang = 'en' then format('Reminder: your renewal (%s EGP) is still unpaid. Reference RN-%s. %s', s.price - coalesce((select sum(amount) from payments where subscription_id = s.nid), 0), substr(s.code, 4), cs.payment_note_en)
             else format('تذكير: تجديد اشتراكك (%s جنيه) لسه ما اتدفعش. الرقم المرجعي RN-%s. %s', s.price - coalesce((select sum(amount) from payments where subscription_id = s.nid), 0), substr(s.code, 4), cs.payment_note_ar) end;
      k := _enqueue('overdue_payment', s.sid, s.phone, s.lang, msg, 'overdue:' || s.nid || ':' || ((today - s.due_on) / 7));
      overdue := overdue + k;
    end loop;
  end if;
  -- 4) predictive maintenance: urgent buses get a work order and the owner gets an alert
  for b in select id, plate from buses where status = 'active' loop
    rk := bus_risk(b.id);
    if rk->>'level' = 'urgent' and not exists (select 1 from maintenance_orders where bus_id = b.id and status = 'open') then
      insert into maintenance_orders (bus_id, kind, reason, created_by, scheduled_for)
        values (b.id, case when rk->'reasons'->0->>'code' like 'brakes%' then 'brakes' when rk->'reasons'->0->>'code' like 'oil%' then 'oil' when rk->'reasons'->0->>'code' like 'tires%' then 'tires' else 'routine' end,
                'risk ' || (rk->>'score') || ': ' || coalesce(rk->'reasons'->0->>'code', ''), 'auto', today + 1);
      orders := orders + 1;
      alerts := alerts + _enqueue('bus_alert', null, cs.owner_phone, 'ar', format('تنبيه صيانة: الباص %s حالته خطرة (%s/100). تم فتح أمر صيانة تلقائياً.', b.plate, rk->>'score'), 'busalert:' || b.id || ':' || today);
    end if;
  end loop;
  return jsonb_build_object('expired', expired, 'reminders', reminders, 'overdue', overdue, 'orders', orders, 'alerts', alerts);
end $$;

create function public.staff_run_automations() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin perform _need('owner', 'dispatcher'); r := _run_automations(); perform _audit('run_automations', 'system', null, r::text); return r; end $$;

-- ═════════════════════════ owner overview + daily report ═════════════════════════
create function public.build_report(p_date date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, app_today()); cs company_settings%rowtype; j jsonb; nstud int; exp14 int; unpaid int; rev numeric; trips_n int; delayed int; short int; urgent int; soon int; open_req int; avg_rate numeric; bd7 int;
begin
  select * into cs from company_settings where id = 1;
  select count(*) into nstud from students where status = 'active';
  select count(*) into exp14 from subscriptions where term_code = cs.term_code and status = 'active' and ends_on - d between 0 and 14
     and not exists (select 1 from subscriptions n where n.student_id = subscriptions.student_id and n.term_code = cs.next_term_code and n.status = 'active');
  select count(*) into unpaid from subscriptions where term_code = cs.next_term_code and status = 'pending';
  select coalesce(sum(amount), 0) into rev from payments where paid_at::date >= d - 7;
  select count(*), count(*) filter (where delay_minutes >= cs.delay_alert_minutes), coalesce(sum(unassigned_seats), 0) into trips_n, delayed, short from trips where trip_date = d and status <> 'cancelled';
  select count(*) filter (where (bus_risk(id)->>'level') = 'urgent'), count(*) filter (where (bus_risk(id)->>'level') = 'soon') into urgent, soon from buses where status = 'active';
  select count(*) into open_req from student_requests where status = 'open';
  select round(avg(rating), 1) into avg_rate from trip_ratings where at >= now() - interval '14 days';
  select count(*) into bd7 from breakdowns where happened_on >= d - 7;
  j := jsonb_build_object('date', d, 'students', nstud, 'expiring14', exp14, 'unpaid_renewals', unpaid, 'revenue7', rev, 'trips', trips_n, 'delayed', delayed, 'shortfall', short,
       'urgent_buses', urgent, 'soon_buses', soon, 'open_requests', open_req, 'rating', avg_rate, 'breakdowns7', bd7);
  return j || jsonb_build_object('text_ar', format(E'تقرير %s\nالطلاب النشطين: %s\nاشتراكات بتنتهي خلال ١٤ يوم: %s | تجديدات لسه ما اتدفعتش: %s\nمحصّل آخر ٧ أيام: %s جنيه\nرحلات النهارده: %s (متأخر منها: %s) | مقاعد ناقصة: %s\nباصات حالتها خطرة: %s | محتاجة صيانة قريبة: %s\nطلبات مفتوحة: %s',
       d, nstud, exp14, unpaid, rev, trips_n, delayed, short, urgent, soon, open_req));
end $$;

create function public.staff_overview() returns jsonb language plpgsql security definer set search_path = public as $$
declare role text := _need('owner', 'dispatcher', 'accountant'); r jsonb;
begin
  r := build_report(app_today());
  if role <> 'owner' then r := r - 'revenue7' - 'text_ar'; end if;
  return jsonb_build_object('role', role, 'now', to_char(app_now(), 'YYYY-MM-DD"T"HH24:MI'), 'report', r,
    'demo_mode', (select demo_mode from company_settings where id = 1),
    'loads', case when role = 'accountant' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('time', to_char(q.depart_time, 'HH24:MI'), 'direction', q.direction, 'expected', q.e, 'capacity', q.c) order by q.depart_time)
        from (select sl.depart_time, sl.direction, coalesce(sum(t.expected), 0) e, coalesce(sum(cp.c), 0) c from slots sl left join trips t on t.slot_id = sl.id and t.trip_date = app_today() and t.status <> 'cancelled'
              left join lateral (select sum(b.capacity) c from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id) cp on true group by sl.id, sl.depart_time) q), '[]'::jsonb) end,
    'week', case when role = 'accountant' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('d', d::date, 'boarded', (select count(*) from boardings b join trips t on t.id = b.trip_id where t.trip_date = d::date)) order by d)
        from generate_series(app_today() - 13, app_today(), interval '1 day') d), '[]'::jsonb) end);
end $$;

create function public.staff_send_daily_report() returns jsonb language plpgsql security definer set search_path = public as $$
declare cs company_settings%rowtype; r jsonb;
begin
  perform _need('owner');
  select * into cs from company_settings where id = 1; r := build_report(app_today());
  return jsonb_build_object('queued', _enqueue('daily_report', null, cs.owner_phone, 'ar', r->>'text_ar', 'report:' || app_today()));
end $$;

-- ═════════════════════════ privileges: personal data is reachable ONLY through the functions above ═════════════════════════
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- public catalog (no personal data): lines, stops, time slots, company contact card
grant select on public.universities, public.routes, public.stops, public.slots, public.public_company to anon, authenticated;
-- staff can read their own profile row (role) so the UI can pick the right screens
grant select on public.staff to authenticated;

-- student & driver entry points (no login; protected by phone + student code with rate limiting, or by private tokens)
grant execute on function public.student_status(text, text), public.student_request(text, text, text, jsonb), public.track_by_token(text), public.rate_trip(text, uuid, int, text),
  public.driver_trip(text), public.driver_start(text), public.driver_arrive(text, int), public.driver_board(text, text), public.driver_ping(text, numeric, numeric) to anon, authenticated;

-- staff entry points (each one checks the role itself with _need)
grant execute on function public.staff_role(), public.is_staff(),
  public.staff_overview(), public.staff_trips(date), public.staff_live(), public.staff_set_delay(uuid, int, text), public.staff_cancel_trip(uuid, text), public.staff_simulate(uuid, int, int), public.staff_set_demo_clock(timestamp),
  public.plan_day(date), public.staff_demand(date), public.staff_fleet(), public.staff_create_order(int, text, text, date), public.staff_complete_order(uuid, numeric), public.staff_add_check(int, int, numeric, numeric, numeric, numeric, int),
  public.staff_students(text, int, int), public.staff_student_detail(uuid), public.staff_update_student_stop(uuid, int), public.staff_subscriptions(), public.staff_record_payment(uuid, numeric, text, text), public.staff_cashbox(int),
  public.staff_requests(), public.staff_resolve_request(uuid, boolean, text), public.staff_outbox(int), public.staff_mark_sent(uuid), public.staff_audit(int),
  public.staff_settings(), public.staff_update_settings(jsonb), public.staff_run_automations(), public.staff_send_daily_report() to authenticated;
