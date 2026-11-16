import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'ar' | 'en'
interface Ctx {
  lang: Lang; dir: 'rtl' | 'ltr'; setLang: (l: Lang) => void
  /** Inline bilingual text: tr('عربي', 'English'). Keeps both languages side by side so they cannot drift. */
  tr: (ar: string, en: string) => string
  /** Pick a bilingual database field: pick(row, 'name') → row.name_ar | row.name_en */
  pick: (o: object | null | undefined, field: string) => string
  /** Numbers always use Western digits in both languages. */
  num: (n: number | string) => string
  money: (n: number) => string
  /** Clock times (08:00) stay in 24h numerals. */
  date: (ymd: string, o?: Intl.DateTimeFormatOptions) => string
}
const I = createContext<Ctx>(null as unknown as Ctx)

const initial = (): Lang => {
  try { const s = localStorage.getItem('sekka-lang'); if (s === 'ar' || s === 'en') return s } catch { /* private mode */ }
  return 'ar'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(initial)
  const setLang = useCallback((l: Lang) => { setL(l); try { localStorage.setItem('sekka-lang', l) } catch { /* ignore */ } }, [])
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr' }, [lang])
  const v = useMemo<Ctx>(() => {
    const loc = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
    return {
      lang, dir: lang === 'ar' ? 'rtl' : 'ltr', setLang,
      tr: (ar, en) => (lang === 'ar' ? ar : en),
      pick: (o, f) => { const r = o as Record<string, unknown> | null | undefined; return String((lang === 'ar' ? r?.[`${f}_ar`] : r?.[`${f}_en`]) ?? r?.[`${f}_ar`] ?? '') },
      num: (n) => new Intl.NumberFormat(loc).format(Number(n)),
      money: (n) => new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(n),
      date: (ymd, o = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat(loc, { timeZone: 'UTC', ...o }).format(new Date(ymd.slice(0, 10) + 'T12:00:00Z')),
    }
  }, [lang, setLang])
  return <I.Provider value={v}>{children}</I.Provider>
}
export const useI18n = () => useContext(I)
