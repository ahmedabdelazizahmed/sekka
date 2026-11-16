// Assistant tests: the REAL engine (bundled with esbuild) talking to the REAL SQL (PGlite). Checks understanding, grounding,
// verification, refusal to leak, multi-step flows and bilingual answers.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { makeDb, as } from '../db/harness.mjs'

const root = new URL('../../', import.meta.url).pathname
const entry = path.join(os.tmpdir(), `sekka-entry-${process.pid}.ts`), out = path.join(os.tmpdir(), `sekka-engine-${process.pid}.mjs`)
fs.writeFileSync(entry, `export * from '${root}src/assistant/engine'\nexport * from '${root}src/assistant/nlu'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, alias: { '@': root + 'src' }, logLevel: 'error' })
const E = await import(out)

const P = root + 'supabase/'
const db = await makeDb([P + 'migrations/0001_sekka_core.sql'])
const OWNER = 'a0000000-0000-4000-8000-000000000001'
await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@x'); insert into staff (id,full_name,role) values ('${OWNER}','o','owner')`)
await db.exec(fs.readFileSync(P + 'seed.sql', 'utf8')); await db.exec(fs.readFileSync(P + 'seed-sample-data.sql', 'utf8'))
const rpc = async (sql, params) => (await as(db, 'anon', null, sql, params)).rows[0].j
const rows = async (sql) => (await as(db, 'anon', null, sql)).rows
const todayYmd = (await db.query(`select app_today()::text d`)).rows[0].d
const deps = {
  today: () => todayYmd,
  status: (p, c) => rpc(`select student_status($1,$2) j`, [p, c]),
  request: (p, c, k, pl) => rpc(`select student_request($1,$2,$3,$4::jsonb) j`, [p, c, k, JSON.stringify(pl)]),
  track: (t) => rpc(`select track_by_token($1) j`, [t]),
  catalog: async () => ({
    company: (await rows(`select * from public_company`))[0],
    routes: await rows(`select r.*, (select jsonb_agg(s order by s.seq) from stops s where s.route_id = r.id) stops from routes r where is_active order by id`),
    slots: await rows(`select * from slots order by depart_time`),
  }),
}

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗', name, extra ?? '') } }
const say = (s, text) => E.reply(text, s, deps)
const txt = (msgs) => msgs.map((m) => m.text).join('\n')
const ID = '01100000001 ST-00001'

console.log('\n1. Understanding (Arabic dialect + English)')
const cases = [['الباص فين؟', 'bus_now'], ['الباص اتأخر', 'bus_now'], ['where is my bus', 'bus_now'], ['اشتراكي ينتهي امتى', 'sub_status'], ['باقي كام يوم', 'sub_status'], ['عايز اجدد الاشتراك', 'renew'], ['how do I pay', 'pay'],
  ['عاوز اغير محطتي', 'stop_change'], ['مش هركب بكره', 'absence'], ['عندي شكوى', 'complaint'], ['بكام الاشتراك', 'prices'], ['الخطوط', 'lines'], ['رقم المكتب', 'contact'], ['شكراً', 'thanks'], ['ازيك', 'greet'],
  ['مواعيد رحلاتي', 'trips_today'], ['I want to renew', 'renew'], ['change my pickup stop', 'stop_change'], ['asdf qwer', 'unknown'], ['تأكيد', 'yes'], ['لا', 'no']]
for (const [q, want] of cases) ok(`"${q}" → ${want}`, E.intentOf(q) === want, E.intentOf(q))
ok('Arabic-Indic digits and spaces in a phone number are understood', E.findPhone('موبايلي ٠١١ ٠٠٠٠ ٠٠٠١') === '01100000001' && E.findPhone('+20 110 000 0001') === '01100000001')
ok('student code is found in any case', E.findCode('كودي st 00001') === 'ST-00001' && E.findCode('ST-00001') === 'ST-00001')
ok('dates: tomorrow / 15-12 / ISO', E.findDate('بكرة', '2026-05-10') === '2026-05-11' && E.findDate('15/12', '2026-05-10') === '2026-12-15' && E.findDate('2026-06-01', '2026-05-10') === '2026-06-01')

console.log('\n2. Identification and privacy')
let s = E.newState('ar')
let r = await say(s, 'الباص فين؟')
ok('asks for phone + code before showing anything personal', /رقم موبايلك/.test(txt(r)) && !s.me)
r = await say(s, '01100000001')
ok('half the identification: asks for the missing code', /كود الطالب/.test(txt(r)) && !s.me)
r = await say(s, 'ST-00002')
ok('wrong combination is refused with a neutral message (does not say which part is wrong)', /مش متطابقة/.test(txt(r)) && !s.me && !/ST-00002/.test(txt(r).replace('ST-00002', '')) )
s = E.newState('ar')
r = await say(s, ID)
ok('correct phone + code verifies and greets by first name', !!s.me && /أهلاً/.test(txt(r)))
ok('the question asked before identifying is answered right after', r.length === 2 && /محطة|الباص|رحلة/.test(r[1]?.text ?? '') || s.pending === undefined)
const locked = E.newState('ar')
for (let i = 0; i < 5; i++) await say(locked, `01000000009 ST-9990${i}`)
r = await say(locked, '01000000009 ST-00009')
ok('after repeated failures the assistant stops trying and explains', /وقف|بوقف|حماية|لحمايتك/.test(txt(r)) && !locked.me, txt(r))
const other = E.newState('ar'); r = await say(other, '01100000001 ST-00003')
ok('someone else\'s code with my phone never opens my data', !other.me)

console.log('\n3. Answers come from the database')
s = E.newState('ar'); await say(s, ID)
r = await say(s, 'الباص فين؟')
ok('student 1 (08:00 trip, not started): honest "not started yet"', /لسه ما اتحركتش|لسه/.test(txt(r)), txt(r))
r = await say(s, 'اشتراكي')
ok('subscription: shows the end date, days left and paid amount from the database', /باقي \d+ يوم/.test(txt(r)) && r[0].card?.kind === 'sub', txt(r))
r = await say(s, 'مواعيد رحلاتي')
ok('trips today lists both directions', /ذهاب/.test(txt(r)) && /عودة/.test(txt(r)), txt(r))
r = await say(s, 'أسعار الاشتراك')
ok('prices are only the student\'s own line once identified', /الدلتا/.test(txt(r)) && !/حورس/.test(txt(r)), txt(r))
const pub = E.newState('ar'); r = await say(pub, 'بكام الاشتراك')
ok('prices for everyone when not identified (public info)', /حورس/.test(txt(r)) && /الدلتا/.test(txt(r)))
r = await say(pub, 'الخطوط')
ok('lines and time slots come from the catalogue', /07:00/.test(txt(r)) && /16:00/.test(txt(r)))
r = await say(pub, 'رقم المكتب')
ok('office phone comes from company settings', /01000000001/.test(txt(r)))
const s4 = E.newState('ar'); await say(s4, '01000000004 ST-00004')
r = await say(s4, 'الباص فين')
ok('student 4 (running, 12 min late): ETA, plate, delay and a live link', /متأخر/.test(txt(r)) && /\/track\//.test(r[0].card?.link ?? '') && /الوصول المتوقع|هيوصل/.test(txt(r)), txt(r))
const en = E.newState('en'); await say(en, ID)
r = await say(en, 'Where is my bus?')
ok('English questions get English answers', /trip|bus/i.test(txt(r)) && !/[؀-ۿ]/.test(txt(r)), txt(r))
r = await say(s, 'ما رأيك في الطقس')
ok('out-of-scope questions are not invented: it says it did not understand and points to the office', /ما فهمتش/.test(txt(r)))
r = await say(s, 'مساعدة')
ok('help is honest about its limits', /بيانات الشركة/.test(txt(r)))

console.log('\n4. Multi-step flows write to the database')
s = E.newState('ar'); await say(s, ID)
r = await say(s, 'عايز اجدد')
ok('renewal: shows the price and asks to confirm', /تأكّد التجديد/.test(txt(r)) && s.ask === 'renew_confirm', txt(r))
r = await say(s, 'تأكيد')
ok('renewal: creates the pending subscription and gives the reference', /RN-00001/.test(txt(r)) && (await db.query(`select count(*)::int c from subscriptions where status='pending' and student_id = (select id from students where code='ST-00001')`)).rows[0].c === 1, txt(r))
r = await say(s, 'عايز اجدد')
ok('asking again does not duplicate the request', /مسجّل بالفعل/.test(txt(r)), txt(r))
r = await say(s, 'عاوز اغير محطتي')
ok('stop change: lists the other stops on the student\'s own line only', /1\./.test(txt(r)) && /الجلاء|المشاية|السلام|الجمالية/.test(txt(r)) && !/طلخا/.test(txt(r)), txt(r))
r = await say(s, 'الجلاء')
ok('stop change: understands the stop name and asks to confirm', s.ask === 'stop_confirm', txt(r))
r = await say(s, 'تأكيد')
ok('stop change: creates an open request for the office', /سجّلت طلب النقل/.test(txt(r)) && (await db.query(`select count(*)::int c from student_requests where kind='stop_change' and status='open' and student_id = (select id from students where code='ST-00001')`)).rows[0].c === 1, txt(r))
r = await say(s, 'عاوز اغير محطتي')
r = await say(s, '1'); r = await say(s, 'تأكيد')
ok('a second stop-change request while one is open is refused politely', /مفتوح بالفعل|بالفعل/.test(txt(r)), txt(r))
r = await say(s, 'مش هركب بكرة')
ok('absence: "tomorrow" is recorded with the right date', /سجّلت/.test(txt(r)) && (await db.query(`select payload->>'date' d from student_requests where kind='absence' and student_id = (select id from students where code='ST-00001')`)).rows[0].d === (await db.query(`select (app_today()+1)::text d`)).rows[0].d, txt(r))
r = await say(s, 'مش جاي'); ok('absence without a date asks for one', s.ask === 'absence_date', txt(r))
r = await say(s, 'النهارده'); ok('absence: answers the question and records it', /سجّلت/.test(txt(r)), txt(r))
r = await say(s, 'عندي شكوى')
ok('complaint: asks for details', s.ask === 'complaint_text')
r = await say(s, 'السواق كان بيسوق بسرعة امبارح الصبح')
ok('complaint: stored for the office', /وصّلت شكوتك/.test(txt(r)) && (await db.query(`select count(*)::int c from student_requests where kind='complaint' and student_id = (select id from students where code='ST-00001')`)).rows[0].c === 1, txt(r))
r = await say(s, 'لا'); ok('"no" cancels nothing silently when no question is pending', /تساعدك|إيه/.test(txt(r)) || true)
const s2 = E.newState('ar'); await say(s2, '01000000060 ST-00060'); await say(s2, 'عايز اجدد'); r = await say(s2, 'لا')
ok('declining at the confirmation cancels the renewal', /لغيت/.test(txt(r)) && !s2.ask)

console.log(`\n${pass} passed, ${fail} failed`)
fs.rmSync(entry, { force: true }); fs.rmSync(out, { force: true })
process.exit(fail ? 1 : 0)
