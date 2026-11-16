import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { useAuth } from '@/lib/auth'
import { Icon } from '@/components/Icon'
import { Chip, DemoTag, ErrorBox, Kpi, Loading, useToast } from '@/components/ui'
import { PageTop } from './common'
import { useState } from 'react'

export default function Overview() {
  const { tr, num, money, date } = useI18n()
  const { staff } = useAuth()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.overview(), [], 8000)
  const [busy, setBusy] = useState(false)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />
  const r = data.report, role = data.role
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast(msg); reload() } catch { toast(tr('حصلت مشكلة', 'Something went wrong')) } finally { setBusy(false) } }
  const maxLoad = Math.max(1, ...data.loads.map((l) => Math.max(l.capacity, l.expected)))
  const week = data.week, maxW = Math.max(1, ...week.map((w) => w.boarded))
  const points: { icon: string; text: string }[] = [
    { icon: 'card', text: tr(`${num(r.expiring14)} اشتراك بينتهي خلال 14 يوم، و${num(r.unpaid_renewals)} طلب تجديد لسه ما اتدفعش.`, `${num(r.expiring14)} subscriptions end within 14 days; ${num(r.unpaid_renewals)} renewals are still unpaid.`) },
    { icon: 'bus', text: tr(`رحلات النهارده ${num(r.trips)}، المتأخر منها ${num(r.delayed)}${r.shortfall ? `، ومقاعد ناقصة ${num(r.shortfall)}` : '، ولا يوجد نقص في المقاعد'}.`, `${num(r.trips)} trips today, ${num(r.delayed)} delayed${r.shortfall ? `, ${num(r.shortfall)} seats short` : ', no seat shortage'}.`) },
    { icon: 'wrench', text: r.urgent_buses + r.soon_buses ? tr(`${num(r.urgent_buses)} باص حالته خطرة و${num(r.soon_buses)} محتاج صيانة قريبة.`, `${num(r.urgent_buses)} bus(es) in urgent condition and ${num(r.soon_buses)} due for service soon.`) : tr('كل الباصات سليمة.', 'All buses are in good condition.') },
    { icon: 'msg', text: tr(`${num(r.open_requests)} طلب مفتوح من الطلاب في انتظار الرد.`, `${num(r.open_requests)} open student requests waiting for a reply.`) },
  ]
  return (
    <>
      <PageTop title={tr('نظرة عامة', 'Overview')} sub={tr(`التقرير اليومي — ${date(r.date)}`, `Daily report — ${date(r.date)}`)}
        right={<>
          {data.demo_mode && <DemoTag />}
          <span className="clock"><Icon name="clock" size={16} /> <span className="num">{data.now.slice(11, 16)}</span></span>
          {(role === 'owner' || role === 'dispatcher') && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { const x = await api.runAutomations(); toast(tr(`تم: ${x.reminders} تذكير، ${x.expired} اشتراك انتهى، ${x.orders} أمر صيانة`, `Done: ${x.reminders} reminders, ${x.expired} expired, ${x.orders} work orders`)) }, tr('تم تشغيل الأتمتة', 'Automations ran'))}><Icon name="spark" size={16} /> {tr('شغّل الأتمتة الآن', 'Run automations')}</button>}
          {role === 'owner' && <button className="btn sm" disabled={busy} onClick={() => run(() => api.sendDailyReport(), tr('اتحط التقرير في الرسائل', 'Report queued in messages'))}><Icon name="send" size={16} /> {tr('ابعت التقرير', 'Queue the report')}</button>}
        </>} />
      <div className="kpis">
        <Kpi icon="users" tone="i1" value={num(r.students)} label={tr('طالب مشترك', 'Active students')} />
        {role === 'accountant'
          ? <Kpi icon="card" tone="i2" value={num(r.expiring14)} label={tr('اشتراك بينتهي خلال 14 يوم', 'Ending within 14 days')} />
          : <Kpi icon="bus" tone="i2" value={num(r.trips)} label={tr('رحلة النهارده', 'Trips today')} foot={r.delayed ? <span style={{ color: 'var(--bad)' }}>{tr(`${r.delayed} متأخرة`, `${r.delayed} delayed`)}</span> : <span style={{ color: 'var(--ok)' }}>{tr('كلها في معادها', 'all on time')}</span>} />}
        <Kpi icon="card" tone="i3" value={num(role === 'accountant' ? r.unpaid_renewals : r.expiring14)} label={role === 'accountant' ? tr('تجديد لسه ما اتدفعش', 'Unpaid renewals') : tr('اشتراك بينتهي خلال 14 يوم', 'Ending within 14 days')} />
        {role === 'accountant'
          ? <Kpi icon="msg" tone="i4" value={num(r.open_requests)} label={tr('طلب مفتوح', 'Open requests')} />
          : <Kpi icon="wrench" tone="i4" value={num(r.urgent_buses + r.soon_buses)} label={tr('باص محتاج صيانة', 'Buses needing service')} foot={r.urgent_buses ? <span style={{ color: 'var(--bad)' }}>{tr(`${r.urgent_buses} حالته خطرة`, `${r.urgent_buses} urgent`)}</span> : undefined} />}
      </div>
      <div className="grid2">
        {role !== 'accountant' && (
          <div className="card">
            <h2>{tr('الطلب مقابل المقاعد', 'Demand vs seats')}</h2>
            <p className="hint">{tr('المتوقع ركوبه مقابل سعة الباصات المخصصة لكل ميعاد النهارده', "Expected riders vs the capacity of the buses assigned to each time today")}</p>
            <div className="dem" role="img" aria-label={tr('رسم الطلب والسعة لكل ميعاد', 'Demand and capacity by time slot')}>
              {data.loads.map((l) => (
                <div className="c" key={l.time + l.direction}>
                  <div className="stk"><i className="cap" style={{ height: `${(l.capacity / maxLoad) * 100}%` }} title={`${l.capacity}`} /><i className="exp" style={{ height: `${(l.expected / maxLoad) * 100}%` }} title={`${l.expected}`} /></div>
                  <span className="num">{l.time}</span>
                </div>
              ))}
            </div>
            <div className="leg"><span><i style={{ background: '#ece6fb' }} />{tr('سعة الباصات', 'Seats assigned')}</span><span><i style={{ background: 'var(--sun)' }} />{tr('المتوقع ركوبه', 'Expected riders')}</span></div>
            <h2 style={{ marginTop: 20 }}>{tr('ركاب آخر 14 يوم', 'Riders, last 14 days')}</h2>
            <div className="spark" role="img" aria-label={tr('عدد الركاب يوميًا', 'Daily riders')}>{week.map((w) => <i key={w.d} title={`${w.d}: ${w.boarded}`} style={{ height: `${Math.max(4, (w.boarded / maxW) * 100)}%`, opacity: w.boarded ? 1 : 0.25 }} />)}</div>
          </div>
        )}
        <div className="card report" style={role === 'accountant' ? { gridColumn: '1 / -1' } : undefined}>
          <h2>{tr('تقرير اليوم', "Today's report")}</h2>
          <p className="hint">{tr('بيتجمّع تلقائيًا من بيانات الشركة', 'Compiled automatically from company data')}</p>
          {points.map((p) => <div className="pt" key={p.icon}><Icon name={p.icon} size={19} /><span>{p.text}</span></div>)}
          {role === 'owner' && r.revenue7 !== undefined && <div className="pt"><Icon name="chart" size={19} /><span>{tr(`المحصّل آخر 7 أيام: ${money(r.revenue7)} جنيه.`, `Collected in the last 7 days: ${money(r.revenue7)} EGP.`)}</span></div>}
          {r.rating !== null && <div className="pt"><Icon name="spark" size={19} /><span>{tr(`تقييم الطلاب للرحلات (آخر 14 يوم): ${r.rating} من 5.`, `Student rating of trips (14 days): ${r.rating} / 5.`)}</span></div>}
          <div className="tag"><Icon name="lock" size={14} /> {tr(`ظاهر لك كـ ${staff?.role === 'owner' ? 'مالك' : staff?.role === 'dispatcher' ? 'مشرف تشغيل' : 'محاسب'} — الأرقام المالية للمالك فقط`, `Shown for your role — revenue figures are owner-only`)}</div>
        </div>
      </div>
      {role === 'owner' && r.urgent_buses > 0 && <div className="note"><Icon name="alert" /><div><b>{tr('تنبيه صيانة', 'Maintenance alert')}</b> — {tr('فيه باص حالته خطرة. تم فتح أمر صيانة تلقائيًا؛ راجع صفحة الأسطول.', 'A bus is in urgent condition. A work order was opened automatically; see the Fleet page.')} <Chip tone="bad">{tr('عاجل', 'Urgent')}</Chip></div></div>}
    </>
  )
}
