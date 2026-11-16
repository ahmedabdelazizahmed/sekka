import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { useAuth } from '@/lib/auth'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, Loading, Modal, useToast } from '@/components/ui'
import { PageTop } from './common'
import type { StudentDetail } from '@/lib/types'

export default function Students() {
  const { tr, pick, money, date } = useI18n()
  const { staff } = useAuth()
  const toast = useToast()
  const [q, setQ] = useState(''), [dq, setDq] = useState(''), [route, setRoute] = useState<number | null>(null)
  useEffect(() => { const h = setTimeout(() => setDq(q), 250); return () => clearTimeout(h) }, [q])
  const routes = useAsync(() => api.routes(), [])
  const { data, error, loading, reload } = useAsync(() => api.students(dq, route, 50), [dq, route])
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const role = staff?.role
  const open = async (id: string) => { const d = await api.studentDetail(id); if (!d.error) setDetail(d) }
  const chip = (s: string | null, left: number | null) => !s ? <Chip tone="gray">{tr('بدون اشتراك', 'No subscription')}</Chip>
    : s === 'active' ? <Chip tone={left !== null && left <= 14 ? 'warn' : 'ok'} dot>{tr(`فعّال · ${left} يوم`, `Active · ${left} d`)}</Chip> : <Chip tone="bad" dot>{tr('منتهي', 'Expired')}</Chip>
  return (
    <>
      <PageTop title={tr('الطلاب', 'Students')} sub={data ? tr(`${data.total} طالب`, `${data.total} students`) : ''}
        right={role === 'dispatcher' ? <span className="chip gray"><Icon name="lock" size={14} /> {tr('أرقام الموبايل مخفية لصلاحيتك', 'Phone numbers are masked for your role')}</span> : undefined} />
      <div className="card">
        <div className="row gap8 wrap" style={{ marginBottom: 14 }}>
          <div className="field grow" style={{ minWidth: 220 }}><label className="sr" htmlFor="sq">{tr('بحث', 'Search')}</label><input id="sq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('ابحث بالاسم أو الكود أو الموبايل…', 'Search by name, code or phone…')} /></div>
          <div className="field"><label className="sr" htmlFor="rf">{tr('الخط', 'Line')}</label>
            <select id="rf" value={route ?? ''} onChange={(e) => setRoute(e.target.value ? Number(e.target.value) : null)}><option value="">{tr('كل الخطوط', 'All lines')}</option>{(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r, 'name')}</option>)}</select></div>
        </div>
        {loading && !data && <Loading />}<ErrorBox error={error} onRetry={reload} />
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{tr('الطالب', 'Student')}</th><th>{tr('الموبايل', 'Phone')}</th><th>{tr('الخط والمحطة', 'Line & stop')}</th><th>{tr('الذهاب / العودة', 'To / back')}</th><th>{tr('الاشتراك', 'Subscription')}</th></tr></thead>
            <tbody>
              {(data?.rows ?? []).map((s) => (
                <tr key={s.id} className="click" onClick={() => void open(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void open(s.id)}>
                  <td><b>{s.name}</b><div className="muted small num">{s.code}</div></td>
                  <td className="num">{s.phone}</td>
                  <td>{pick({ a_ar: s.route_ar, a_en: s.route_en }, 'a')}<div className="muted small">{pick({ a_ar: s.stop_ar, a_en: s.stop_en }, 'a')}</div></td>
                  <td className="num">{s.to_time} / {s.from_time}</td>
                  <td>{chip(s.sub_status, s.days_left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.rows.length === 0 && <div className="empty">{tr('مفيش نتائج.', 'No results.')}</div>}
        {data && data.total > data.rows.length && <p className="hint">{tr(`عرض أول ${data.rows.length} من ${data.total}. اضبط البحث لتضييق النتائج.`, `Showing the first ${data.rows.length} of ${data.total}. Refine the search.`)}</p>}
      </div>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="row gap8 wrap"><Chip tone="gray">{detail.code}</Chip><span className="num">{detail.phone}</span></div>
            <div className="notice" style={{ background: '#f4effb', color: '#3b2b66' }}><Icon name="lock" size={14} /> {tr('فتح ملف الطالب اتسجّل في سجل المراجعة.', 'Opening this record was written to the audit log.')}</div>
            <div><b>{tr('الاشتراكات', 'Subscriptions')}</b>
              {detail.subscriptions.map((s) => <div key={s.id} className="row between" style={{ padding: '6px 0', borderTop: '1px solid #f1e9de' }}><span>{s.term}<br /><span className="muted small">{date(s.starts_on, { day: 'numeric', month: 'short' })} → {date(s.ends_on, { day: 'numeric', month: 'short' })}</span></span><span className="num">{money(s.paid)} / {money(s.price)} <Chip tone={s.status === 'active' ? 'ok' : s.status === 'pending' ? 'warn' : 'bad'}>{s.status}</Chip></span></div>)}</div>
            {role !== 'dispatcher' && <div><b>{tr('الدفعات', 'Payments')}</b>{detail.payments.length === 0 && <div className="hint">—</div>}{detail.payments.slice(0, 5).map((p, i) => <div key={i} className="row between small" style={{ padding: '4px 0' }}><span className="num">{p.at.slice(0, 10)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span><b className="num">{money(p.amount)}</b></div>)}</div>}
            {role !== 'accountant' && (
              <div className="field"><label htmlFor="stp">{tr('محطة الركوب', 'Pickup stop')}</label>
                <select id="stp" defaultValue={detail.stop_id} onChange={async (e) => { const r = await api.updateStop(detail.id, Number(e.target.value)); toast(r.error ? tr('مش ممكن', 'Not possible') : tr('تم تغيير المحطة', 'Stop changed')); reload() }}>
                  {detail.stops.map((s) => <option key={s.id} value={s.id}>{pick(s, 'name')}</option>)}</select></div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
