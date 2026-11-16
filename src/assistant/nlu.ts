// Rule-based understanding for Arabic (Egyptian) and English. Deterministic on purpose: the assistant can only say what the data says.
export type Lang = 'ar' | 'en'
export type Intent =
  | 'greet' | 'thanks' | 'bye' | 'bus_now' | 'trips_today' | 'sub_status' | 'renew' | 'pay' | 'stop_change' | 'absence' | 'complaint'
  | 'prices' | 'lines' | 'contact' | 'help' | 'yes' | 'no' | 'unknown'

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
/** Lower-case, strip diacritics/tatweel, unify alef/ya/ta-marbuta, Eastern digits → Western. */
export function norm(s: string): string {
  let o = ''
  for (const ch of s) {
    const a = AR_DIGITS.indexOf(ch), f = FA_DIGITS.indexOf(ch)
    o += a >= 0 ? String(a) : f >= 0 ? String(f) : ch
  }
  return o.toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[؟?!.,،؛:"'()]/g, ' ').replace(/\s+/g, ' ').trim()
}
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s)
export const detectLang = (s: string, fallback: Lang): Lang => (hasArabic(s) ? 'ar' : /[a-z]{3,}/i.test(s) ? 'en' : fallback)

const RULES: [Intent, RegExp][] = [
  ['complaint', /(شكوي|اشتكي|شكاوي|مشكله مع|سواق.*(سيء|وحش|بيسوق|مش محترم)|complain|complaint|bad driver|rude)/],
  ['absence', /(مش جاي|مش هركب|هغيب|اغيب|غياب|اجازه|مش هاجي|absent|absence|not coming|skip (the )?(trip|bus)|won'?t (ride|come)|i will miss)/],
  ['stop_change', /(غير(ي)?.*(محطه|محطتي|نقطه|مكان)|محطتي|نقطه الركوب|محطه تانيه|change.*(stop|pickup)|pick ?up (point|stop)|move.*stop|another stop)/],
  ['renew', /(تجديد|جدد|اجدد|اجدد|renew)/],
  ['pay', /(ادفع|اسدد|سداد|طرق الدفع|الدفع|انستا|instapay|فودافون|vodafone|pay\b|payment|how.*pay)/],
  ['bus_now', /(الباص فين|فين الباص|الباص جاي|وصل الباص|اتاخر|متاخر|تاخير|اتحرك|هيوصل|وصل فين|where.*(bus|is it)|bus.*(where|late)|\blate\b|delay|\beta\b|track|how long)/],
  ['prices', /(سعر|اسعار|بكام|تكلفه|كام الاشتراك|كام سعر|price|prices|cost|how much|fee)/],
  ['sub_status', /(اشتراكي|اشتراك|هينتهي|ينتهي|انتهي|باقي كام|باقي ايه|باقي لي|خلص|صلاحي|subscription|expire|expiry|valid|my plan|balance|paid)/],
  ['trips_today', /(مواعيد|ميعاد|معاد|رحله|رحلات|رحلتي|الساعه كام|امتي الباص|امتي الرحله|schedule|timing|times|when.*(bus|trip)|my trips?|today)/],
  ['lines', /(خطوط|خط |مسارات|مسار|محطات|جامعات|مناطق|lines?|routes?|stops|universities|areas)/],
  ['contact', /(رقم|اتصل|اتصال|تواصل|اكلم|كلم|مكتب|عنوان|contact|call|phone|office|whatsapp|واتساب)/],
  ['help', /(مساعده|تعمل ايه|تقدر|اعمل ايه|ساعدني|help|what can you|what do you)/],
  ['thanks', /(شكرا|تسلم|متشكر|جزاك|thanks|thank you|thx)/],
  ['bye', /(مع السلامه|سلام عليكم ورحمه|باي|bye|goodbye)/],
  ['greet', /^(اهلا|اهلين|مرحبا|مرحب|سلام|السلام|ازيك|ازاي|صباح|مساء|هاي|هلا|hi|hello|hey|good (morning|evening))/],
]
export function intentOf(text: string): Intent {
  const n = norm(text)
  if (/^(اه|ايوه|ايوا|اكيد|تمام|ماشي|اوكي|موافق|yes|yep|ok|okay|sure|confirm|تاكيد|اكد|تأكيد)$/.test(n) || /^(تاكيد|اكد|confirm)/.test(n)) return 'yes'
  if (/^(لا|لأ|الغاء|الغي|مش دلوقتي|no|nope|cancel|stop)$/.test(n)) return 'no'
  for (const [i, re] of RULES) if (re.test(n)) return i
  return 'unknown'
}

/** Egyptian mobile number in any common format → local 01xxxxxxxxx, or null. */
export function findPhone(text: string): string | null {
  const d = norm(text).replace(/[\s\-().]/g, '')
  const m = /(?:\+?20|0020)?(0?1[0125]\d{8})(?!\d)/.exec(d)
  return m ? (m[1].startsWith('0') ? m[1] : '0' + m[1]) : null
}
export function findCode(text: string): string | null {
  const m = /\bst[\s\-_]*(\d{5})\b/i.exec(norm(text))
  return m ? `ST-${m[1]}` : null
}

/** "today / tomorrow / 15/12 / 2026-12-15" → YYYY-MM-DD relative to `todayYmd`. */
export function findDate(text: string, todayYmd: string): string | null {
  const n = norm(text), base = new Date(todayYmd + 'T12:00:00Z')
  const add = (k: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
  if (/(بعد بكره|بعد بكرا|day after tomorrow)/.test(n)) return add(2)
  if (/(بكره|بكرا|غدا|tomorrow)/.test(n)) return add(1)
  if (/(النهارده|النهاردا|اليوم|today)/.test(n)) return add(0)
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(n)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const dm = /\b(\d{1,2})\s*[\/-]\s*(\d{1,2})\b/.exec(n)
  if (dm) {
    const y = base.getUTCFullYear(); let s = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
    if (s < todayYmd) s = `${y + 1}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
    return s
  }
  return null
}
