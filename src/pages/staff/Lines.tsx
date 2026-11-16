import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, Loading, useToast } from '@/components/ui'
import { PageTop } from './common'

export default function Lines() {
  const { tr, pick, money, num } = useI18n()
  const toast = useToast()
  const ov = useAsync(() => api.overview(), [])
  const today = ov.data?.now.slice(0, 10)
  const [off, setOff] = useState(1)
  const day = today ? new Date(new Date(today + 'T12:00:00Z').getTime() + off * 86400000).toISOString().slice(0, 10) : undefined
  const { data, error, loading, reload } = useAsync(() => (day ? api.demand(day) : Promise.resolve(null)), [day])
  const [busy, setBusy] = useState(false)
  if ((loading && !data) || ov.loading) return <Loading />
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />
  const max = Math.max(1, ...data.routes.map((r) => r.students))
  const advice: Record<string, [string, string, 'ok' | 'warn' | 'bad' | 'gray' | 'sun']> = {
    ok: ['مناسب', 'Good fit', 'ok'], low: ['باص أكبر من اللازم', 'Bus larger than needed', 'sun'], overload: ['مزدحم — فكّر في باص إضافي', 'Crowded — consider another bus', 'warn'],
    shortfall: ['ناقص مقاعد', 'Not enough seats', 'bad'], unplanned: ['لسه ما اتخططش', 'Not planned yet', 'gray'],
  }
  const plan = async () => { setBusy(true); try { const r = await api.planDay(day); toast(r.operating === false ? tr('مفيش تشغيل في اليوم ده', 'No service that day') : tr(`تم التخطيط: ${r.trips} رحلة`, `Planned ${r.trips} trips`)); reload() } finally { setBusy(false) } }
  return (
    <>
      <PageTop title={tr('الخطوط والطلب', 'Lines & demand')} sub={tr('كام طالب على كل خط، والمتوقع يركب كل ميعاد، وهل الباصات مناسبة', 'Students per line, expected riders per time slot, and whether the buses fit')}
        right={<><div className="tabs" style={{ margin: 0 }}>{[0, 1].map((o) => <button key={o} className={off === o ? 'on' : ''} onClick={() => setOff(o)}>{o === 0 ? tr('النهارده', 'Today') : tr('بكرة', 'Tomorrow')}</button>)}</div>
          <button className="btn sm" disabled={busy} onClick={plan}><Icon name="spark" size={16} /> {tr('وزّع الباصات', 'Assign buses')}</button></>} />
      <div className="grid2">
        <div className="card">
          <h2>{tr('الطلاب على كل خط', 'Students per line')}</h2><p className="hint">{tr('سعر الاشتراك بالترم بجانب كل خط', 'Term price shown beside each line')}</p>
          {data.routes.map((r) => (
            <div key={r.id} style={{ marginBottom: 14 }}>
              <div className="row between"><b>{pick(r, 'name')}</b><span className="num">{num(r.students)} · {money(r.price)} {tr('ج.م', 'EGP')}</span></div>
              <div className="bar p"><i style={{ width: `${(r.students / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>{tr('إزاي بيتوقع النظام؟', 'How the forecast works')}</h2>
          <p className="hint">{tr('بسيط وواضح، من غير صندوق أسود', 'Simple and transparent, no black box')}</p>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 8, fontSize: 14.5 }}>
            <li>{tr('بيحسب نسبة الحضور الفعلي لنفس الخط والميعاد ونفس يوم الأسبوع في آخر 8 أسابيع.', 'It computes the real attendance rate for the same line, time and weekday over the last 8 weeks.')}</li>
            <li>{tr('بيضرب في عدد المسجلين ويزوّد هامش أمان.', 'Multiplies by the enrolled students and adds a safety margin.')}</li>
            <li>{tr('بيوزّع أصغر باص يكفي، من غير ما باص أو سواق يتحجز مرتين في نفس الوقت.', 'Assigns the smallest bus that fits — no bus or driver is ever booked twice at the same time.')}</li>
            <li>{tr('الباصات الخطرة بتتأجل لآخر الترتيب.', 'High-risk buses are used last.')}</li>
          </ol>
        </div>
      </div>
      <div className="card">
        <h2>{tr('كل ميعاد وخط', 'Every time slot and line')}</h2>
        <div className="scroll-x"><table className="table">
          <thead><tr><th>{tr('الميعاد', 'Time')}</th><th>{tr('الخط', 'Line')}</th><th>{tr('المسجلين', 'Enrolled')}</th><th>{tr('نسبة الحضور المتوقعة', 'Forecast attendance')}</th><th>{tr('المتوقع', 'Expected')}</th><th>{tr('المقاعد', 'Seats')}</th><th>{tr('التقييم', 'Assessment')}</th></tr></thead>
          <tbody>{data.slots.map((s) => { const a = advice[s.advice]; return (
            <tr key={s.route_id + s.time + s.direction}>
              <td className="num"><b>{s.time}</b> <span className="muted small">{s.direction === 'to' ? tr('ذهاب', 'to') : tr('عودة', 'back')}</span></td>
              <td>{pick(s, 'name')}</td><td className="num">{s.enrolled}</td><td className="num">{s.rate}%</td><td className="num">{s.expected ?? '—'}</td><td className="num">{s.capacity || '—'}</td>
              <td><Chip tone={a[2] === 'gray' ? 'gray' : a[2]}>{tr(a[0], a[1])}</Chip></td></tr>) })}</tbody>
        </table></div>
      </div>
    </>
  )
}
