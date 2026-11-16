import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { Logo } from '@/components/ui'
import { DEMO_WEB, demoLinks, startDemo, type StepKey } from './boot'

const ORDER: StepKey[] = ['engine', 'data', 'clock', 'done']

/** Splash while the in-browser database starts (first visit downloads ~12 MB; afterwards the browser caches it). */
export function DemoBoot({ children }: { children: ReactNode }) {
  const { tr } = useI18n()
  const [step, setStep] = useState<StepKey>('engine')
  const [err, setErr] = useState('')
  useEffect(() => { if (DEMO_WEB) startDemo(setStep).catch((e) => setErr(String(e?.message || e))) }, [])
  if (!DEMO_WEB || step === 'done') return <>{children}</>
  const msg: Record<StepKey, [string, string]> = {
    engine: ['بنشغّل قاعدة البيانات', 'Starting the database'],
    data: ['بنحمّل بيانات الشركة التجريبية', 'Loading the demo company'],
    clock: ['بنضبط ساعة اليوم', 'Setting the clock'],
    done: ['', ''],
  }
  const pct = Math.round(((ORDER.indexOf(step) + 0.5) / 3) * 100)
  return (
    <div className="boot">
      <Logo />
      <h1>{tr('سكّة', 'Sekka')}</h1>
      <p>{err ? tr('حصلت مشكلة في التحميل. جرّب تحدّث الصفحة.', 'Loading failed. Try refreshing.') : tr(msg[step][0], msg[step][1])}</p>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <small>{tr('أول مرة بيحمّل حوالي 12 ميجا، وبعدها بيتفتح فورًا. كل حاجة بتشتغل على جهازك.', 'First visit downloads about 12 MB, then it opens instantly. Everything runs on your device.')}</small>
      {err && <small style={{ direction: 'ltr' }}>{err}</small>}
    </div>
  )
}

/** Small floating guide for the web demo: jump between the student, driver and staff views of the same company. */
export function DemoBar() {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<{ track?: string; driver?: string }>({})
  useEffect(() => { if (DEMO_WEB) demoLinks().then(setLinks).catch((e) => console.error('demo links', e)) }, [])
  if (!DEMO_WEB) return null
  const close = () => setOpen(false)
  return (
    <div className="demobar" data-open={open}>
      {open && (
        <div className="panel">
          <b>{tr('جرّب الشركة من كل الأطراف', 'Try the company from every side')}</b>
          <Link to="/chat" onClick={close}>{tr('كطالب: اسأل المساعد', 'As a student: ask the assistant')}</Link>
          {links.track && <Link to={`/track/${links.track}`} onClick={close}>{tr('كطالب: تتبّع الباص على الخريطة', 'As a student: follow the bus on the map')}</Link>}
          <Link to="/staff/login" onClick={close}>{tr('كمالك أو مشرف أو محاسب', 'As owner, dispatcher or accountant')}</Link>
          {links.driver && <Link to={`/driver/${links.driver}`} onClick={close}>{tr('كسواق: صفحة الرحلة', 'As a driver: the trip page')}</Link>}
          <small>{tr('كل اللي بتعمله بيحصل على جهازك بس، وتحديث الصفحة بيرجّع كل حاجة للأول. البيانات كلها وهمية.', 'Everything you do stays on your device and refreshing resets it. All data is fictional.')}</small>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '×' : tr('جولة العرض', 'Demo tour')}</button>
    </div>
  )
}
