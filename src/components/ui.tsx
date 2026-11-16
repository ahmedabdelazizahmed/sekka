import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { Icon } from './Icon'

export const Logo = () => (
  <span className="logo" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18c4 0 4-12 8-12s4 12 8 12" /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><circle cx="20" cy="18" r="1.4" fill="currentColor" /></svg>
  </span>
)

export function LangToggle({ dark }: { dark?: boolean }) {
  const { lang, setLang, tr } = useI18n()
  return (
    <button className={`btn sm ${dark ? '' : 'ghost'}`} style={dark ? { background: 'rgba(255,255,255,.12)', color: '#fff' } : undefined}
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={tr('Switch to English', 'التحويل إلى العربية')}>
      <Icon name="globe" size={16} /> {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  )
}

export const Chip = ({ tone = '', children, dot }: { tone?: '' | 'ok' | 'warn' | 'bad' | 'sun' | 'gray'; children: ReactNode; dot?: boolean }) => (
  <span className={`chip ${tone}`}>{dot && <i />}{children}</span>
)

export const Loading = () => <p className="muted" role="status"><span className="spin" /></p>
export function ErrorBox({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  const { tr } = useI18n()
  if (!error) return null
  const forbidden = error.message === 'forbidden'
  return (
    <div className="notice" role="alert">
      {forbidden ? tr('هذه الصفحة غير متاحة لصلاحيتك.', 'This page is not available for your role.') : tr('حصلت مشكلة في تحميل البيانات.', 'Something went wrong loading the data.')}{' '}
      {onRetry && !forbidden && <button className="btn sm ghost" onClick={onRetry}>{tr('حاول مرة أخرى', 'Try again')}</button>}
    </div>
  )
}

export const Kpi = ({ icon, tone, value, unit, label, foot }: { icon: string; tone: 'i1' | 'i2' | 'i3' | 'i4'; value: ReactNode; unit?: string; label: string; foot?: ReactNode }) => (
  <div className="card kpi">
    <div className={`ic ${tone}`}><Icon name={icon} size={22} /></div>
    <div className="v num">{value}{unit && <small>{unit}</small>}</div>
    <div className="l">{label}</div>
    {foot && <div className="d">{foot}</div>}
  </div>
)

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { tr } = useI18n()
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between"><h3 style={{ fontSize: 19 }}>{title}</h3><button className="btn sm ghost" onClick={onClose} aria-label={tr('إغلاق', 'Close')}>✕</button></div>
        <div style={{ marginTop: 16 }}>{children}</div>
      </div>
    </div>
  )
}

const T = createContext<(m: string) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3200) }, [])
  return <T.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</T.Provider>
}
export const useToast = () => useContext(T)

export const DemoTag = () => { const { tr } = useI18n(); return <span className="demo-tag">{tr('نسخة تجريبية · بيانات وهمية', 'Demo · fictional data')}</span> }

/** Plate numbers are Arabic letters + digits: always render right-to-left inside a box. */
export const Plate = ({ children }: { children: ReactNode }) => <span className="plate">{children}</span>
