import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, Loading, Modal, Plate, useToast } from '@/components/ui'
import { PageTop, useReasonText } from './common'
import type { FleetBus } from '@/lib/types'

const TONE = { ok: 'ok', watch: 'gray', soon: 'warn', urgent: 'bad' } as const
const COLOR = { ok: '#12805a', watch: '#8a74e0', soon: '#c4821d', urgent: '#b8283f' } as const

export default function Fleet() {
  const { tr, num, money, date } = useI18n()
  const reason = useReasonText()
  const orderText = (txt: string | null, kind: string) => {
    const m = /^risk (\d+): ?(\w*)/.exec(txt ?? '')
    return m ? tr(`درجة الخطورة ${num(+m[1])} — ${m[2] ? reason({ code: m[2], km: 0 }).split(' بـ')[0] : ''}`, `Risk ${num(+m[1])}${m[2] ? ' — ' + m[2].replace(/_/g, ' ') : ''}`) : (txt || kind)
  }
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.fleet(), [], 15000)
  const [modal, setModal] = useState<{ kind: 'done' | 'check' | 'order'; bus: FleetBus } | null>(null)
  const [f, setF] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />
  const label = { ok: tr('سليم', 'Healthy'), watch: tr('راقبه', 'Watch'), soon: tr('صيانة قريبة', 'Service soon'), urgent: tr('عاجل', 'Urgent') }
  const submit = async () => {
    if (!modal) return; setBusy(true)
    try {
      const b = modal.bus
      const r = modal.kind === 'done' ? await api.completeOrder(b.order!.id, Number(f.cost || 0))
        : modal.kind === 'order' ? await api.createOrder(b.id, f.kind || 'routine', f.reason || '')
        : await api.addCheck({ bus: b.id, km: Number(f.km), brake: Number(f.brake), oil: Number(f.oil), tire: Number(f.tire), temp: Number(f.temp || 90), faults: Number(f.faults || 0) })
      toast(r.error ? tr('قيم غير صحيحة أو أمر موجود بالفعل', 'Invalid values or an order already exists') : tr('تم الحفظ', 'Saved')); if (!r.error) { setModal(null); reload() }
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageTop title={tr('الأسطول والصيانة', 'Fleet & maintenance')} sub={tr('درجة خطورة لكل باص من 0 إلى 100 — وأسبابها مكتوبة بوضوح', 'A 0–100 risk score per bus — with plain-language reasons')} />
      <div className="fleet">
        {data.map((b) => {
          const r = b.risk, max = Math.max(...b.checks.map((c) => c.brake), 1), min = Math.min(...b.checks.map((c) => c.brake), 0)
          return (
            <div className="card bus-card" key={b.id}>
              <div className="h"><div><Plate>{b.plate}</Plate><div className="muted small" style={{ marginTop: 4 }}>{b.model} · {b.year} · {num(b.capacity)} {tr('مقعد', 'seats')}{b.driver ? ` · ${b.driver}` : ''}</div></div>
                <Chip tone={TONE[r.level]} dot>{b.status === 'workshop' ? tr('في الورشة', 'In workshop') : label[r.level]}</Chip></div>
              <div className="gauge"><div className="sc"><b className="num" style={{ color: COLOR[r.level] }}>{r.score}</b><span>{tr('درجة الخطورة من 100', 'risk score of 100')}</span></div>
                <div className={`bar ${r.level === 'urgent' ? 'r' : r.level === 'ok' ? 'g' : ''}`}><i style={{ width: `${r.score}%` }} /></div></div>
              {r.reasons.length > 0 ? <ul className="rs">{r.reasons.map((x) => <li key={x.code}><i style={{ background: x.w >= 25 ? 'var(--bad)' : x.w >= 12 ? '#c4821d' : '#8a74e0' }} />{reason(x)}</li>)}</ul> : <p className="hint">{tr('مفيش أي مؤشرات قلق.', 'No warning signs.')}</p>}
              {b.checks.length > 2 && <div><div className="hint" style={{ margin: 0 }}>{tr('فحمات الفرامل % — آخر فحوصات', 'Brake pads % — recent checks')}</div><div className="mini" aria-hidden="true">{b.checks.map((c) => <i key={c.on} style={{ height: `${10 + ((c.brake - min) / Math.max(max - min, 1)) * 90}%`, background: c.brake <= 25 ? '#e08a97' : '#d9cff0' }} title={`${c.on}: ${c.brake}%`} />)}</div></div>}
              <div className="muted small" style={{ margin: '8px 0' }}>{tr(`آخر صيانة منذ ${num(r.km_since_service)} كم`, `${num(r.km_since_service)} km since last service`)}</div>
              {b.order ? (
                <div className="notice" style={{ background: '#f4effb', color: '#3b2b66' }}><Icon name="wrench" size={14} /> {tr('أمر صيانة مفتوح', 'Open work order')}: {orderText(b.order.reason, b.order.kind)} · {date(b.order.scheduled_for, { day: 'numeric', month: 'short' })} {b.order.created_by === 'auto' && <Chip tone="sun">{tr('تلقائي', 'auto')}</Chip>}
                  <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => { setF({ cost: '' }); setModal({ kind: 'done', bus: b }) }}>{tr('تمت الصيانة', 'Mark as done')}</button></div></div>
              ) : (
                <div className="row gap8 wrap">
                  {b.status === 'active' && r.level !== 'ok' && <button className="btn sm" onClick={() => { setF({ kind: 'routine', reason: '' }); setModal({ kind: 'order', bus: b }) }}>{tr('افتح أمر صيانة', 'Open work order')}</button>}
                  <button className="btn sm ghost" onClick={() => { setF({ km: String(b.odometer_km), brake: '', oil: '', tire: '', temp: '90', faults: '0' }); setModal({ kind: 'check', bus: b }) }}>{tr('سجّل فحص', 'Log an inspection')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="note" style={{ marginTop: 16 }}><Icon name="spark" /><div>{tr('الدرجة بتتحسب من: كيلومترات ما بعد آخر صيانة، اتجاه تآكل الفرامل (بيتوقع الأيام المتبقية)، الزيت، الكاوتش، حرارة المحرك، أكواد الأعطال وتاريخ الأعطال. أي باص يتخطى 60 بيتفتح له أمر صيانة تلقائيًا والمالك بيوصله تنبيه.', 'The score comes from: km since the last service, the brake-wear trend (predicting days left), oil, tyres, engine temperature, fault codes and breakdown history. Any bus above 60 gets a work order automatically and the owner is alerted.')}</div></div>
      {modal && (
        <Modal title={modal.kind === 'done' ? tr('تمت الصيانة', 'Service completed') : modal.kind === 'order' ? tr('أمر صيانة جديد', 'New work order') : tr('تسجيل فحص', 'Log an inspection')} onClose={() => setModal(null)}>
          <p><Plate>{modal.bus.plate}</Plate></p>
          {modal.kind === 'done' && <div className="field"><label htmlFor="cs">{tr('التكلفة (ج.م)', 'Cost (EGP)')}</label><input id="cs" type="number" min={0} value={f.cost ?? ''} onChange={(e) => setF({ ...f, cost: e.target.value })} /><p className="hint">{tr('هيتصفّر عداد الصيانة وتتسجل قراءات جديدة.', 'Resets the service counter and logs fresh readings.')} {f.cost ? money(Number(f.cost)) : ''}</p></div>}
          {modal.kind === 'order' && <div className="stack8"><div className="field"><label htmlFor="ok">{tr('النوع', 'Type')}</label><select id="ok" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{[['routine', 'دورية', 'Routine'], ['brakes', 'فرامل', 'Brakes'], ['oil', 'زيت', 'Oil'], ['tires', 'كاوتش', 'Tyres'], ['other', 'أخرى', 'Other']].map(([k, a, e]) => <option key={k} value={k}>{tr(a, e)}</option>)}</select></div>
            <div className="field"><label htmlFor="or">{tr('ملاحظة', 'Note')}</label><input id="or" value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={120} /></div></div>}
          {modal.kind === 'check' && <div className="grid2f">{([['km', 'العداد (كم)', 'Odometer (km)'], ['brake', 'فحمات الفرامل %', 'Brake pads %'], ['oil', 'عمر الزيت %', 'Oil life %'], ['tire', 'عمق الكاوتش (مم)', 'Tyre depth (mm)'], ['temp', 'حرارة المحرك', 'Engine temp'], ['faults', 'أكواد أعطال', 'Fault codes']] as const).map(([k, a, e]) => <div className="field" key={k}><label htmlFor={'f' + k}>{tr(a, e)}</label><input id={'f' + k} type="number" step="any" value={f[k] ?? ''} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} /></div>)}</div>}
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn" disabled={busy || (modal.kind === 'check' && (!f.km || !f.brake || !f.oil || !f.tire))} onClick={submit}>{tr('حفظ', 'Save')}</button><button className="btn ghost" onClick={() => setModal(null)}>{tr('إلغاء', 'Cancel')}</button></div>
        </Modal>
      )}
    </>
  )
}
