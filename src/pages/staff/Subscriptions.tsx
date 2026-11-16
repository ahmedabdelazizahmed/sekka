import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, Kpi, Loading, Modal, useToast } from '@/components/ui'
import { PageTop } from './common'
import type { PipelineRow } from '@/lib/types'

const COLS: { k: PipelineRow['stage']; ar: string; en: string; tone: string }[] = [
  { k: 'expiring', ar: 'بينتهي قريبًا', en: 'Ending soon', tone: 'warn' },
  { k: 'awaiting_payment', ar: 'منتظر الدفع', en: 'Awaiting payment', tone: 'sun' },
  { k: 'renewed', ar: 'اتجدد', en: 'Renewed', tone: 'ok' },
  { k: 'expired', ar: 'منتهي', en: 'Expired', tone: 'bad' },
]

export default function Subscriptions() {
  const { tr, pick, money, num } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.pipeline(), [], 10000)
  const box = useAsync(() => api.cashbox(7), [], 10000)
  const [pay, setPay] = useState<PipelineRow | null>(null)
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('cash'), [ref, setRef] = useState(''), [busy, setBusy] = useState(false)
  const [all, setAll] = useState<string | null>(null)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />
  const submit = async () => {
    if (!pay) return; setBusy(true)
    try {
      const r = await api.recordPayment(pay.sub_id, Number(amount), method, ref || undefined)
      if (r.error) toast(r.error === 'invalid_amount' ? tr(`المبلغ غير صحيح (المتبقي ${money(r.balance ?? 0)})`, `Invalid amount (balance ${money(r.balance ?? 0)})`) : tr('مش ممكن', 'Not possible'))
      else { toast(r.activated ? tr('تم الدفع واتفعّل الاشتراك — اتبعت إيصال للطالب', 'Paid — subscription activated, receipt queued') : tr('تم تسجيل دفعة جزئية', 'Partial payment recorded')); setPay(null); reload(); box.reload() }
    } finally { setBusy(false) }
  }
  return (
    <>
      <PageTop title={tr('الاشتراكات والتجديد', 'Subscriptions & renewals')} sub={tr('من اشتراكه هينتهي لحد اللي دفع. التذكيرات بتتبعت تلقائيًا.', 'From expiring to paid. Reminders go out automatically.')} />
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi icon="card" tone="i3" value={money(box.data?.total ?? 0)} unit={tr('ج.م', 'EGP')} label={tr('المحصّل آخر 7 أيام', 'Collected, last 7 days')} />
        <Kpi icon="alert" tone="i2" value={money(box.data?.outstanding ?? 0)} unit={tr('ج.م', 'EGP')} label={tr('متبقي على التجديدات', 'Outstanding on renewals')} />
        <Kpi icon="check" tone="i1" value={num(data.filter((x) => x.stage === 'renewed').length)} label={tr('اتجدد للترم الجاي', 'Renewed for next term')} />
      </div>
      <div className="kan">
        {COLS.map((c) => {
          const rows = data.filter((x) => x.stage === c.k), shown = all === c.k ? rows : rows.slice(0, 8)
          return (
            <div className="col" key={c.k}>
              <h3>{tr(c.ar, c.en)} <span className="num">{rows.length}</span></h3>
              {shown.map((s) => (
                <div className="st" key={s.student_id} style={{ cursor: c.k === 'awaiting_payment' ? 'pointer' : undefined }} onClick={() => { if (c.k === 'awaiting_payment') { setPay(s); setAmount(String(s.balance)); setMethod('cash'); setRef('') } }} role={c.k === 'awaiting_payment' ? 'button' : undefined} tabIndex={c.k === 'awaiting_payment' ? 0 : undefined}>
                  <div className="av">{s.name.slice(0, 1)}</div>
                  <div className="grow"><b>{s.name}</b><span>{pick({ a_ar: s.route_ar, a_en: s.route_en }, 'a')}</span></div>
                  <div className="amt">{c.k === 'awaiting_payment' ? <><div className="num">{money(s.balance)}</div><span>{tr('متبقي', 'due')}</span></> : c.k === 'expired' ? <Chip tone="bad">{tr('منتهي', 'expired')}</Chip> : <Chip tone={c.tone as 'ok' | 'warn' | ''}>{tr(`${s.days_left} يوم`, `${s.days_left} d`)}</Chip>}</div>
                </div>
              ))}
              {rows.length > shown.length && <button className="btn sm ghost block" onClick={() => setAll(c.k)}>{tr(`عرض الكل (${rows.length})`, `Show all (${rows.length})`)}</button>}
              {rows.length === 0 && <div className="empty small">—</div>}
            </div>
          )
        })}
      </div>
      <div className="note" style={{ marginTop: 16 }}><Icon name="msg" /><div>{tr('التذكيرات (14 و7 و1 يوم قبل الانتهاء) ومتابعة الدفع الأسبوعية بتتحط في صفحة الرسائل تلقائيًا، ولا بتتكرر.', 'Reminders (14, 7 and 1 days before expiry) and weekly payment nudges are queued in Messages automatically and never repeat.')}</div></div>
      {pay && (
        <Modal title={tr('تسجيل دفعة', 'Record a payment')} onClose={() => setPay(null)}>
          <p><b>{pay.name}</b> <span className="muted num">{pay.code}</span><br /><span className="muted">{tr('المتبقي', 'Balance')}: <b className="num">{money(pay.balance)}</b> / <span className="num">{money(pay.price)}</span> {tr('ج.م', 'EGP')}</span></p>
          <div className="grid2f">
            <div className="field"><label htmlFor="am">{tr('المبلغ', 'Amount')}</label><input id="am" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label htmlFor="mt">{tr('طريقة الدفع', 'Method')}</label><select id="mt" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">{tr('كاش', 'Cash')}</option><option value="instapay">{tr('إنستا باي', 'InstaPay')}</option><option value="vodafone_cash">{tr('فودافون كاش', 'Vodafone Cash')}</option><option value="bank">{tr('تحويل بنكي', 'Bank transfer')}</option></select></div>
          </div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="rf2">{tr('رقم العملية (اختياري)', 'Transaction reference (optional)')}</label><input id="rf2" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} /></div>
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn" disabled={busy || !Number(amount)} onClick={submit}>{tr('تسجيل الدفعة', 'Record payment')}</button><button className="btn ghost" onClick={() => setPay(null)}>{tr('إلغاء', 'Cancel')}</button></div>
        </Modal>
      )}
    </>
  )
}
