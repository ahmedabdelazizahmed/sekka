import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { isConfigured } from '@/lib/supabase'
import { Icon } from '@/components/Icon'
import { LangToggle, Loading, Logo } from '@/components/ui'
import type { Role } from '@/lib/types'

const DEMO = [
  { email: 'owner@demo.sekka.test', ar: 'مالك الشركة', en: 'Owner' },
  { email: 'dispatch@demo.sekka.test', ar: 'مشرف التشغيل', en: 'Dispatcher' },
  { email: 'accounts@demo.sekka.test', ar: 'المحاسب', en: 'Accountant' },
]

export function StaffLogin() {
  const { tr, pick } = useI18n()
  const { login, staff } = useAuth()
  const { company } = useCompany()
  const nav = useNavigate()
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (staff) nav('/staff', { replace: true }) }, [staff, nav])
  const go = async (e?: FormEvent, em = email, p = pw) => {
    e?.preventDefault(); setBusy(true); setErr('')
    try { await login(em, p) } catch (x) { setErr((x as Error).message === 'not_staff' ? tr('هذا الحساب ليس ضمن فريق الشركة.', 'This account is not part of the company staff.') : tr('البريد أو كلمة المرور غير صحيحة.', 'Wrong email or password.')) } finally { setBusy(false) }
  }
  return (
    <div className="phone-page" style={{ minHeight: '100dvh', height: 'auto', margin: '0 auto', borderRadius: 0, background: 'var(--cream)' }}>
      <div className="ph-head"><Link to="/" style={{ color: '#fff' }}><Logo /></Link><div className="grow"><b>{tr('دخول فريق الشركة', 'Staff sign-in')}</b><span className="s"><i /> {pick(company, 'name')}</span></div><LangToggle dark /></div>
      <form className="stack" style={{ padding: 20 }} onSubmit={go}>
        {!isConfigured() && <div className="notice">{tr('ملف البيئة غير مضبوط.', 'Environment not configured.')}</div>}
        <div className="field"><label htmlFor="em">{tr('البريد الإلكتروني', 'Email')}</label><input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" /></div>
        <div className="field"><label htmlFor="pw">{tr('كلمة المرور', 'Password')}</label><input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required dir="ltr" /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn lg" disabled={busy}>{busy ? tr('جارٍ الدخول…', 'Signing in…') : tr('تسجيل الدخول', 'Sign in')}</button>
        {company?.demo_mode && (
          <div className="card flat stack8">
            <b>{tr('عرض تجريبي: ادخل بصلاحية', 'Demo: sign in as')}</b>
            <div className="row gap8 wrap">{DEMO.map((d) => <button type="button" key={d.email} className="btn sm ghost" onClick={() => { setEmail(d.email); setPw('demo1234'); void go(undefined, d.email, 'demo1234') }}>{tr(d.ar, d.en)}</button>)}</div>
          </div>
        )}
      </form>
    </div>
  )
}

const NAV: { to: string; icon: string; ar: string; en: string; roles: Role[]; end?: boolean }[] = [
  { to: '/staff', icon: 'home', ar: 'نظرة عامة', en: 'Overview', roles: ['owner', 'dispatcher', 'accountant'], end: true },
  { to: '/staff/live', icon: 'pulse', ar: 'التتبع المباشر', en: 'Live tracking', roles: ['owner', 'dispatcher'] },
  { to: '/staff/trips', icon: 'bus', ar: 'رحلات اليوم', en: 'Trips', roles: ['owner', 'dispatcher'] },
  { to: '/staff/students', icon: 'users', ar: 'الطلاب', en: 'Students', roles: ['owner', 'dispatcher', 'accountant'] },
  { to: '/staff/subscriptions', icon: 'card', ar: 'الاشتراكات', en: 'Subscriptions', roles: ['owner', 'accountant'] },
  { to: '/staff/lines', icon: 'route', ar: 'الخطوط والطلب', en: 'Lines & demand', roles: ['owner', 'dispatcher'] },
  { to: '/staff/fleet', icon: 'wrench', ar: 'الأسطول والصيانة', en: 'Fleet & maintenance', roles: ['owner', 'dispatcher'] },
  { to: '/staff/messages', icon: 'msg', ar: 'الرسائل والطلبات', en: 'Messages & requests', roles: ['owner', 'dispatcher', 'accountant'] },
  { to: '/staff/settings', icon: 'gear', ar: 'الإعدادات والسجل', en: 'Settings & audit', roles: ['owner'] },
]

export function StaffShell() {
  const { tr, pick } = useI18n()
  const { staff, loading, logout } = useAuth()
  const { company } = useCompany()
  const { pathname } = useLocation()
  useEffect(() => { document.body.classList.remove('phone-body'); document.title = `${tr('لوحة الإدارة', 'Dashboard')} — ${pick(company, 'name') || 'Sekka'}` }, [company, pick, tr])
  if (loading) return <div style={{ padding: 40 }}><Loading /></div>
  if (!staff) return <Navigate to="/staff/login" replace />
  const allowed = NAV.some((n) => n.roles.includes(staff.role) && (n.end ? pathname.replace(/\/$/, '') === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
  const roleName: Record<Role, string> = { owner: tr('مالك', 'Owner'), dispatcher: tr('مشرف تشغيل', 'Dispatcher'), accountant: tr('محاسب', 'Accountant') }
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo /><div><b>{pick(company, 'name')}</b><span>{tr('لوحة الإدارة', 'Operations hub')}</span></div></div>
        <nav className="nav" aria-label={tr('التنقل', 'Navigation')}>
          {NAV.filter((n) => n.roles.includes(staff.role)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={n.icon} /> {tr(n.ar, n.en)}</NavLink>
          ))}
        </nav>
        <div className="me">
          <div className="av">{staff.full_name.slice(0, 1)}</div>
          <div><b>{staff.full_name}</b><span>{roleName[staff.role]}</span></div>
          <button onClick={() => void logout()} aria-label={tr('تسجيل الخروج', 'Sign out')}><Icon name="out" /></button>
        </div>
      </aside>
      <main className="main">{allowed ? <Outlet /> : <Navigate to="/staff" replace />}</main>
    </div>
  )
}
