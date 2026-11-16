import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, Loading, useToast } from '@/components/ui'
import { PageTop } from './common'

export default function Messages() {
  const { tr, pick } = useI18n()
  const toast = useToast()
  const [tab, setTab] = useState<'requests' | 'outbox'>('requests')
  const reqs = useAsync(() => api.requests(), [], 10000)
  const out = useAsync(() => api.outbox(), [], 10000)
  const [note, setNote] = useState<Record<string, string>>({})
  const kindLabel = { stop_change: tr('تغيير محطة', 'Stop change'), renewal: tr('تجديد', 'Renewal'), absence: tr('غياب', 'Absence'), complaint: tr('شكوى', 'Complaint') }
  const kindOut: Record<string, [string, string]> = { renewal_reminder: ['تذكير تجديد', 'Renewal reminder'], overdue_payment: ['متابعة دفع', 'Payment nudge'], trip_delay: ['تأخير رحلة', 'Trip delay'], trip_cancelled: ['إلغاء رحلة', 'Trip cancelled'],
    receipt: ['إيصال', 'Receipt'], request_reply: ['رد على طلب', 'Request reply'], daily_report: ['التقرير اليومي', 'Daily report'], bus_alert: ['تنبيه صيانة', 'Maintenance alert'] }
  const resolve = async (id: string, ok: boolean) => { const r = await api.resolveRequest(id, ok, note[id]); toast(r.error ? tr('مش ممكن', 'Not possible') : ok ? tr('تمت الموافقة واتبعتت رسالة للطالب', 'Approved — student notified') : tr('تم الرفض', 'Rejected')); reqs.reload(); out.reload() }
  const open = (reqs.data ?? []).filter((r) => r.status === 'open')
  return (
    <>
      <PageTop title={tr('الرسائل والطلبات', 'Messages & requests')} sub={tr('طلبات الطلاب والرسائل التلقائية الخارجة', 'Student requests and the automatic outgoing messages')} />
      <div className="tabs">
        <button className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>{tr('طلبات الطلاب', 'Student requests')} <span className="num">({open.length})</span></button>
        <button className={tab === 'outbox' ? 'on' : ''} onClick={() => setTab('outbox')}>{tr('الرسائل الخارجة', 'Outgoing messages')} <span className="num">({out.data?.queued ?? 0})</span></button>
      </div>
      {tab === 'requests' && (reqs.loading && !reqs.data ? <Loading /> : reqs.error ? <ErrorBox error={reqs.error} onRetry={reqs.reload} /> : (
        <div className="stack">
          {(reqs.data ?? []).length === 0 && <div className="card empty">{tr('مفيش طلبات.', 'No requests.')}</div>}
          {(reqs.data ?? []).map((r) => (
            <div className="card" key={r.id} style={{ padding: 16, opacity: r.status === 'open' ? 1 : 0.65 }}>
              <div className="row between wrap"><div><b>{r.student}</b> <span className="muted small num">{r.code}</span> <Chip tone="sun">{kindLabel[r.kind]}</Chip></div><Chip tone={r.status === 'open' ? 'warn' : r.status === 'done' ? 'ok' : 'bad'}>{r.status === 'open' ? tr('مفتوح', 'Open') : r.status === 'done' ? tr('تم', 'Done') : tr('مرفوض', 'Rejected')}</Chip></div>
              <p style={{ margin: '8px 0' }}>
                {r.kind === 'stop_change' && tr(`من ${r.current_stop_ar} إلى ${r.stop_ar}`, `From ${r.current_stop_en} to ${r.stop_en}`)}
                {r.kind === 'absence' && tr(`مش هيركب يوم ${r.payload.date}`, `Won't ride on ${r.payload.date}`)}
                {r.kind === 'complaint' && `“${r.payload.text}”`}
                {r.kind === 'renewal' && tr('طلب تجديد للترم الجاي — بيتقفل أول ما الدفع يوصل', 'Renewal request for next term — closes when payment arrives')}
              </p>
              {r.status === 'open' && r.kind !== 'renewal' && (
                <div className="row gap8 wrap"><input className="inp" style={{ maxWidth: 280 }} placeholder={tr('ملاحظة للطالب (اختياري)', 'Note to the student (optional)')} value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} maxLength={100} aria-label={tr('ملاحظة', 'Note')} />
                  <button className="btn sm" onClick={() => void resolve(r.id, true)}>{r.kind === 'stop_change' ? tr('موافقة ونقل', 'Approve & move') : tr('تم الاطلاع', 'Acknowledge')}</button>
                  {r.kind === 'stop_change' && <button className="btn sm ghost" onClick={() => void resolve(r.id, false)}>{tr('رفض', 'Reject')}</button>}</div>
              )}
            </div>
          ))}
        </div>
      ))}
      {tab === 'outbox' && (out.loading && !out.data ? <Loading /> : out.error ? <ErrorBox error={out.error} onRetry={out.reload} /> : (
        <>
          <div className="note" style={{ marginBottom: 14 }}><Icon name="msg" /><div>{out.data?.whatsapp_enabled ? tr('إرسال واتساب مفعّل.', 'WhatsApp delivery is on.') : tr('الرسائل بتتجهّز وتتسجل هنا، لكن الإرسال الفعلي على واتساب متوقف لحد ما يتربط حساب واتساب للأعمال (WhatsApp Business API). لحد وقتها تقدر تبعتها يدويًا وتعلّم "اتبعتت".', 'Messages are prepared and logged here. Real WhatsApp delivery stays off until a WhatsApp Business API account is connected; until then you can send them by hand and mark them sent.')}</div></div>
          <div className="stack8">
            {(out.data?.rows ?? []).map((m) => (
              <div className="card" key={m.id} style={{ padding: 14 }}>
                <div className="row between wrap"><div className="row gap8 wrap"><Chip tone="gray">{tr(...(kindOut[m.kind] ?? [m.kind, m.kind]))}</Chip><b>{m.name ?? tr('المالك', 'Owner')}</b><span className="muted small num">{m.to}</span></div>
                  {m.status === 'queued' ? <button className="btn sm ghost" onClick={async () => { await api.markSent(m.id); out.reload() }}>{tr('علّم "اتبعتت"', 'Mark sent')}</button> : <Chip tone="ok">{tr('اتبعتت', 'Sent')}</Chip>}</div>
                <p className="small" dir="auto" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p>
              </div>
            ))}
          </div>
        </>
      ))}
    </>
  )
}
