import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, DemoTag, ErrorBox, Loading, Modal, Plate, useToast } from '@/components/ui'
import { PageTop } from './common'
import type { StaffTrip } from '@/lib/types'

export default function Trips() {
  const { tr, pick, date } = useI18n()
  const toast = useToast()
  const ov = useAsync(() => api.overview(), [], 15000)
  const today = ov.data?.now.slice(0, 10)
  const [off, setOff] = useState(0)
  const day = today ? new Date(new Date(today + 'T12:00:00Z').getTime() + off * 86400000).toISOString().slice(0, 10) : undefined
  const { data, error, loading, reload } = useAsync(() => (day ? api.trips(day) : Promise.resolve([] as StaffTrip[])), [day], 6000)
  const [dlg, setDlg] = useState<{ kind: 'delay' | 'cancel' | 'clock'; trip?: StaffTrip } | null>(null)
  const [val, setVal] = useState('')
  const demo = ov.data?.demo_mode
  const [busy, setBusy] = useState(false)
  const call = async (fn: () => Promise<{ ok?: boolean; error?: string; notified?: number; trips?: number; shortfall_seats?: number; operating?: boolean }>, msg: (r: { notified?: number; trips?: number; shortfall_seats?: number; operating?: boolean }) => string) => {
    setBusy(true)
    try { const r = await fn(); toast(r.error ? tr('مش ممكن دلوقتي', 'Not possible now') : msg(r)); setDlg(null); reload(); ov.reload() } finally { setBusy(false) }
  }
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = data ?? []
  const copy = async (t: StaffTrip) => { const url = `${location.origin}/driver/${t.driver_token}`; try { await navigator.clipboard.writeText(url); toast(tr('تم نسخ رابط السواق', 'Driver link copied')) } catch { toast(url) } }
  const statusChip = (t: StaffTrip) => ({ planned: <Chip tone="sun" dot>{tr('مخططة', 'Planned')}</Chip>, running: <Chip tone={t.delay_minutes >= 5 ? 'warn' : 'ok'} dot>{t.delay_minutes >= 5 ? tr(`شغّالة · متأخرة ${t.delay_minutes} د`, `Running · ${t.delay_minutes} min late`) : tr('شغّالة', 'Running')}</Chip>, completed: <Chip tone="gray" dot>{tr('خلصت', 'Finished')}</Chip>, cancelled: <Chip tone="bad" dot>{tr('ملغية', 'Cancelled')}</Chip> } as Record<string, JSX.Element>)[t.status]
  return (
    <>
      <PageTop title={tr('رحلات اليوم', "Today's trips")} sub={day ? date(day) : ''}
        right={<>
          {demo && <DemoTag />}
          <div className="tabs" style={{ margin: 0 }}>{[0, 1].map((o) => <button key={o} className={off === o ? 'on' : ''} onClick={() => setOff(o)}>{o === 0 ? tr('النهارده', 'Today') : tr('بكرة', 'Tomorrow')}</button>)}</div>
          <button className="btn sm" disabled={busy} onClick={() => call(() => api.planDay(day), (r) => r.operating === false ? tr('مفيش تشغيل في اليوم ده', 'No service on this day') : tr(`تم التخطيط: ${r.trips} رحلة${r.shortfall_seats ? ` — ناقص ${r.shortfall_seats} مقعد` : ''}`, `Planned ${r.trips} trips${r.shortfall_seats ? ` — ${r.shortfall_seats} seats short` : ''}`))}><Icon name="spark" size={16} /> {tr('وزّع الباصات تلقائيًا', 'Auto-assign buses')}</button>
          {demo && <button className="btn sm ghost" onClick={() => { setVal('07:10'); setDlg({ kind: 'clock' }) }}><Icon name="clock" size={16} /> {tr('ساعة العرض', 'Demo clock')}</button>}
        </>} />
      <div className="card">
        {rows.length === 0 && <div className="empty">{tr('مفيش رحلات في اليوم ده. اضغط "وزّع الباصات تلقائيًا".', 'No trips for this day. Press "Auto-assign buses".')}</div>}
        <div className="scroll-x">
          {rows.map((t, i) => {
            const prev = rows[i - 1]; const load = t.capacity ? Math.round((t.expected / t.capacity) * 100) : 0
            return (
              <div key={t.id}>
                {(!prev || prev.time !== t.time) && <h3 style={{ fontSize: 14, color: 'var(--muted)', margin: i ? '18px 0 4px' : '0 0 4px' }}><span className="num">{t.time}</span> · {t.direction === 'to' ? tr('ذهاب إلى الجامعة', 'to campus') : tr('عودة', 'return')}</h3>}
                <div className="trip" style={{ gridTemplateColumns: '1fr 190px 190px auto' }}>
                  <div className="route"><b>{pick({ a_ar: t.route_ar, a_en: t.route_en }, 'a')}</b>
                    <span className="row gap8 wrap" style={{ marginTop: 4 }}>{t.buses.length ? t.buses.map((b) => <Plate key={b.plate}>{b.plate}</Plate>) : <Chip tone="bad">{tr('بدون باص', 'No bus')}</Chip>}{t.buses[0]?.driver && <span className="muted small">{t.buses.map((b) => b.driver).filter(Boolean).join('، ')}</span>}</span></div>
                  <div className="occ"><b className="num">{t.expected}</b> / <span className="num">{t.capacity}</span> {tr('مقعد', 'seats')} <span className="muted small">({tr(`مسجّل ${t.enrolled}`, `${t.enrolled} enrolled`)})</span>
                    <div className={`bar ${load > 95 ? 'r' : load < 45 ? 'p' : 'g'}`}><i style={{ width: `${Math.min(100, load)}%` }} /></div>
                    {t.unassigned_seats > 0 && <span className="err">{tr(`ناقص ${t.unassigned_seats} مقعد`, `${t.unassigned_seats} seats short`)}</span>}</div>
                  <div>{statusChip(t)}{t.status !== 'planned' && <div className="muted small" style={{ marginTop: 4 }}>{tr(`ركب ${t.boarded}`, `${t.boarded} boarded`)}{t.rating ? ` · ★ ${t.rating}` : ''}</div>}</div>
                  <div className="row gap8 wrap">
                    <button className="btn sm ghost" onClick={() => copy(t)} title={tr('رابط السواق الخاص', 'Private driver link')}><Icon name="share" size={15} /> {tr('رابط السواق', 'Driver link')}</button>
                    {(t.status === 'planned' || t.status === 'running') && <button className="btn sm ghost" onClick={() => { setVal(String(Math.max(t.delay_minutes, 15))); setDlg({ kind: 'delay', trip: t }) }}>{tr('تأخير', 'Delay')}</button>}
                    {t.status === 'planned' && <button className="btn sm ghost" style={{ color: 'var(--bad)' }} onClick={() => { setVal(''); setDlg({ kind: 'cancel', trip: t }) }}>{tr('إلغاء', 'Cancel')}</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {dlg?.kind === 'delay' && dlg.trip && (
        <Modal title={tr('تسجيل تأخير', 'Log a delay')} onClose={() => setDlg(null)}>
          <p className="hint">{tr('هيتبعت تنبيه تلقائي لكل طالب لسه ما عدّاش عليه الباص.', "Every student the bus hasn't passed yet gets an automatic alert.")}</p>
          <div className="field"><label htmlFor="dl">{tr('التأخير (دقيقة)', 'Delay (minutes)')}</label><input id="dl" type="number" min={0} max={240} value={val} onChange={(e) => setVal(e.target.value)} /></div>
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn" disabled={busy} onClick={() => call(() => api.setDelay(dlg.trip!.id, Number(val)), (r) => tr(`اتبعت ${r.notified ?? 0} تنبيه`, `${r.notified ?? 0} alerts sent`))}>{tr('تسجيل', 'Save')}</button><button className="btn ghost" onClick={() => setDlg(null)}>{tr('إلغاء', 'Cancel')}</button></div>
        </Modal>
      )}
      {dlg?.kind === 'cancel' && dlg.trip && (
        <Modal title={tr('إلغاء الرحلة', 'Cancel the trip')} onClose={() => setDlg(null)}>
          <p className="hint">{tr('هيوصل لكل طلاب الرحلة رسالة إلغاء.', 'Every student on the trip receives a cancellation message.')}</p>
          <div className="field"><label htmlFor="rs">{tr('السبب (اختياري)', 'Reason (optional)')}</label><input id="rs" value={val} onChange={(e) => setVal(e.target.value)} maxLength={120} /></div>
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn bad" disabled={busy} onClick={() => call(() => api.cancelTrip(dlg.trip!.id, val || undefined), (r) => tr(`اتلغت — اتبعت ${r.notified ?? 0} رسالة`, `Cancelled — ${r.notified ?? 0} messages sent`))}>{tr('إلغاء الرحلة', 'Cancel trip')}</button><button className="btn ghost" onClick={() => setDlg(null)}>{tr('رجوع', 'Back')}</button></div>
        </Modal>
      )}
      {dlg?.kind === 'clock' && (
        <Modal title={tr('ساعة العرض التجريبي', 'Demo clock')} onClose={() => setDlg(null)}>
          <p className="hint">{tr('اختار الوقت اللي عايز تعرض عليه النظام (تاريخ النهارده). الساعة بتكمل من هناك.', "Pick the time of day to show the system at (today's date). The clock keeps running from there.")}</p>
          <div className="row gap8 wrap">{['06:30', '07:10', '07:55', '09:40', '12:45', '15:30'].map((x) => <button key={x} className={`btn sm ${val === x ? 'dark' : 'ghost'}`} onClick={() => setVal(x)}><span className="num">{x}</span></button>)}</div>
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn" disabled={busy} onClick={() => call(() => api.setDemoClock(`${ov.data?.now.slice(0, 10)}T${val}`), () => tr('تم ضبط الساعة', 'Clock set'))}>{tr('ضبط', 'Set')}</button><button className="btn ghost" onClick={() => setDlg(null)}>{tr('إلغاء', 'Cancel')}</button></div>
        </Modal>
      )}
    </>
  )
}
