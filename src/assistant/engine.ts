// The student assistant. It answers ONLY from the company database (through `Deps`), asks for phone + student code before
// showing anything personal, and never invents. The same engine can sit behind a WhatsApp Business webhook.
import { detectLang, findCode, findDate, findPhone, intentOf, norm, type Intent, type Lang } from './nlu'
import type { Company, RouteRow, Slot, StudentStatus, TrackResult } from '@/lib/types'

export interface Deps {
  today: () => string                                 // YYYY-MM-DD on the company clock
  status: (phone: string, code: string) => Promise<StudentStatus>
  request: (phone: string, code: string, kind: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  track: (token: string) => Promise<TrackResult>
  catalog: () => Promise<{ company: Company; routes: RouteRow[]; slots: Slot[] }>
}
export type Ask = 'stop' | 'absence_date' | 'complaint_text' | 'renew_confirm' | 'stop_confirm'
export interface State {
  lang: Lang; phone?: string; code?: string; me?: StudentStatus
  draftPhone?: string; draftCode?: string
  pending?: Intent; ask?: Ask; stopChoice?: { id: number; name: string }
}
export interface Card { kind: 'trip' | 'sub'; title: string; lines: string[]; progress?: number; link?: string; tone?: 'ok' | 'warn' | 'bad' }
export interface Bot { text: string; card?: Card; chips?: string[] }
export const newState = (lang: Lang = 'ar'): State => ({ lang })

const t = (s: State, ar: string, en: string) => (s.lang === 'ar' ? ar : en)
const nm = (s: State, o: { name_ar: string; name_en: string }) => (s.lang === 'ar' ? o.name_ar : o.name_en)
const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
const fmtDate = (ymd: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ymd + 'T12:00:00Z'))

const chipsMain = (s: State) => (s.lang === 'ar' ? ['الباص فين؟', 'مواعيد رحلاتي', 'اشتراكي', 'تجديد الاشتراك', 'أسعار الاشتراك'] : ['Where is my bus?', 'My trips', 'My subscription', 'Renew', 'Prices'])
const chipsPublic = (s: State) => (s.lang === 'ar' ? ['أسعار الاشتراك', 'الخطوط والمحطات', 'رقم المكتب', 'الباص فين؟'] : ['Prices', 'Lines and stops', 'Office phone', 'Where is my bus?'])

export const greeting = (s: State, company?: Company): Bot => ({
  text: t(s, `أهلاً بيك في ${company?.name_ar ?? 'سكّة'} 👋\nأنا المساعد بتاع الشركة. أقدر أقولك الباص فين، مواعيد رحلاتك، حالة اشتراكك، وأجدّد لك الاشتراك أو أغيّر محطتك. أنا بجاوب من بيانات الشركة بس.\nعشان أشوف بياناتك اكتب رقم موبايلك وكود الطالب (مثال: 01100000001 ST-00001).`,
    `Welcome to ${company?.name_en ?? 'Sekka'} 👋\nI'm the company assistant. I can tell you where your bus is, your trip times, your subscription status, renew it, or change your stop. I only answer from the company's data.\nTo see your details, send your phone number and student code (e.g. 01100000001 ST-00001).`),
  chips: chipsPublic(s),
})

async function verify(s: State, d: Deps, phone: string, code: string): Promise<Bot[] | null> {
  const r = await d.status(phone, code)
  if (r.error === 'try_later') return [{ text: t(s, 'اتحاولت كذا مرة بالبيانات دي ومتطابقتش، فبوقف المحاولات 15 دقيقة لحمايتك. جرّب بعد شوية أو كلّم المكتب.', 'There were several failed attempts for this number, so I paused them for 15 minutes to protect your account. Try again later or call the office.') }]
  if (r.error || !r.ok) { s.draftPhone = undefined; s.draftCode = undefined; return [{ text: t(s, 'البيانات دي مش متطابقة مع اللي عندنا. اتأكد من الرقم والكود (مكتوب على كارنيه الاشتراك) وابعتهم تاني.', "Those details don't match our records. Check the number and the code on your subscription card, then send them again.") }] }
  s.phone = phone; s.code = code; s.me = r; s.draftPhone = undefined; s.draftCode = undefined
  return null
}

const needId = (s: State): Bot => ({
  text: t(s, 'عشان أعرض بياناتك محتاج رقم موبايلك المسجل وكود الطالب (مثال: 01100000001 ST-00001). ابعتهم في رسالة واحدة.', 'To show your details I need your registered phone number and student code (e.g. 01100000001 ST-00001). Send them in one message.'),
})

async function run(intent: Intent, s: State, d: Deps, text: string): Promise<Bot[]> {
  const me = s.me!
  const cat = await d.catalog()
  switch (intent) {
    case 'bus_now': case 'trips_today': {
      const tr = await d.track(me.track_token)
      if (tr.error || !tr.trips.length) return [{ text: t(s, `مفيش رحلات ليك النهارده (${fmtDate(s.me?.today ?? d.today(), 'ar')}). لو متوقع تركب كلّم المكتب: ${me.company.phone}`, `You have no trips today (${fmtDate(s.me?.today ?? d.today(), 'en')}). If you expected one, call the office: ${me.company.phone}`) }]
      if (intent === 'trips_today') {
        const lines = tr.trips.map((v) => `• ${v.time} ${v.direction === 'to' ? t(s, 'ذهاب', 'to campus') : t(s, 'عودة', 'return')} — ${t(s, ({ planned: 'لسه', on_way: 'في الطريق', near: 'قرّب', arrived: 'وصل', passed: 'عدّى محطتك', done: 'خلصت', cancelled: 'اتلغت' } as Record<string, string>)[v.phase], ({ planned: 'not started', on_way: 'on the way', near: 'near you', arrived: 'at your stop', passed: 'passed your stop', done: 'finished', cancelled: 'cancelled' } as Record<string, string>)[v.phase])}${v.delay_minutes >= 5 ? t(s, ` (متأخرة ${v.delay_minutes} د)`, ` (${v.delay_minutes} min late)`) : ''}`)
        return [{ text: t(s, `رحلاتك النهارده من محطة ${nm(s, me.stop)}:\n${lines.join('\n')}`, `Your trips today from ${nm(s, me.stop)}:\n${lines.join('\n')}`), chips: chipsMain(s) }]
      }
      const live = tr.trips.find((v) => v.status === 'running') ?? tr.trips.find((v) => v.status === 'planned') ?? tr.trips[tr.trips.length - 1]
      const link = `/track/${me.track_token}`
      const veh = live.plate ? t(s, `الباص ${live.plate}${live.driver_first ? ` (الكابتن ${live.driver_first})` : ''}`, `Bus ${live.plate}${live.driver_first ? ` (driver ${live.driver_first})` : ''}`) : t(s, 'الباص', 'The bus')
      const late = live.delay_minutes >= 5 ? t(s, ` متأخر حوالي ${live.delay_minutes} دقيقة.`, ` It is running about ${live.delay_minutes} min late.`) : ''
      const prog = Math.round(((live.pos_float ?? 0) / Math.max(live.n, 1)) * 100)
      const card = (title: string, lines: string[], tone?: 'ok' | 'warn' | 'bad'): Card => ({ kind: 'trip', title, lines, progress: prog, link, tone })
      switch (live.phase) {
        case 'planned': return [{ text: t(s, `رحلة ${live.time} لسه ما اتحركتش. هتتحرك في معادها، وأول ما تتحرك هتقدر تتابعها لحظة بلحظة.`, `The ${live.time} trip hasn't left yet. You'll be able to follow it live as soon as it starts.`), card: card(`${live.time}`, [t(s, `محطتك: ${nm(s, me.stop)}`, `Your stop: ${nm(s, me.stop)}`), t(s, `الوصول المتوقع: ${live.eta_at}`, `Expected at your stop: ${live.eta_at}`)]) }]
        case 'cancelled': return [{ text: t(s, `للأسف رحلة ${live.time} اتلغت${live.cancel_reason ? ` (${live.cancel_reason})` : ''}. كلّم المكتب لو محتاج بديل: ${me.company.phone}`, `Sorry, the ${live.time} trip is cancelled${live.cancel_reason ? ` (${live.cancel_reason})` : ''}. Call the office for an alternative: ${me.company.phone}`) }]
        case 'passed': return [{ text: t(s, `${veh} عدّى محطتك بالفعل. لو لسه مركبتش كلّم المكتب: ${me.company.phone}`, `${veh} has already passed your stop. If you missed it, call the office: ${me.company.phone}`), card: card(`${live.time}`, [t(s, 'عدّى محطتك', 'Passed your stop')]) }]
        case 'arrived': return [{ text: t(s, `${veh} وصل محطتك (${nm(s, me.stop)}) دلوقتي.`, `${veh} is at your stop (${nm(s, me.stop)}) now.`), card: card(`${live.time}`, [t(s, 'وصل محطتك', 'At your stop')], 'ok') }]
        case 'done': return [{ text: t(s, `رحلة ${live.time} خلصت. ممكن تقيّمها من صفحة المتابعة.`, `The ${live.time} trip is finished. You can rate it on the tracking page.`), card: card(`${live.time}`, [t(s, 'الرحلة خلصت', 'Trip finished')]) }]
        default: return [{ text: t(s, `${veh} في الطريق. هيوصل محطتك (${nm(s, me.stop)}) تقريباً الساعة ${live.eta_at}${live.eta_min !== null ? ` (بعد حوالي ${live.eta_min} دقيقة)` : ''}.${late}`, `${veh} is on its way. It should reach your stop (${nm(s, me.stop)}) around ${live.eta_at}${live.eta_min !== null ? ` (in about ${live.eta_min} min)` : ''}.${late}`),
          card: card(t(s, `رحلة ${live.time}`, `${live.time} trip`), [t(s, `محطتك: ${nm(s, me.stop)}`, `Your stop: ${nm(s, me.stop)}`), t(s, `الوصول: ${live.eta_at}`, `Arrival: ${live.eta_at}`)], live.delay_minutes >= 5 ? 'warn' : 'ok') }]
      }
    }
    case 'sub_status': {
      const sub = me.subscription
      if (!sub) return [{ text: t(s, 'مفيش اشتراك مسجّل ليك للترم الحالي. كلّم المكتب أو اكتب "تجديد".', 'There is no subscription recorded for you this term. Call the office or type "renew".') }]
      const term = s.lang === 'ar' ? sub.term_ar : sub.term_en
      const stat = sub.status === 'active' ? t(s, `فعّال لحد ${fmtDate(sub.ends_on, 'ar')} (باقي ${sub.days_left} يوم)`, `active until ${fmtDate(sub.ends_on, 'en')} (${sub.days_left} days left)`) : t(s, 'منتهي', 'expired')
      const bal = sub.balance > 0 ? t(s, ` المتبقي عليك ${money(sub.balance)} جنيه.`, ` Balance due: ${money(sub.balance)} EGP.`) : ''
      const ren = me.renewal.term_ar ? (me.renewal.status === 'active' ? t(s, ` وتجديدك لـ ${me.renewal.term_ar} مدفوع ✅`, ` Your renewal for ${me.renewal.term_en} is paid ✅`) : me.renewal.requested ? t(s, ` وطلب تجديدك لـ ${me.renewal.term_ar} مسجّل والمتبقي ${money(me.renewal.balance)} جنيه (المرجع ${me.renewal.reference}).`, ` Your renewal request for ${me.renewal.term_en} is recorded; ${money(me.renewal.balance)} EGP remaining (ref ${me.renewal.reference}).`) : t(s, ` تقدر تجدّد لـ ${me.renewal.term_ar} بـ ${money(me.renewal.price)} جنيه — اكتب "تجديد".`, ` You can renew for ${me.renewal.term_en} for ${money(me.renewal.price)} EGP — type "renew".`)) : ''
      return [{ text: t(s, `اشتراك ${term}: ${stat}.${bal}${ren}`, `${term} subscription: ${stat}.${bal}${ren}`),
        card: { kind: 'sub', title: term, lines: [stat, t(s, `${nm(s, me.route)}`, `${nm(s, me.route)}`), t(s, `المدفوع ${money(sub.paid)} من ${money(sub.price)} جنيه`, `Paid ${money(sub.paid)} of ${money(sub.price)} EGP`)], progress: Math.round((sub.paid / Math.max(sub.price, 1)) * 100), tone: sub.status === 'active' ? 'ok' : 'bad' }, chips: chipsMain(s) }]
    }
    case 'renew': {
      const r = me.renewal
      if (!r.term_ar) return [{ text: t(s, 'باب التجديد للترم الجاي لسه ما اتفتحش. هنبلّغك أول ما يتفتح.', 'Renewal for the next term has not opened yet. We will let you know.') }]
      if (r.status === 'active') return [{ text: t(s, `تجديدك لـ ${r.term_ar} مدفوع بالكامل ✅ مفيش حاجة مطلوبة منك.`, `Your renewal for ${r.term_en} is fully paid ✅ nothing else is needed.`) }]
      if (r.requested) return [{ text: t(s, `طلب تجديدك لـ ${r.term_ar} مسجّل بالفعل. المتبقي ${money(r.balance)} جنيه. الرقم المرجعي: ${r.reference}.\n${me.company.payment_note_ar}`, `Your renewal request for ${r.term_en} is already recorded. Remaining: ${money(r.balance)} EGP. Reference: ${r.reference}.\n${me.company.payment_note_en}`) }]
      s.ask = 'renew_confirm'
      return [{ text: t(s, `تجديد ${r.term_ar} على ${nm(s, me.route)}: ${money(r.price)} جنيه. تأكّد التجديد؟`, `Renewal for ${r.term_en} on ${nm(s, me.route)}: ${money(r.price)} EGP. Confirm the renewal?`), chips: s.lang === 'ar' ? ['تأكيد التجديد', 'لا'] : ['Confirm renewal', 'No'] }]
    }
    case 'pay': return [{ text: t(s, `طرق الدفع:\n${me.company.payment_note_ar}\nواكتب الرقم المرجعي ${me.renewal.reference} عشان نطابق الدفع. أي دفعة بتوصلك رسالة تأكيد.`, `How to pay:\n${me.company.payment_note_en}\nQuote the reference ${me.renewal.reference} so we can match your payment. You'll get a confirmation for every payment.`) }]
    case 'stop_change': {
      const route = cat.routes.find((r) => r.name_ar === me.route.name_ar)
      const stops = (route?.stops ?? []).slice().sort((a, b) => a.seq - b.seq)
      const choices = stops.slice(0, -1).filter((x) => x.id !== me.stop.id)
      if (!choices.length) return [{ text: t(s, 'مفيش محطات تانية على خطك. كلّم المكتب.', 'There are no other stops on your line. Call the office.') }]
      s.ask = 'stop'
      return [{ text: t(s, `محطتك دلوقتي: ${nm(s, me.stop)}.\nتحب تنتقل لأنهي محطة؟\n${choices.map((x, i) => `${i + 1}. ${nm(s, x)}`).join('\n')}\n(اكتب الرقم أو اسم المحطة. الطلب بيتراجع من المكتب.)`, `Your stop now: ${nm(s, me.stop)}.\nWhich stop do you want to move to?\n${choices.map((x, i) => `${i + 1}. ${nm(s, x)}`).join('\n')}\n(Type the number or the name. The office reviews the request.)`), chips: choices.map((x) => nm(s, x)) }]
    }
    case 'absence': {
      const dt = findDate(text, s.me?.today ?? d.today())
      if (dt) return doAbsence(s, d, dt, text)
      s.ask = 'absence_date'
      return [{ text: t(s, 'تمام. أنهي يوم مش هتركب فيه؟ (النهارده / بكرة / تاريخ زي 15/12)', 'OK. Which day will you miss? (today / tomorrow / a date like 15/12)'), chips: s.lang === 'ar' ? ['النهارده', 'بكرة'] : ['Today', 'Tomorrow'] }]
    }
    case 'complaint': {
      const body = text.replace(/(شكوى|شكوي|اشتكي|complaint|complain)/gi, '').trim()
      if (norm(body).length >= 12) return doComplaint(s, d, body)
      s.ask = 'complaint_text'
      return [{ text: t(s, 'آسفين لو حصلت مشكلة. اكتب لي بالتفصيل إيه اللي حصل (اليوم والرحلة) وهوصّله للمكتب.', "Sorry if something went wrong. Please describe what happened (day and trip) and I'll pass it to the office.") }]
    }
    default: return []
  }
}

async function doAbsence(s: State, d: Deps, date: string, text: string): Promise<Bot[]> {
  const r = await d.request(s.phone!, s.code!, 'absence', { date, note: text.slice(0, 100) })
  if (r.error === 'invalid_date') return [{ text: t(s, 'التاريخ ده غير صالح (لازم يكون من النهارده لحد 30 يوم قدّام).', 'That date is not valid (it must be between today and 30 days ahead).') }]
  if (r.error) return [{ text: t(s, 'مقدرتش أسجّل الغياب. جرّب تاني أو كلّم المكتب.', "I couldn't record the absence. Try again or call the office.") }]
  return [{ text: t(s, `تمام، سجّلت إنك مش هتركب يوم ${fmtDate(date, 'ar')}. المكتب هيعرف ✅`, `Done — I recorded that you won't ride on ${fmtDate(date, 'en')}. The office will know ✅`), chips: chipsMain(s) }]
}
async function doComplaint(s: State, d: Deps, text: string): Promise<Bot[]> {
  const r = await d.request(s.phone!, s.code!, 'complaint', { text })
  if (r.error) return [{ text: t(s, 'مقدرتش أسجّل الشكوى. جرّب تاني بكلام أكتر شوية أو كلّم المكتب.', "I couldn't record that. Try again with a bit more detail or call the office.") }]
  return [{ text: t(s, 'وصّلت شكوتك للمكتب وهيراجعوها. شكراً إنك بلّغتنا 🙏', 'I passed your complaint to the office; they will review it. Thank you for telling us 🙏'), chips: chipsMain(s) }]
}

/** One conversation turn: user text in → bot messages out. State is updated in place. */
export async function reply(input: string, s: State, d: Deps): Promise<Bot[]> {
  const text = input.trim()
  if (!text) return []
  s.lang = detectLang(text, s.lang)
  const ph = findPhone(text), cd = findCode(text)

  // identification
  if (ph) s.draftPhone = ph
  if (cd) s.draftCode = cd
  if ((ph || cd) && !(s.me && s.phone === s.draftPhone && s.code === s.draftCode)) {
    if (s.draftPhone && s.draftCode) {
      const err = await verify(s, d, s.draftPhone, s.draftCode)
      if (err) return err
      const first = s.me!.student.first_name
      const out: Bot[] = [{ text: t(s, `أهلاً ${first} ✅ (خط ${nm(s, s.me!.route)} — محطة ${nm(s, s.me!.stop)})`, `Welcome ${first} ✅ (${nm(s, s.me!.route)} — stop ${nm(s, s.me!.stop)})`), chips: chipsMain(s) }]
      if (s.pending) { const p = s.pending; s.pending = undefined; out.push(...(await run(p, s, d, ''))) }
      return out
    }
    return [{ text: ph ? t(s, 'تمام، وكمان محتاج كود الطالب (مثال: ST-00001).', 'Got the number. I also need your student code (e.g. ST-00001).') : t(s, 'تمام، وكمان محتاج رقم موبايلك المسجل.', 'Got the code. I also need your registered phone number.') }]
  }

  const intent = intentOf(text)

  // multi-step answers
  if (s.ask && s.me) {
    const ask = s.ask
    if (intent === 'no') { s.ask = undefined; return [{ text: t(s, 'تمام، لغيت الطلب.', 'OK, cancelled.'), chips: chipsMain(s) }] }
    if (ask === 'renew_confirm') {
      if (intent === 'yes' || /تاكيد|confirm/.test(norm(text))) {
        s.ask = undefined
        const r = await d.request(s.phone!, s.code!, 'renewal', {})
        if (r.error) return [{ text: t(s, 'مقدرتش أسجّل التجديد دلوقتي. كلّم المكتب.', "I couldn't record the renewal right now. Please call the office.") }]
        s.me = await d.status(s.phone!, s.code!)
        return [{ text: t(s, `سجّلت طلب التجديد ✅\nالمبلغ: ${money(Number(r.amount))} جنيه\nالرقم المرجعي: ${r.reference}\n${s.me.company.payment_note_ar}\nأول ما الدفع يوصل هيتفعّل اشتراكك وهتجيلك رسالة تأكيد.`, `Renewal recorded ✅\nAmount: ${money(Number(r.amount))} EGP\nReference: ${r.reference}\n${s.me.company.payment_note_en}\nYour subscription activates as soon as payment arrives and you'll get a confirmation.`) }]
      }
    }
    if (ask === 'stop') {
      const cat = await d.catalog(), route = cat.routes.find((r) => r.name_ar === s.me!.route.name_ar)
      const stops = (route?.stops ?? []).slice().sort((a, b) => a.seq - b.seq).slice(0, -1).filter((x) => x.id !== s.me!.stop.id)
      const n = norm(text), num = /^\d{1,2}$/.test(n) ? Number(n) : 0
      const pick = num ? stops[num - 1] : stops.find((x) => norm(x.name_ar).includes(n) || n.includes(norm(x.name_ar)) || x.name_en.toLowerCase().includes(n) || n.includes(x.name_en.toLowerCase()))
      if (!pick) return [{ text: t(s, 'ما لقيتش المحطة دي على خطك. اكتب رقمها من القايمة أو اسمها.', "I couldn't find that stop on your line. Type its number from the list or its name.") }]
      s.stopChoice = { id: pick.id, name: nm(s, pick) }; s.ask = 'stop_confirm'
      return [{ text: t(s, `أطلب نقلك من ${nm(s, s.me.stop)} إلى ${nm(s, pick)}؟`, `Request a move from ${nm(s, s.me.stop)} to ${nm(s, pick)}?`), chips: s.lang === 'ar' ? ['تأكيد', 'لا'] : ['Confirm', 'No'] }]
    }
    if (ask === 'stop_confirm' && intent === 'yes') {
      s.ask = undefined
      const r = await d.request(s.phone!, s.code!, 'stop_change', { stop_id: s.stopChoice!.id })
      if (r.error === 'already_requested') return [{ text: t(s, 'عندك طلب تغيير محطة مفتوح بالفعل والمكتب لسه بيراجعه.', 'You already have an open stop-change request; the office is still reviewing it.') }]
      if (r.error) return [{ text: t(s, 'مقدرتش أسجّل الطلب. كلّم المكتب.', "I couldn't record the request. Please call the office.") }]
      return [{ text: t(s, `سجّلت طلب النقل إلى ${s.stopChoice!.name}. المكتب هيراجعه وهتوصلك رسالة بالنتيجة ✅`, `Request recorded: move to ${s.stopChoice!.name}. The office will review it and you'll get a message ✅`), chips: chipsMain(s) }]
    }
    if (ask === 'absence_date') {
      const dt = findDate(text, s.me?.today ?? d.today())
      if (!dt) return [{ text: t(s, 'ما فهمتش التاريخ. اكتب "النهارده" أو "بكرة" أو تاريخ زي 15/12.', "I didn't get the date. Type \"today\", \"tomorrow\" or a date like 15/12.") }]
      s.ask = undefined
      return doAbsence(s, d, dt, '')
    }
    if (ask === 'complaint_text') { s.ask = undefined; return doComplaint(s, d, text) }
  }
  if (s.ask && !s.me) s.ask = undefined

  // public answers (no identification needed)
  if (intent === 'greet') return [{ ...greeting(s, (await d.catalog()).company) }]
  if (intent === 'thanks') return [{ text: t(s, 'العفو! لو احتجت أي حاجة أنا موجود.', "You're welcome! I'm here if you need anything else.") }]
  if (intent === 'bye') return [{ text: t(s, 'مع السلامة، رحلة سعيدة!', 'Goodbye, have a safe trip!') }]
  if (intent === 'help') return [{ text: t(s, 'أقدر أساعدك في:\n• الباص فين ومواعيد رحلاتك\n• حالة اشتراكك وتجديده وطرق الدفع\n• تغيير محطة الركوب\n• تسجيل غياب أو شكوى\n• الأسعار والخطوط وأرقام المكتب\nمش بقدر أرد خارج بيانات الشركة، ولو سؤالك مش هنا كلّم المكتب.', "I can help with:\n• Where your bus is and your trip times\n• Your subscription, renewal and how to pay\n• Changing your pickup stop\n• Recording an absence or a complaint\n• Prices, lines and the office phone\nI only answer from the company's data; for anything else please call the office."), chips: chipsMain(s) }]
  if (intent === 'prices' || intent === 'lines' || intent === 'contact') {
    const cat = await d.catalog()
    if (intent === 'contact') return [{ text: t(s, `المكتب: ${cat.company.phone}\nواتساب: ${cat.company.whatsapp}`, `Office: ${cat.company.phone}\nWhatsApp: ${cat.company.whatsapp}`) }]
    if (intent === 'prices') {
      const mine = s.me ? cat.routes.filter((r) => r.name_ar === s.me!.route.name_ar) : cat.routes
      return [{ text: t(s, `سعر الاشتراك بالترم:\n${mine.map((r) => `• ${r.name_ar}: ${money(r.term_price)} جنيه`).join('\n')}\nالدفع كاش أو إنستا باي أو فودافون كاش.`, `Term subscription price:\n${mine.map((r) => `• ${r.name_en}: ${money(r.term_price)} EGP`).join('\n')}\nPay by cash, InstaPay or Vodafone Cash.`), chips: chipsPublic(s) }]
    }
    const to = cat.slots.filter((x) => x.direction === 'to').map((x) => x.depart_time.slice(0, 5)).join(' · '), back = cat.slots.filter((x) => x.direction === 'from').map((x) => x.depart_time.slice(0, 5)).join(' · ')
    return [{ text: t(s, `الخطوط:\n${cat.routes.map((r) => `• ${r.name_ar} — ${(r.stops?.length ?? 1) - 1} محطات (${r.duration_min} دقيقة)`).join('\n')}\nرحلات الذهاب: ${to}\nرحلات العودة: ${back}`, `Lines:\n${cat.routes.map((r) => `• ${r.name_en} — ${(r.stops?.length ?? 1) - 1} stops (${r.duration_min} min)`).join('\n')}\nTo campus: ${to}\nReturn: ${back}`), chips: chipsPublic(s) }]
  }

  // personal intents → need identification first
  if (['bus_now', 'trips_today', 'sub_status', 'renew', 'pay', 'stop_change', 'absence', 'complaint'].includes(intent)) {
    if (!s.me) { s.pending = intent; return [needId(s)] }
    return run(intent, s, d, text)
  }
  if (intent === 'yes' || intent === 'no') return [{ text: t(s, 'تمام. تحب أساعدك في إيه؟', 'OK. What can I help you with?'), chips: s.me ? chipsMain(s) : chipsPublic(s) }]
  return [{ text: t(s, 'ما فهمتش قصدك 🙏 ممكن تسأل مثلاً: "الباص فين؟" أو "اشتراكي ينتهي إمتى؟" أو "عايز أجدد". ولو الموضوع تاني كلّم المكتب.', "I didn't quite get that 🙏 Try \"where is my bus?\", \"when does my subscription end?\" or \"renew\". For anything else, please call the office."), chips: s.me ? chipsMain(s) : chipsPublic(s) }]
}
