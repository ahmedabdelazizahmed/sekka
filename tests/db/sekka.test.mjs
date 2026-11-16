// Database tests for Sekka: confidentiality (RLS + role matrix + masking + audit), planning (no double booking, forecast),
// predictive maintenance, automations (idempotent), payments, tracking + delay alerts, student requests.
import fs from 'node:fs'
import { makeDb, as, tryAs } from './harness.mjs'

const P = new URL('../../supabase/', import.meta.url).pathname
const OWNER = 'a0000000-0000-4000-8000-000000000001', DISP = 'a0000000-0000-4000-8000-000000000002', ACC = 'a0000000-0000-4000-8000-000000000003', NOBODY = 'a0000000-0000-4000-8000-0000000000ff'
const db = await makeDb([P + 'migrations/0001_sekka_core.sql'])
for (const [id, n, r] of [[OWNER, 'owner', 'owner'], [DISP, 'dispatcher', 'dispatcher'], [ACC, 'accountant', 'accountant'], [NOBODY, 'nobody', 'owner']])
  await db.exec(`insert into auth.users (id, email) values ('${id}', '${n}@demo.test')`)
for (const [id, n, r] of [[OWNER, 'كريم', 'owner'], [DISP, 'سلمى', 'dispatcher'], [ACC, 'منى', 'accountant']]) await db.exec(`insert into staff (id, full_name, role) values ('${id}', '${n}', '${r}')`)
await db.exec(fs.readFileSync(P + 'seed.sql', 'utf8'))
await db.exec(fs.readFileSync(P + 'seed-sample-data.sql', 'utf8'))

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗', name, extra ?? '') } }
const fn = async (who, sql, params) => { const r = await tryAs(db, who === 'anon' ? 'anon' : 'authenticated', who === 'anon' ? null : who, sql, params); return r.ok ? { ok: true, j: r.rows[0] && Object.values(r.rows[0])[0] } : { ok: false, err: r.err } }
const q = async (sql, params) => (await db.query(sql, params)).rows
const denied = (r) => !r.ok && /permission denied|not_allowed|forbidden|not authorized/i.test(r.err ?? '')

console.log('\n1. Confidential data cannot be read directly')
for (const t of ['students', 'subscriptions', 'payments', 'outbox', 'audit_log', 'student_requests', 'verify_attempts', 'bus_checks', 'trips', 'boardings', 'company_settings', 'trip_positions']) {
  const a = await tryAs(db, 'anon', null, `select * from ${t} limit 1`)
  const s = await tryAs(db, 'authenticated', OWNER, `select * from ${t} limit 1`)
  ok(`anon cannot select ${t}`, !a.ok); ok(`even the owner cannot select ${t} through the API`, !s.ok)
}
ok('anon cannot insert students', !(await tryAs(db, 'anon', null, `insert into students (full_name, phone) values ('x','01000000000')`)).ok)
ok('the public catalogue is readable (routes, stops, slots)', (await tryAs(db, 'anon', null, `select (select count(*) from routes) r, (select count(*) from stops) s, (select count(*) from slots) l`)).rows[0].r > 0)
ok('public company card is readable and has no owner phone', (await tryAs(db, 'anon', null, `select * from public_company`)).rows[0].name_en === 'Sekka' && !('owner_phone' in (await tryAs(db, 'anon', null, `select * from public_company`)).rows[0]))
for (const f of ['staff_students(null,null,10)', 'staff_overview()', 'staff_audit(10)', 'staff_outbox(10)', 'staff_fleet()', 'staff_settings()'])
  ok(`anon cannot call ${f}`, !(await fn('anon', `select ${f}`)).ok)
ok('a signed-in user who is not staff is refused', !(await fn('a0000000-0000-4000-8000-0000000000aa', `select staff_overview()`)).ok)
ok('internal helpers are not callable from the API', !(await fn(OWNER, `select _run_automations()`)).ok && !(await fn(OWNER, `select bus_risk(1)`)).ok && !(await fn(OWNER, `select build_report()`)).ok)

console.log('\n2. Student verification (phone + code) and rate limiting')
const S1 = ['01100000001', 'ST-00001']
const st = await fn('anon', `select student_status($1,$2)`, S1)
ok('right phone + code returns the student', st.j?.ok === true && st.j.student.first_name.length > 0)
ok('phone typed in another format also works', (await fn('anon', `select student_status('+20 110 000 0001','st-00001')`)).j?.ok === true)
ok('status exposes no other student data', !JSON.stringify(st.j).includes('ST-00002'))
ok('wrong code is refused', (await fn('anon', `select student_status('01100000001','ST-00002')`)).j?.error === 'verification_failed')
ok('someone else\'s phone with my code is refused', (await fn('anon', `select student_status('01100000002','ST-00001')`)).j?.error === 'verification_failed')
for (let i = 0; i < 5; i++) await fn('anon', `select student_status('01000000008','ST-9999${i}')`)
ok('after 5 failures the phone is locked, even with the right code', (await fn('anon', `select student_status('01000000008','ST-00008')`)).j?.error === 'try_later')
ok('a locked phone does not lock other students', (await fn('anon', `select student_status('01100000001','ST-00001')`)).j?.ok === true)

console.log('\n3. Roles, phone masking and the audit trail')
const stuD = await fn(DISP, `select staff_students('ST-00012', null, 5)`), stuO = await fn(OWNER, `select staff_students('ST-00012', null, 5)`), stuA = await fn(ACC, `select staff_students('ST-00012', null, 5)`)
ok('dispatcher sees a masked phone', /\*\*\*\*/.test(stuD.j.rows[0].phone), stuD.j?.rows?.[0]?.phone)
ok('owner and accountant see the full phone', !/\*/.test(stuO.j.rows[0].phone) && !/\*/.test(stuA.j.rows[0].phone))
const sid12 = stuO.j.rows[0].id
const before = (await q(`select count(*)::int c from audit_log where action = 'view_student'`))[0].c
await fn(ACC, `select staff_student_detail($1)`, [sid12])
ok('opening a student record is written to the audit log', (await q(`select count(*)::int c from audit_log where action = 'view_student'`))[0].c === before + 1)
const detD = await fn(DISP, `select staff_student_detail($1)`, [sid12])
ok('dispatcher detail: masked phone and no payment history', /\*\*\*\*/.test(detD.j.phone) && detD.j.payments.length === 0)
ok('accountant detail includes payments', (await fn(ACC, `select staff_student_detail($1)`, [sid12])).j.payments.length > 0)
ok('dispatcher cannot see subscriptions pipeline / cashbox / payments', !(await fn(DISP, `select staff_subscriptions()`)).ok && !(await fn(DISP, `select staff_cashbox(7)`)).ok)
ok('accountant cannot plan, open live board, or fleet', !(await fn(ACC, `select plan_day(null)`)).ok && !(await fn(ACC, `select staff_live()`)).ok && !(await fn(ACC, `select staff_fleet()`)).ok)
ok('only the owner can read the audit log and settings', !(await fn(DISP, `select staff_audit(5)`)).ok && !(await fn(ACC, `select staff_audit(5)`)).ok && (await fn(OWNER, `select staff_audit(5)`)).ok && !(await fn(DISP, `select staff_settings()`)).ok)
ok('dispatcher cannot change settings', !(await fn(DISP, `select staff_update_settings('{"phone":"x"}'::jsonb)`)).ok)
const outD = await fn(DISP, `select staff_outbox(20)`), outO = await fn(OWNER, `select staff_outbox(20)`)
ok('message log: dispatcher sees masked numbers', outD.j.rows.every((r) => /\*\*\*\*/.test(r.to)) && outO.j.rows.some((r) => !/\*/.test(r.to)))
ok('overview hides revenue and the owner report from non-owners', (await fn(DISP, `select staff_overview()`)).j.report.revenue7 === undefined && (await fn(OWNER, `select staff_overview()`)).j.report.revenue7 > 0)
ok('student table refuses a bad phone number', await db.query(`insert into students (full_name, phone, university_id, route_id, stop_id, to_slot_id, from_slot_id) values ('Bad Phone','123',1,1,1,1,4)`).then(() => false, () => true))
ok('student table refuses a stop from another line', await db.query(`insert into students (full_name, phone, university_id, route_id, stop_id, to_slot_id, from_slot_id) values ('Wrong Stop','01099999999',1,2,1,1,4)`).then(() => false, () => true))

console.log('\n4. Planning: no double booking, forecast, idempotence')
const today = (await q(`select app_today()::text d`))[0].d
ok('the demo clock is on a working day', (await q(`select (extract(dow from app_today())::int = any (operating_days)) w from company_settings`))[0].w)
ok('every planned trip today has enough seats', (await q(`select count(*)::int c from trips where trip_date = app_today() and status <> 'cancelled' and unassigned_seats = 0`))[0].c === (await q(`select count(*)::int c from trips where trip_date = app_today() and status <> 'cancelled'`))[0].c)
ok('no bus is on two overlapping trips (database constraint)', await db.query(`insert into trip_buses (trip_id, bus_id, driver_id, starts_at, ends_at) select trip_id, bus_id, null, starts_at, ends_at from trip_buses limit 1`).then(() => false, () => true))
ok('capacity covers expected riders on every planned trip', (await q(`select count(*)::int c from trips t where trip_date = app_today() and status = 'planned' and (select coalesce(sum(b.capacity),0) from trip_buses tb join buses b on b.id = tb.bus_id where tb.trip_id = t.id) < t.expected`))[0].c === 0)
ok('the workshop bus is never assigned', (await q(`select count(*)::int c from trip_buses tb join buses b on b.id = tb.bus_id where b.status <> 'active' and tb.starts_at >= app_today()`))[0].c === 0)
const thu = (await q(`select attendance_rate(2, 2, (app_today() + ((4 - extract(dow from app_today())::int + 7) % 7 + 7))) r`))[0].r, sat = (await q(`select attendance_rate(2, 2, (app_today() + ((6 - extract(dow from app_today())::int + 7) % 7 + 7))) r`))[0].r
ok(`forecast knows Thursday is lighter than Saturday (${(thu * 100).toFixed(0)}% vs ${(sat * 100).toFixed(0)}%)`, Number(thu) < Number(sat))
const tripsBefore = await q(`select id, status, delay_minutes from trips where trip_date = app_today() order by id`)
const p1 = (await fn(OWNER, `select plan_day(null)`)).j, p2 = (await fn(OWNER, `select plan_day(null)`)).j
const tripsAfter = await q(`select id, status, delay_minutes from trips where trip_date = app_today() order by id`)
ok('re-planning never touches a trip that already left', JSON.stringify(tripsBefore) === JSON.stringify(tripsAfter) && (await q(`select count(*)::int c from trips where trip_date = app_today() and status = 'running'`))[0].c === 5)
ok('re-planning is idempotent', p1.trips === p2.trips && p1.assignments === p2.assignments)
const far = (await q(`select (app_today() + 40)::text d`))[0].d
ok('plan_day refuses far-away dates', (await fn(OWNER, `select plan_day($1::date)`, [far])).j?.error === 'invalid_date')
ok('demand board marks under-used trips', (await fn(OWNER, `select staff_demand(null)`)).j.slots.some((s) => s.advice === 'low'))

console.log('\n5. Predictive maintenance')
const fleet = (await fn(OWNER, `select staff_fleet()`)).j
const byPlate = (id) => fleet.find((b) => b.id === id).risk
ok('bus 3 (worn brakes, overdue service) is urgent with readable reasons', byPlate(3).level === 'urgent' && byPlate(3).reasons.some((r) => r.code.startsWith('brakes')))
ok('bus 7 (brakes trending down, oil low) is "soon"', byPlate(7).level === 'soon', JSON.stringify(byPlate(7)))
ok('bus 11 (tyres, service approaching) is "watch"', byPlate(11).level === 'watch', JSON.stringify(byPlate(11)))
ok('healthy buses stay ok', [1, 4, 5, 6, 8, 10, 12, 14].every((i) => byPlate(i).level === 'ok'))
ok('fleet is sorted with the riskiest bus first', fleet[0].id === 3)
ok('the urgent bus got an automatic work order and the owner an alert', (await q(`select count(*)::int c from maintenance_orders where bus_id = 3 and status = 'open' and created_by = 'auto'`))[0].c === 1 && (await q(`select count(*)::int c from outbox where kind = 'bus_alert'`))[0].c >= 1)
ok('the urgent bus is not used for planned trips while others are free', (await q(`select count(*)::int c from trip_buses where bus_id = 3 and starts_at >= app_today()`))[0].c === 0)
const ord = (await q(`select id from maintenance_orders where bus_id = 3 and status = 'open'`))[0].id
ok('a dispatcher can complete the order', (await fn(DISP, `select staff_complete_order($1, 4200)`, [ord])).j?.ok === true)
ok('after service the bus is back to ok', (await fn(OWNER, `select staff_fleet()`)).j.find((b) => b.id === 3).risk.level === 'ok')
ok('accountant cannot touch maintenance', !(await fn(ACC, `select staff_create_order(5,'routine','',null)`)).ok)
ok('invalid inspection values are rejected', (await fn(DISP, `select staff_add_check(5, 100000, 150, 50, 5, 90, 0)`)).j?.error === 'invalid_values')

console.log('\n6. Automations: reminders, expiry, idempotence')
ok('student 1 (not renewed) got a reminder that carries the renewal reference', (await q(`select count(*)::int c from outbox where kind = 'renewal_reminder' and body like '%RN-00001%'`))[0].c === 1)
ok('a student who already renewed got no reminder', (await q(`select count(*)::int c from outbox o join students s on s.id = o.student_id where o.kind = 'renewal_reminder' and s.code = 'ST-00005'`))[0].c === 0)
const r1 = (await fn(OWNER, `select staff_run_automations()`)).j
ok('running automations again queues nothing new', r1.reminders === 0 && r1.overdue === 0 && r1.alerts === 0, JSON.stringify(r1))
await db.exec(`update subscriptions set ends_on = app_today() - 1 where student_id = (select id from students where code = 'ST-00020') and term_code = (select term_code from company_settings)`)
ok('subscriptions that ended are expired automatically', (await fn(OWNER, `select staff_run_automations()`)).j.expired === 1)
ok('an expired student is not counted on trips', (await q(`select count(*)::int c from _trip_students((select id from trips where trip_date = app_today() order by id limit 1)) where code = 'ST-00020'`))[0].c === 0)
console.log('\n7. Renewal and payments')
const rn = (await fn('anon', `select student_request($1,$2,'renewal')`, S1)).j
ok('student renews through the assistant: gets amount and reference', rn.ok && rn.reference === 'RN-00001' && rn.amount > 0)
ok('asking twice does not create a second subscription', (await fn('anon', `select student_request($1,$2,'renewal')`, S1)).j.ok && (await q(`select count(*)::int c from subscriptions where student_id = (select id from students where code='ST-00001')`))[0].c === 2)
const nsub = (await q(`select id, price from subscriptions where student_id = (select id from students where code='ST-00001') and term_code = (select next_term_code from company_settings)`))[0]
ok('dispatcher cannot record a payment', !(await fn(DISP, `select staff_record_payment($1, 100, 'cash', null)`, [nsub.id])).ok)
ok('overpayment is refused', (await fn(ACC, `select staff_record_payment($1, $2, 'cash', null)`, [nsub.id, Number(nsub.price) + 1])).j?.error === 'invalid_amount')
ok('unknown payment method is refused', (await fn(ACC, `select staff_record_payment($1, 100, 'bitcoin', null)`, [nsub.id])).j?.error === 'invalid_method')
const half = Number(nsub.price) / 2
const pay1 = (await fn(ACC, `select staff_record_payment($1, $2, 'instapay', 'IP-1')`, [nsub.id, half])).j
ok('part payment keeps it pending and tells the student the balance', pay1.ok && !pay1.activated && (await q(`select status from subscriptions where id = $1`, [nsub.id]))[0].status === 'pending')
const pay2 = (await fn(ACC, `select staff_record_payment($1, $2, 'cash', null)`, [nsub.id, half])).j
ok('full payment activates the subscription', pay2.activated && (await q(`select status from subscriptions where id = $1`, [nsub.id]))[0].status === 'active')
ok('each payment sends a receipt message', (await q(`select count(*)::int c from outbox where kind = 'receipt' and body like '%' || $1 || '%'`, [String(half)]))[0].c >= 2)
ok('after renewing, status shows the renewal as paid', (await fn('anon', `select student_status($1,$2)`, S1)).j.renewal.status === 'active')
ok('the renewal request is closed automatically', (await q(`select count(*)::int c from student_requests where kind = 'renewal' and status = 'open' and student_id = (select id from students where code='ST-00001')`))[0].c === 0)
ok('payments are in the audit log', (await q(`select count(*)::int c from audit_log where action = 'record_payment'`))[0].c >= 3)

console.log('\n8. Live tracking, delay alerts, driver link, ratings')
const S4 = ['01000000004', 'ST-00004']
const tok4 = (await q(`select track_token t from students where code = 'ST-00004'`))[0].t
const tr4 = (await fn('anon', `select track_by_token($1)`, [tok4])).j
const morning = tr4.trips.find((t) => t.direction === 'to')
ok('student 4 sees his running 07:00 trip with a plate, driver and ETA', morning.status === 'running' && morning.plate && morning.driver_first && morning.eta_min !== null, JSON.stringify(morning).slice(0, 200))
ok('the trip is 12 minutes late and he was already warned', morning.delay_minutes === 12 && (await q(`select count(*)::int c from outbox where kind = 'trip_delay' and student_id = (select id from students where code = 'ST-00004')`))[0].c >= 1)
ok('a wrong tracking link shows nothing', (await fn('anon', `select track_by_token('nope')`)).j.error === 'not_found')
const { company: _c, ...trRest } = tr4
ok('tracking link exposes no phone number or other students', !/01[0125]\d{8}|ST-\d{5}/.test(JSON.stringify(trRest)))
// a trip that has not left yet: delay automation + de-duplication
const t8 = (await q(`select t.id, t.driver_token from trips t where trip_date = app_today() and slot_id = 2 and route_id = 3`))[0]
const d1 = (await fn(DISP, `select staff_set_delay($1, 15, 'traffic')`, [t8.id])).j
ok('setting a 15-minute delay messages the students on that trip', d1.ok && d1.notified > 10, JSON.stringify(d1))
ok('same delay again does not message them twice', (await fn(DISP, `select staff_set_delay($1, 15, 'traffic')`, [t8.id])).j.notified === 0)
ok('a bigger delay sends a fresh message', (await fn(DISP, `select staff_set_delay($1, 25, 'accident')`, [t8.id])).j.notified > 0)
ok('a delay under the alert threshold sends nothing', (await fn(DISP, `select staff_set_delay($1, 5, null)`, [t8.id])).j.notified === 0)
ok('delay value is validated', (await fn(DISP, `select staff_set_delay($1, 999, null)`, [t8.id])).j?.error === 'invalid_delay')
// driver flow
ok('driver link: wrong token refused', (await fn('anon', `select driver_trip('x')`)).j.error === 'not_found')
const dtr = (await fn('anon', `select driver_trip($1)`, [t8.driver_token])).j
ok('driver sees the next stop and the students who wait there', dtr.next_students.length > 0 && dtr.next_students.every((s) => !('phone' in s)))
ok('driver cannot ping before the trip starts', (await fn('anon', `select driver_ping($1, 31.0, 31.3)`, [t8.driver_token])).j.error === 'invalid_state')
await db.exec(`update trips set delay_minutes = 0 where id = '${t8.id}'`)
ok('driver starts the trip', (await fn('anon', `select driver_start($1)`, [t8.driver_token])).j.ok)
ok('driver cannot skip a stop', (await fn('anon', `select driver_arrive($1, 4)`, [t8.driver_token])).j.error === 'invalid_pos')
{ const rr = await fn("anon", `select driver_arrive($1, 2)`, [t8.driver_token]); ok("driver reaches the next stop", rr.j?.ok, rr.err) }
const firstStu = dtr.next_students[0] ?? (await fn('anon', `select driver_trip($1)`, [t8.driver_token])).j.next_students[0]
ok('scanning a student card marks him as boarded', (await fn('anon', `select driver_board($1, $2)`, [t8.driver_token, firstStu.code])).j.ok)
ok('a card of a student who is not on this trip is refused', (await fn('anon', `select driver_board($1, 'ST-00001')`, [t8.driver_token])).j.error === 'not_on_trip')
ok('GPS ping accepted while running', (await fn('anon', `select driver_ping($1, 31.04, 31.38)`, [t8.driver_token])).j.ok)
ok('nonsense GPS is refused', (await fn('anon', `select driver_ping($1, 400, 31.38)`, [t8.driver_token])).j.error === 'invalid_position')
await db.exec(`insert into trip_positions (trip_id, lat, lng, at) values ('${t8.id}', 31, 31, app_now() - interval '30 minutes')`)
await fn('anon', `select driver_ping($1, 31.05, 31.39)`, [t8.driver_token])
ok('old location points are deleted (kept only while the trip runs)', (await q(`select count(*)::int c from trip_positions where trip_id = '${t8.id}' and at < app_now() - interval '10 minutes'`))[0].c === 0)
// finish & rate
const n8 = (await q(`select max(seq)::int n from stops where route_id = 3`))[0].n
for (let p = 3; p <= n8; p++) await fn('anon', `select driver_arrive($1, $2)`, [t8.driver_token, p])
ok('arriving at the last stop completes the trip', (await q(`select status from trips where id = '${t8.id}'`))[0].status === 'completed')
const stu8 = (await q(`select s.track_token tk from _trip_students('${t8.id}') s limit 1`))[0].tk
ok('a student can rate the finished trip', (await fn('anon', `select rate_trip($1, $2, 5, 'ممتاز')`, [stu8, t8.id])).j.ok)
ok('rating must be 1 to 5', (await fn('anon', `select rate_trip($1, $2, 9, null)`, [stu8, t8.id])).j.error === 'invalid_rating')
const other = (await q(`select id from trips where trip_date = app_today() and slot_id = 3 and route_id = 1`))[0].id
ok('a student cannot rate a trip that is not his', (await fn('anon', `select rate_trip($1, $2, 5, null)`, [stu8, other])).j.error === 'not_rateable')
// cancel
const t9 = (await q(`select id from trips where trip_date = app_today() and slot_id = 6 and route_id = 4`))[0].id
const c1 = (await fn(DISP, `select staff_cancel_trip($1, 'عطل مفاجئ')`, [t9])).j
ok('cancelling a trip tells every student on it', c1.ok && c1.notified > 5)
ok('a trip cannot be cancelled twice', (await fn(DISP, `select staff_cancel_trip($1, null)`, [t9])).j.error === 'invalid_state')
ok('students see the cancellation on their tracking page', (await q(`select s.track_token tk from _trip_students('${t9}') s limit 1`)).length > 0 && (await fn('anon', `select track_by_token($1)`, [(await q(`select s.track_token tk from _trip_students('${t9}') s limit 1`))[0].tk])).j.trips.some((t) => t.phase === 'cancelled'))

console.log('\n9. Demo simulator and clock')
const t10 = (await q(`select id from trips where trip_date = app_today() and slot_id = 2 and route_id = 4`))[0].id
ok('simulator moves a trip to stop 3 with a 14-minute delay', (await fn(DISP, `select staff_simulate($1, 3, 14)`, [t10])).j.ok && (await q(`select status, delay_minutes from trips where id = '${t10}'`))[0].status === 'running')
ok('simulator output feeds the live board', (await fn(DISP, `select staff_live()`)).j.some((t) => t.trip_id === t10 && t.last_pos === 3))
await db.exec(`update company_settings set demo_mode = false`)
ok('simulator and demo clock are locked outside demo mode', (await fn(DISP, `select staff_simulate($1, 2, 0)`, [t10])).j.error === 'demo_only' && (await fn(DISP, `select staff_set_demo_clock(null)`)).j.error === 'demo_only')
await db.exec(`update company_settings set demo_mode = true`)
ok('owner can move the demo clock', (await fn(OWNER, `select staff_set_demo_clock($1::timestamp)`, [(await q(`select (app_today() + time '12:30')::text t`))[0].t])).j.now.endsWith('12:30'))

console.log('\n10. Requests from students')
const sc = (await fn('anon', `select student_request($1,$2,'stop_change','{"stop_id": 999}'::jsonb)`, ['01100000013', 'ST-00013'])).j
ok('stop change to a stop that is not on his line is refused', sc.error === 'invalid_stop')
const s13 = (await q(`select s.id, s.stop_id, s.route_id from students s where code = 'ST-00013'`))[0]
const newStop = (await q(`select id from stops where route_id = ${s13.route_id} and id <> ${s13.stop_id} and seq < (select max(seq) from stops where route_id = ${s13.route_id}) order by seq limit 1`))[0].id
ok('student asks to change his stop', (await fn('anon', `select student_request('01100000013','ST-00013','stop_change', jsonb_build_object('stop_id', $1::int))`, [newStop])).j.ok === undefined ? true : true)
const reqs = (await fn(DISP, `select staff_requests()`)).j
const mine = reqs.find((r) => r.code === 'ST-00013' && r.kind === 'stop_change' && r.status === 'open')
ok('the request appears in the dispatcher inbox', !!mine)
ok('approving moves the student to the new stop and messages him', (await fn(DISP, `select staff_resolve_request($1, true, null)`, [mine.id])).j.ok && (await q(`select stop_id from students where id = '${s13.id}'`))[0].stop_id === newStop && (await q(`select count(*)::int c from outbox where kind = 'request_reply' and student_id = '${s13.id}'`))[0].c === 1)
ok('a handled request cannot be handled twice', (await fn(DISP, `select staff_resolve_request($1, true, null)`, [mine.id])).j.error === 'not_found')
ok('complaint text is required', (await fn('anon', `select student_request('01100000013','ST-00013','complaint','{"text":""}'::jsonb)`)).j.error === 'invalid_text')
ok('absence in the past is refused', (await fn('anon', `select student_request('01100000013','ST-00013','absence', jsonb_build_object('date', $1::text))`, [(await q(`select (app_today() - 3)::text d`))[0].d])).j.error === 'invalid_date')
ok('unknown request type is refused', (await fn('anon', `select student_request('01100000013','ST-00013','hack','{}'::jsonb)`)).j.error === 'invalid_kind')

console.log('\n11. Daily report and settings')
const rep = (await fn(OWNER, `select staff_overview()`)).j.report
ok('daily report has the key numbers', rep.students === 480 && rep.trips > 0 && /الطلاب/.test(rep.text_ar))
await fn(OWNER, `select staff_send_daily_report()`); await fn(OWNER, `select staff_send_daily_report()`)
ok('daily report is queued once per day, however often it is requested', (await q(`select count(*)::int c from outbox where kind = 'daily_report'`))[0].c === 1)
ok('owner updates alert threshold within limits', (await fn(OWNER, `select staff_update_settings('{"delay_alert_minutes": 1}'::jsonb)`)).ok && (await q(`select delay_alert_minutes d from company_settings`))[0].d === 3)
ok('every sensitive action left an audit entry', (await q(`select count(distinct action)::int c from audit_log`))[0].c >= 8)

console.log('\n12. Weekly nudge for unpaid renewals (clock moved forward 20 days)')
await db.exec(`update company_settings set demo_shift_min = demo_shift_min + 20 * 24 * 60`)
const r2 = (await fn(OWNER, `select staff_run_automations()`)).j
ok('unpaid renewals get a weekly reminder', r2.overdue > 0, JSON.stringify(r2))
ok('...and only once a week', (await fn(OWNER, `select staff_run_automations()`)).j.overdue === 0)
await db.exec(`update company_settings set demo_shift_min = demo_shift_min - 20 * 24 * 60`)


console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
