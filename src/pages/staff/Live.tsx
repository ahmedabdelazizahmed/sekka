import { useState } from 'react'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, DemoTag, ErrorBox, Loading, Plate, useToast } from '@/components/ui'
import { PageTop } from './common'
import type { LiveTrip } from '@/lib/types'

export default function Live() {
  const { tr, pick } = useI18n()
  const toast = useToast()
  const ov = useAsync(() => api.overview(), [], 8000)
  const { data, error, loading, reload } = useAsync(() => api.live(), [], 4000)
  const [busy, setBusy] = useState('')
  const demo = ov.data?.demo_mode ?? false
  const act = async (key: string, fn: () => Promise<{ ok?: boolean; error?: string; notified?: number }>, msg: (n?: number) => string) => {
    setBusy(key)
    try { const r = await fn(); toast(r.error ? tr('مش ممكن دلوقتي', 'Not possible now') : msg(r.notified)); reload(); ov.reload() } finally { setBusy('') }
  }
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <PageTop title={tr('التتبع المباشر', 'Live tracking')} sub={tr('كل رحلة شغّالة دلوقتي، وموقع الباص على الخط', 'Every trip running now, with the bus position on its line')}
        right={<>{demo && <DemoTag />}<span className="clock"><Icon name="clock" size={16} /> <span className="num">{ov.data?.now.slice(11, 16)}</span></span></>} />
      {data.length === 0 && <div className="card empty"><Icon name="bus" size={30} /><p>{tr('مفيش رحلات شغّالة دلوقتي.', 'No trips are running right now.')}</p><p className="hint">{tr('الرحلات بتظهر هنا قبل ميعادها بـ 45 دقيقة. في العرض التجريبي غيّر ساعة العرض من صفحة رحلات اليوم.', 'Trips appear here 45 minutes before departure. In the demo, move the demo clock from the Trips page.')}</p></div>}
      <div className="lines">
        {data.map((t) => <Line key={t.trip_id} t={t} demo={demo} busy={busy} act={act} />)}
      </div>
      <div className="note" style={{ marginTop: 16 }}><Icon name="pin" /><div>{tr('الموقع هنا من تسجيل السواق للوصول لكل محطة. لو السواق فعّل مشاركة الموقع، الطلاب بيشوفوا الباص على الخريطة بدقة أعلى.', "Position comes from the driver's stop check-ins. If the driver shares GPS, students see the bus on the map with higher precision.")}</div></div>
    </>
  )
}

function Line({ t, demo, busy, act }: { t: LiveTrip; demo: boolean; busy: string; act: (k: string, fn: () => Promise<{ ok?: boolean; error?: string; notified?: number }>, msg: (n?: number) => string) => Promise<void> }) {
  const { tr, pick } = useI18n()
  const n = t.stops.length
  const pf = t.pos_float ?? (t.status === 'completed' ? n : 1)
  const pct = (p: number) => `${((p - 1) / Math.max(n - 1, 1)) * 100}%`
  const late = t.delay_minutes >= 5
  return (
    <div className="ln">
      <div>
        <b>{pick({ a_ar: t.route_ar, a_en: t.route_en }, 'a')}</b>
        <span className="num">{t.time} · {t.direction === 'to' ? tr('ذهاب', 'to campus') : tr('عودة', 'return')}</span>
        <div className="row gap8 wrap" style={{ marginTop: 6 }}>
          {t.buses.map((b) => <Plate key={b}>{b}</Plate>)}
          <Chip tone={t.status === 'running' ? (late ? 'warn' : 'ok') : 'sun'} dot>{t.status === 'running' ? (late ? tr(`متأخر ${t.delay_minutes} د`, `${t.delay_minutes} min late`) : tr('في معاده', 'On time')) : tr('على وشك التحرك', 'About to depart')}</Chip>
          {t.notified > 0 && <Chip tone="gray"><Icon name="msg" size={13} /> {tr(`${t.notified} تنبيه للطلاب`, `${t.notified} student alerts`)}</Chip>}
        </div>
      </div>
      <div className="rd" role="img" aria-label={tr('موقع الباص على الخط', 'Bus position on the line')}>
        <div className="road" /><div className="done" style={{ width: `calc(${pct(Math.max(pf, 1))} * (100% - 12px) / 100%)` }} />
        {t.stops.map((s, i) => (
          <div key={s.pos}>
            <div className={`stp ${s.done ? 'p' : ''}`} style={{ insetInlineStart: pct(s.pos) }} />
            {(i === 0 || i === n - 1 || i % 2 === 0) && <div className={`lab${i === 0 || i === n - 1 ? "" : " mid"}`} style={{ insetInlineStart: pct(s.pos) }}>{pick(s, 'name')}</div>}
          </div>
        ))}
        {t.status === 'running' && <div className={`bus ${late ? 'late' : ''}`} style={{ insetInlineStart: pct(pf) }}><em className="num">{t.eta_at ?? ''}</em><div className="bi"><Icon name="bus" size={18} /></div></div>}
      </div>
      <div className="simbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {demo && <>
          <button className="btn sm dark" disabled={!!busy} onClick={() => act(t.trip_id + 'n', () => api.simulate(t.trip_id, Math.min(n, t.last_pos + 1), t.delay_minutes), () => tr('تقدّم الباص محطة', 'Bus moved one stop'))}>{tr('تقدّم محطة (عرض)', 'Advance a stop (demo)')}</button>
          <button className="btn sm ghost" disabled={!!busy} onClick={() => act(t.trip_id + 'd', () => api.simulate(t.trip_id, Math.max(1, t.last_pos), t.delay_minutes + 10), (k) => tr(`تأخير +10 د — اتبعت ${k ?? 0} تنبيه`, `+10 min delay — ${k ?? 0} alerts sent`))}>{tr('تأخير +10 د (عرض)', '+10 min delay (demo)')}</button>
        </>}
        {!demo && <button className="btn sm ghost" disabled={!!busy} onClick={() => act(t.trip_id + 'd', () => api.setDelay(t.trip_id, t.delay_minutes + 10, 'dispatcher'), (k) => tr(`اتبعت ${k ?? 0} تنبيه`, `${k ?? 0} alerts sent`))}>{tr('سجّل تأخير +10 د', 'Log +10 min delay')}</button>}
      </div>
    </div>
  )
}
