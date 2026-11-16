-- Sekka — FICTIONAL demo data (names, phones, plates, numbers). Never load this into a real company's database.
-- Student #1 for the chat demo: phone 01100000001 · code ST-00001.  Student #4 rides the running, delayed 07:00 trip.
do $$
declare d0 date; shift int; cs company_settings%rowtype; d date; tr_row record; r jsonb;
  firsts text[] := array['أحمد','محمد','محمود','مصطفى','يوسف','عمر','علي','كريم','طارق','هشام','حسن','إبراهيم','ياسين','زياد','آدم','مروان','سيف','باسم','خالد','عمرو',
                         'سارة','مريم','نور','هبة','ريم','دينا','آية','ندى','منة','هدى','جميلة','شيماء','رنا','سلمى','فرح','ملك','يمنى','حبيبة','لينا','جنى'];
  fathers text[] := array['محمد','أحمد','علي','محمود','إبراهيم','حسن','سمير','طارق','خالد','مصطفى','عادل','ماهر','وائل','ناصر','فتحي','سعيد','رمضان','جمال','صلاح','شريف','هاني','أيمن','عصام','مجدي'];
  fams text[] := array['السيد','عبد الله','الشرقاوي','منصور','الجندي','عطية','خليل','البنا','حجازي','النجار','الدسوقي','عامر','فرج','زيدان','الحداد','سلامة','المصري','عثمان','غنيم','شلبي','الطحان','موسى','بكر','رزق','نصار','عبد الرحمن','صقر','الكومي','جاد','فؤاد'];
  letters text[] := array['د','م','ص','ك','ط','ق','ن','ع'];
  dnames text[] := array['سيد','عادل','رضا','ماهر','نبيل','فتحي','جمال','صبري','أشرف','إسماعيل','عاطف','سمير','منير','ممدوح','عوض','شعبان'];
  bus_row record; k int; v_odo int; w numeric; cur_pad numeric; cur_oil numeric; cur_tire numeric; cur_temp numeric; flt int;
begin
  -- demo clock: nearest working day at 07:10 (the clock keeps running from there)
  select * into cs from company_settings where id = 1;
  d0 := (now() at time zone 'Africa/Cairo')::date;
  while not (extract(dow from d0)::int = any (cs.operating_days)) loop d0 := d0 + 1; end loop;
  shift := round(extract(epoch from ((d0 + time '07:10') - (now() at time zone 'Africa/Cairo'))) / 60)::int;
  update company_settings set demo_shift_min = shift, term_start = d0 - 100, term_end = d0 + 12, next_term_start = d0 + 30, next_term_end = d0 + 150 where id = 1;
  select * into cs from company_settings where id = 1;

  -- ── fleet ──
  insert into buses (plate, model, year, capacity, odometer_km, service_interval_km, last_service_km, last_service_on, status)
  select letters[1 + i % 8] || ' ' || letters[1 + (i * 3 + 1) % 8] || ' ' || letters[1 + (i * 5 + 2) % 8] || ' ' || (2000 + (i * 397) % 7000),
         case cap when 50 then 'Mercedes Tourismo' when 45 then 'Higer KLQ6129' else 'Toyota Coaster' end, 2016 + i % 8, cap,
         odo, 10000, odo - case i when 3 then 10400 when 7 then 8300 when 11 then 6500 else 1000 + (i * 1237) % 4500 end, d0 - 10 - (i * 3) % 60,
         case when i = 16 then 'workshop' else 'active' end
  from (select i, (array[50,50,50,45,45,45,45,50,45,50,28,45,28,50,28,28])[i] cap, 120000 + (i * 7331) % 90000 odo from generate_series(1, 16) i) q;
  insert into drivers (full_name, phone, bus_id) select dnames[i] || ' ' || fathers[1 + (i * 5) % 24] || ' ' || fams[1 + (i * 7) % 30], '0120000' || lpad(i::text, 4, '0'), i from generate_series(1, 16) i;

  for bus_row in select * from buses order by id loop
    w := case bus_row.id when 3 then 3.0 when 7 then 2.3 when 11 then 1.9 else 0.7 + (bus_row.id % 5) * 0.2 end;
    cur_pad := case bus_row.id when 3 then 17.5 when 7 then 38 when 11 then 55 else 55 + (bus_row.id * 11) % 35 end;
    cur_oil := case bus_row.id when 3 then 30 when 7 then 22 else 40 + (bus_row.id * 13) % 55 end;
    cur_tire := case bus_row.id when 11 then 2.9 else 5 + (bus_row.id % 5) end;
    for k in 0..11 loop
      v_odo := bus_row.odometer_km - 2 * k * 260;
      flt := case when bus_row.id = 3 and k = 0 then 2 when bus_row.id = 3 and k in (1, 2) then 1 when bus_row.id = 7 and k = 1 then 1 else 0 end;
      cur_temp := case when bus_row.id = 3 and k = 0 then 98 else 86 + bus_row.id % 4 end;
      insert into bus_checks (bus_id, checked_on, odometer_km, brake_pad_pct, oil_life_pct, tire_depth_mm, engine_temp_c, fault_codes)
      values (bus_row.id, d0 - 2 * k, v_odo, round(cur_pad + w / 1000.0 * (bus_row.odometer_km - v_odo), 1), round(least(100, cur_oil + 2.5 / 10.0 * (bus_row.odometer_km - v_odo) / 100.0), 1),
              round(cur_tire + 0.15 / 1000.0 * (bus_row.odometer_km - v_odo), 1), cur_temp, flt);
    end loop;
  end loop;
  insert into breakdowns (bus_id, happened_on, kind, delay_minutes, cost) values
    (3, d0 - 5, 'brakes', 35, 2400), (3, d0 - 41, 'engine', 60, 5200), (7, d0 - 30, 'tire', 25, 600), (11, d0 - 60, 'ac', 10, 900), (2, d0 - 75, 'tire', 20, 550), (9, d0 - 40, 'battery', 30, 1100), (13, d0 - 70, 'tire', 15, 500);
  insert into maintenance_orders (bus_id, kind, reason, status, created_by, created_at, scheduled_for, done_on, cost) values
    (16, 'brakes', 'تغيير فحمات الفرامل', 'open', 'سلمى (التشغيل)', now() - interval '2 days', d0 + 1, null, null),
    (5, 'routine', 'صيانة دورية', 'done', 'سلمى (التشغيل)', now() - interval '25 days', d0 - 22, d0 - 21, 3200),
    (9, 'oil', 'تغيير زيت', 'done', 'auto', now() - interval '18 days', d0 - 16, d0 - 16, 1800);

  -- ── students ──
  insert into students (full_name, phone, lang, university_id, route_id, stop_id, to_slot_id, from_slot_id)
  select firsts[1 + (i * 7) % 40] || ' ' || fathers[1 + (i * 11) % 24] || ' ' || fams[1 + (i * 17) % 30],
         (array['010','011','012','015'])[1 + i % 4] || '000' || lpad(i::text, 5, '0'), case when i % 9 = 0 then 'en' else 'ar' end,
         rt.university_id, rt.id,
         (select s.id from stops s where s.route_id = rt.id and s.seq = 1 + (i * 13 + case when i <= 4 then 1 else 0 end) % ((select max(seq) from stops where route_id = rt.id) - 1)),
         case when i <= 3 then 2 when i = 4 then 1 when h < 30 then 1 when h < 75 then 2 else 3 end,
         case when i <= 4 then 5 when f < 15 then 4 when f < 45 then 5 when f < 75 then 6 else 7 end
  from (select i, (i * 37) % 100 g, (i * 53) % 100 h, (i * 29) % 100 f from generate_series(1, 480) i) q
  join routes rt on rt.id = case when i <= 4 then 2 when g < 18 then 1 when g < 44 then 2 when g < 68 then 3 when g < 86 then 4 else 5 end
  order by i;

  insert into subscriptions (student_id, term_code, starts_on, ends_on, price, status, due_on)
    select s.id, cs.term_code, cs.term_start, cs.term_end, r.term_price, 'active', cs.term_start from students s join routes r on r.id = s.route_id;
  insert into payments (subscription_id, amount, method, reference, paid_at)
    select sb.id, sb.price, (array['cash','instapay','vodafone_cash','bank'])[1 + (substr(s.code, 4)::int) % 4], 'T1-' || substr(s.code, 4), (cs.term_start + (substr(s.code, 4)::int % 12))::timestamptz
    from subscriptions sb join students s on s.id = sb.student_id where sb.term_code = cs.term_code;

  -- ── 35 days of history: plan → run → boardings, stop events, delays ──
  for d in select x::date from generate_series(d0 - 35, d0 - 1, interval '1 day') x loop
    r := _plan_day(d);
    continue when not (r->>'operating')::boolean;
    update trips set status = 'completed',
      delay_minutes = case when abs(hashtext(id::text)) % 100 < 10 then 5 + abs(hashtext(id::text || 'x')) % 15 else 0 end where trip_date = d and status = 'planned';
    insert into boardings (trip_id, student_id, at)
      select t.id, st.id, t.starts_at from trips t join slots sl on sl.id = t.slot_id, lateral _trip_students(t.id) st
      where t.trip_date = d and abs(hashtext(st.id::text || t.id::text)) % 1000 <
        (case when extract(dow from d) = 4 then 740 when extract(dow from d) = 6 then 930 else 900 end) - (case t.slot_id when 3 then 60 when 7 then 100 when 6 then 30 else 0 end);
    insert into trip_events (trip_id, pos, at, delay_minutes)
      select t.id, case when sl.direction = 'to' then s.seq else n.n - s.seq + 1 end,
             t.starts_at + make_interval(mins => case when sl.direction = 'to' then s.offset_min else rt.duration_min - s.offset_min end + t.delay_minutes), t.delay_minutes
      from trips t join slots sl on sl.id = t.slot_id join routes rt on rt.id = t.route_id join stops s on s.route_id = t.route_id
        join lateral (select max(seq) n from stops where route_id = t.route_id) n on true where t.trip_date = d;
    if d >= d0 - 14 then
      insert into trip_ratings (trip_id, student_id, rating, comment)
        select b.trip_id, b.student_id, case when h2 < 8 then 3 when h2 < 30 then 4 else 5 end, null
        from (select b.*, abs(hashtext(b.student_id::text || b.trip_id::text || 'r')) % 100 h, abs(hashtext(b.student_id::text || b.trip_id::text || 'q')) % 100 h2 from boardings b join trips t on t.id = b.trip_id where t.trip_date = d) b where h < 14;
    end if;
  end loop;

  -- students whose subscription ended mid-term (shows the "expired" column)
  update subscriptions set status = 'expired', ends_on = d0 - 9 where student_id in (select id from students where substr(code, 4)::int % 40 = 0 and substr(code, 4)::int > 4) and term_code = cs.term_code;

  -- ── renewals for next term: ~35% paid, ~15% requested but unpaid/part-paid ──
  insert into subscriptions (student_id, term_code, starts_on, ends_on, price, status, due_on)
    select s.id, cs.next_term_code, cs.next_term_start, cs.next_term_end, r.term_price, case when substr(s.code, 4)::int % 100 < 35 and substr(s.code, 4)::int <> 1 then 'active' else 'pending' end, cs.term_end
    from students s join routes r on r.id = s.route_id
    where (substr(s.code, 4)::int % 100 < 50 and substr(s.code, 4)::int <> 1 and substr(s.code, 4)::int % 40 <> 0) and substr(s.code, 4)::int <> 4;
  insert into payments (subscription_id, amount, method, reference, paid_at)
    select sb.id, case when sb.status = 'active' then sb.price else round(sb.price / 2) end, (array['instapay','cash','vodafone_cash'])[1 + (substr(s.code, 4)::int) % 3], 'RN-' || substr(s.code, 4), now() - make_interval(days => (substr(s.code, 4)::int * 7) % 9)
    from subscriptions sb join students s on s.id = sb.student_id
    where sb.term_code = cs.next_term_code and (sb.status = 'active' or substr(s.code, 4)::int % 100 between 40 and 44);
  insert into student_requests (student_id, kind, payload, created_at)
    select s.id, 'renewal', '{}'::jsonb, now() - interval '1 day' from subscriptions sb join students s on s.id = sb.student_id where sb.term_code = cs.next_term_code and sb.status = 'pending' and substr(s.code, 4)::int % 100 between 36 and 40;

  -- ── today and tomorrow ──
  perform _plan_day(d0); perform _plan_day(d0 + 1);
  -- the 07:00 trips have already left: events for every stop reached so far; Delta line is running late
  for tr_row in select tr.id, tr.route_id, tr.starts_at, sl.direction, rt.duration_min from trips tr join slots sl on sl.id = tr.slot_id join routes rt on rt.id = tr.route_id where tr.trip_date = d0 and tr.slot_id = 1 and tr.status = 'planned' loop
    insert into trip_events (trip_id, pos, at, delay_minutes)
      select tr_row.id, s.seq, tr_row.starts_at + make_interval(mins => s.offset_min + case when tr_row.route_id = 2 then least(12, 3 * (s.seq - 1)) else 0 end), case when tr_row.route_id = 2 then least(12, 3 * (s.seq - 1)) else 0 end
      from stops s where s.route_id = tr_row.route_id and tr_row.starts_at + make_interval(mins => s.offset_min + case when tr_row.route_id = 2 then least(12, 3 * (s.seq - 1)) else 0 end) <= app_now();
    update trips set status = 'running', delay_minutes = case when tr_row.route_id = 2 then 12 else 0 end where id = tr_row.id;
    insert into boardings (trip_id, student_id, at) select tr_row.id, st.id, tr_row.starts_at from _trip_students(tr_row.id) st where abs(hashtext(st.id::text || tr_row.id::text)) % 100 < 85 and st.stop_id in (select id from stops where route_id = tr_row.route_id and seq <= (select max(pos) from trip_events where trip_id = tr_row.id)) on conflict do nothing;
    perform _notify_delay(tr_row.id);
  end loop;

  -- ── requests, audit trail, daily report, automations ──
  insert into student_requests (student_id, kind, payload, created_at)
    select s.id, 'stop_change', jsonb_build_object('stop_id', (select id from stops where route_id = s.route_id and seq = 1 + (s.stop_id % 2) limit 1)), now() - make_interval(hours => (3 + n * 5)::int)
    from (select s.*, row_number() over (order by code) n from students s where substr(code, 4)::int in (12, 27, 45, 61)) s where (select id from stops where route_id = s.route_id and seq = 1 + (s.stop_id % 2) limit 1) <> s.stop_id;
  insert into student_requests (student_id, kind, payload, created_at) select s.id, 'absence', jsonb_build_object('date', d0 + 2, 'note', 'امتحان عملي'), now() - interval '5 hours' from students s where substr(code, 4)::int in (33, 77);
  insert into student_requests (student_id, kind, payload, created_at) select s.id, 'complaint', jsonb_build_object('text', 'الباص اتأخر امبارح الصبح حوالي ربع ساعة'), now() - interval '20 hours' from students s where substr(code, 4)::int = 58;
  insert into audit_log (at, staff_name, action, entity, entity_id, detail) values
    (now() - interval '1 day 3 hours', 'منى (الحسابات)', 'record_payment', 'subscription', 'ST-00131', '4800 instapay'),
    (now() - interval '1 day 2 hours', 'سلمى (التشغيل)', 'plan_day', 'trips', (d0)::text, 'planned'),
    (now() - interval '20 hours', 'منى (الحسابات)', 'view_student', 'student', 'ST-00058', 'accountant'),
    (now() - interval '9 hours', 'كريم (المالك)', 'update_settings', 'settings', '1', 'delay_alert_minutes');
  perform _run_automations();
  perform _enqueue('daily_report', null, cs.owner_phone, 'ar', build_report(d0)->>'text_ar', 'report:' || d0);
  -- keep the newest 30 messages queued (waiting for the WhatsApp worker); the rest count as sent
  update outbox set status = 'sent' where id in (select id from (select id, row_number() over (order by case kind when 'daily_report' then 0 when 'bus_alert' then 1 when 'trip_delay' then 2 else 3 end, created_at desc, dedupe_key) n from outbox) q where n > 30);
end $$;
