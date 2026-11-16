import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { ErrorBox, Loading, useToast } from '@/components/ui'
import { PageTop } from './common'
import type { Settings as S } from '@/lib/types'

export default function Settings() {
  const { tr } = useI18n()
  const toast = useToast()
  const set = useAsync(() => api.settings(), [])
  const audit = useAsync(() => api.audit(), [], 15000)
  const [f, setF] = useState<S | null>(null)
  useEffect(() => { if (set.data) setF(set.data) }, [set.data])
  if (set.loading && !f) return <Loading />
  if (set.error || !f) return <ErrorBox error={set.error} onRetry={set.reload} />
  const num = (k: keyof S) => <input type="number" value={Number(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
  const save = async () => { await api.updateSettings({ delay_alert_minutes: f.delay_alert_minutes, low_load_pct: f.low_load_pct, high_load_pct: f.high_load_pct, planning_margin_pct: f.planning_margin_pct, payment_note_ar: f.payment_note_ar, payment_note_en: f.payment_note_en }); toast(tr('تم الحفظ', 'Saved')); set.reload(); audit.reload() }
  return (
    <>
      <PageTop title={tr('الإعدادات والسجل', 'Settings & audit')} sub={tr('للمالك فقط', 'Owner only')} />
      <div className="grid2">
        <div className="card">
          <h2>{tr('قواعد التشغيل', 'Operating rules')}</h2><p className="hint">{tr('بتأثر على التنبيهات وتوزيع الباصات', 'They drive alerts and bus planning')}</p>
          <div className="grid2f">
            <div className="field"><label>{tr('تنبيه التأخير بعد (دقيقة)', 'Alert students after (min)')}</label>{num('delay_alert_minutes')}</div>
            <div className="field"><label>{tr('هامش أمان للتخطيط %', 'Planning margin %')}</label>{num('planning_margin_pct')}</div>
            <div className="field"><label>{tr('إشغال منخفض أقل من %', 'Low load below %')}</label>{num('low_load_pct')}</div>
            <div className="field"><label>{tr('إشغال عالي أكتر من %', 'High load above %')}</label>{num('high_load_pct')}</div>
          </div>
          <div className="field" style={{ marginTop: 12 }}><label>{tr('طرق الدفع (عربي)', 'Payment note (Arabic)')}</label><textarea rows={2} value={f.payment_note_ar} onChange={(e) => setF({ ...f, payment_note_ar: e.target.value })} /></div>
          <div className="field" style={{ marginTop: 12 }}><label>{tr('طرق الدفع (إنجليزي)', 'Payment note (English)')}</label><textarea rows={2} value={f.payment_note_en} onChange={(e) => setF({ ...f, payment_note_en: e.target.value })} /></div>
          <div className="row gap8" style={{ marginTop: 14 }}><button className="btn" onClick={save}>{tr('حفظ', 'Save')}</button></div>
        </div>
        <div className="card">
          <h2>{tr('حماية البيانات', 'Data protection')}</h2>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 20, display: 'grid', gap: 8, fontSize: 14.5 }}>
            <li>{tr('جداول الطلاب والمدفوعات والرسائل مقفولة: مفيش وصول مباشر ليها من الإنترنت، فقط من خلال دوال بتتحقق من الصلاحية.', 'Student, payment and message tables are locked: no direct internet access, only through functions that check the role.')}</li>
            <li>{tr('مشرف التشغيل بيشوف الموبايل مخفي (0110****001) ومفيش له وصول للمدفوعات.', 'Dispatchers see masked phones and have no payment access.')}</li>
            <li>{tr('كل فتح لملف طالب وكل دفعة وكل إلغاء بيتسجل باسم الموظف.', 'Every student-file view, payment and cancellation is logged with the staff name.')}</li>
            <li>{tr('الطالب بيدخل برقم موبايله وكوده، وبعد 5 محاولات غلط بيتقفل 15 دقيقة.', 'Students verify with phone + code; 5 wrong attempts lock it for 15 minutes.')}</li>
            <li>{tr('موقع السواق بيتمسح بعد 10 دقايق ومبيتسجلش غير أثناء الرحلة.', "The driver's location is erased after 10 minutes and only kept while a trip runs.")}</li>
          </ul>
          <div className="note" style={{ marginTop: 14 }}><Icon name="shield" /><div>{tr('مهم قبل التشغيل الفعلي: اتفاق خصوصية مع الطلاب وتأمين حسابات الموظفين بتحقق ثنائي.', 'Before going live: a privacy notice for students and two-factor sign-in for staff accounts.')}</div></div>
        </div>
      </div>
      <div className="card">
        <h2>{tr('سجل المراجعة', 'Audit log')}</h2><p className="hint">{tr('من عمل إيه ومتى', 'Who did what, and when')}</p>
        <div className="scroll-x"><table className="table"><thead><tr><th>{tr('الوقت', 'When')}</th><th>{tr('الموظف', 'Staff')}</th><th>{tr('الإجراء', 'Action')}</th><th>{tr('على', 'On')}</th><th>{tr('تفاصيل', 'Details')}</th></tr></thead>
          <tbody>{(audit.data ?? []).map((a) => <tr key={a.id}><td className="num small">{a.at.slice(0, 16).replace('T', ' ')}</td><td>{a.who ?? '—'}</td><td><b>{a.action}</b></td><td className="num small">{a.entity} {a.ref}</td><td className="small muted">{a.detail}</td></tr>)}</tbody></table></div>
      </div>
    </>
  )
}
