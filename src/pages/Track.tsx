import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { useCompany } from '@/lib/company'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, LangToggle, Loading, Plate, useToast } from '@/components/ui'
import RouteMap from '@/components/RouteMap'
import type { TripView } from '@/lib/types'

export default function Track() {
  const { token = '' } = useParams()
  const { tr, pick, lang } = useI18n()
  const { company } = useCompany()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.track(token), [token], 4000)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { document.body.classList.add('phone-body'); return () => document.body.classList.remove('phone-body') }, [])
  useEffect(() => { document.title = `${tr('تتبع الباص', 'Track your bus')} — ${pick(company, 'name') || 'Sekka'}` }, [company, pick, tr])

  const trips = data?.trips ?? []
  const auto = useMemo(() => (trips.find((v) => v.status === 'running') ?? trips.find((v) => v.status === 'planned') ?? trips[trips.length - 1])?.trip_id ?? null, [trips])
  const view: TripView | undefined = trips.find((v) => v.trip_id === (sel ?? auto))

  const share = async () => {
    const url = location.href
    try { if (navigator.share) { await navigator.share({ title: tr('تتبع الباص', 'Track my bus'), url }); return } await navigator.clipboard.writeText(url); toast(tr('تم نسخ رابط المتابعة', 'Tracking link copied')) } catch { /* cancelled */ }
  }
  return (
    <div className="phone-page">
      <div className="ph-head">
        <Link to="/" className="ghost" style={{ color: '#fff', background: 'rgba(255,255,255,.12)', borderRadius: 10, padding: '6px 10px' }} aria-label={tr('الرئيسية', 'Home')}>{lang === 'ar' ? '→' : '←'}</Link>
        <div className="grow"><b>{tr('تتبع باصك', 'Track your bus')}</b><span className="s"><i /> {data?.ok ? tr(`أهلاً ${data.first_name}`, `Hi ${data.first_name}`) : pick(company, 'name')}</span></div>
        <LangToggle dark />
      </div>
      {loading && !data && <div style={{ padding: 24 }}><Loading /></div>}
      {error && <div style={{ padding: 16 }}><ErrorBox error={error} onRetry={reload} /></div>}
      {data?.error && <div className="empty" style={{ padding: 32 }}><Icon name="lock" size={28} /><p>{tr('الرابط ده غير صحيح أو انتهت صلاحيته. اطلب رابطك من المساعد.', 'This link is not valid. Ask the assistant for your link.')}</p><Link className="btn sm dark" to="/chat">{tr('افتح المساعد', 'Open the assistant')}</Link></div>}
      {data?.ok && !view && <div className="empty" style={{ padding: 32 }}><Icon name="bus" size={30} /><p>{tr('مفيش رحلات ليك النهارده.', 'You have no trips today.')}</p><p className="hint">{tr(`للاستفسار: ${data.company.phone}`, `Questions? Call ${data.company.phone}`)}</p></div>}
      {view && data && (
        <>
          <div className="trk-map">
            <div className="trk-top">
              <span className="pill"><Icon name="clock" size={16} /> <span className="num">{view.time}</span> {view.direction === 'to' ? tr('ذهاب', 'To campus') : tr('عودة', 'Return')}</span>
              {view.delay_minutes >= 5 && view.status !== 'completed' && <span className="pill" style={{ color: 'var(--bad)' }}><Icon name="alert" size={16} /> {tr(`متأخر ${view.delay_minutes} د`, `${view.delay_minutes} min late`)}</span>}
            </div>
            <RouteMap view={view} />
          </div>
          <div className="sheet">
            {trips.length > 1 && (
              <div className="trips-tabs" role="tablist">
                {trips.map((v) => <button key={v.trip_id} role="tab" aria-selected={v.trip_id === view.trip_id} className={`btn sm ${v.trip_id === view.trip_id ? 'dark' : 'ghost'}`} onClick={() => setSel(v.trip_id)}><span className="num">{v.time}</span> {v.direction === 'to' ? tr('ذهاب', 'To') : tr('عودة', 'Back')}</button>)}
              </div>
            )}
            <Body v={view} company={data.company} onShare={share} token={token} onRated={reload} />
          </div>
        </>
      )}
    </div>
  )
}

function Body({ v, company, onShare, token, onRated }: { v: TripView; company: { phone: string }; onShare: () => void; token: string; onRated: () => void }) {
  const { tr, pick, lang } = useI18n()
  const me = v.stops.find((s) => s.is_me)
  const idx = { planned: 0, on_way: 1, near: 2, arrived: 3, passed: 4, done: 4, cancelled: 0 }[v.phase]
  const head: Record<string, [string, string]> = {
    planned: ['الرحلة لسه ما اتحركتش', 'The trip has not started yet'], on_way: ['الباص في الطريق إليك', 'Your bus is on its way'], near: ['الباص على بُعد محطة واحدة', 'Your bus is one stop away'],
    arrived: ['الباص وصل محطتك', 'Your bus is at your stop'], passed: ['الباص عدّى محطتك', 'The bus has passed your stop'], done: ['الرحلة خلصت', 'The trip is finished'], cancelled: ['الرحلة اتلغت', 'The trip is cancelled'],
  }
  const [rating, setRating] = useState(v.my_rating ?? 0)
  const rate = async (n: number) => { setRating(n); await api.rateTrip(token, v.trip_id, n); onRated() }
  const steps = [[tr('اتحرك', 'Departed'), 'check'], [tr('في الطريق', 'On the way'), 'bus'], [tr('قرّب منك', 'Near you'), 'pin'], [tr('وصل', 'Arrived'), 'check']] as const
  return (
    <>
      <div className="status-line">
        <Chip tone={v.phase === 'cancelled' ? 'bad' : v.phase === 'arrived' || v.phase === 'near' ? 'ok' : v.delay_minutes >= 5 ? 'warn' : 'sun'} dot>{tr(...head[v.phase])}</Chip>
      </div>
      {v.phase === 'cancelled' ? (
        <p>{tr('رحلة', 'The')} <b className="num">{v.time}</b> {tr('اتلغت', 'trip was cancelled')}{v.cancel_reason ? ` — ${v.cancel_reason}` : ''}. {tr(`كلّم المكتب: ${company.phone}`, `Call the office: ${company.phone}`)}</p>
      ) : v.phase === 'done' || v.phase === 'passed' ? null : (
        <div className="eta-big">
          {v.phase === 'planned' ? <><b className="num">{me?.eta ?? v.time}</b><span>{tr('الوصول المتوقع لمحطتك', 'expected at your stop')}</span></>
            : v.eta_min !== null ? <><b className="num">{v.eta_min}</b><span>{tr('دقيقة · الوصول', 'min · arriving')} <span className="num">{v.eta_at}</span></span></> : null}
        </div>
      )}
      {v.phase !== 'cancelled' && (
        <div className="steps" aria-label={tr('مراحل الرحلة', 'Trip progress')}>
          {steps.map(([label, ic], i) => <div key={label} className={i < idx ? 'd' : i === idx ? 'c' : ''}><i><Icon name={ic} size={14} /></i>{label}</div>)}
        </div>
      )}
      {v.plate && v.phase !== 'cancelled' && (
        <div className="vehicle">
          <div className="dv"><Icon name="bus" size={22} /></div>
          <div className="grow"><Plate>{v.plate}</Plate><span>{v.driver_first ? tr(`الكابتن ${v.driver_first}`, `Driver ${v.driver_first}`) : ''}</span></div>
          <a className="btn sm ghost" href={`tel:${company.phone}`} aria-label={tr('اتصل بالمكتب', 'Call the office')}><Icon name="phone" size={16} /></a>
        </div>
      )}
      <div className="actions">
        <button className="btn ghost" onClick={onShare}><Icon name="share" size={18} /> {tr('شارك رابط المتابعة', 'Share link')}</button>
        <a className="btn dark" href={`tel:${company.phone}`}><Icon name="phone" size={18} /> {tr('اتصل بالمكتب', 'Call office')}</a>
      </div>
      {v.phase === 'done' && (
        <div className="card flat" style={{ textAlign: 'center', margin: '8px 0' }}>
          <b>{tr('إيه رأيك في الرحلة؟', 'How was the trip?')}</b>
          <div className="rate" role="radiogroup" aria-label={tr('تقييم الرحلة', 'Rate the trip')}>
            {[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rating === n} className={n <= rating ? 'on' : ''} onClick={() => rate(n)} aria-label={`${n}`}>★</button>)}
          </div>
          {rating > 0 && <div className="hint">{tr('شكراً على تقييمك!', 'Thanks for your rating!')}</div>}
        </div>
      )}
      <h3 style={{ fontSize: 15, margin: '14px 0 10px' }}>{tr('محطات الرحلة', 'Stops on this trip')}</h3>
      <div className="tl">
        {v.stops.map((s) => (
          <div key={s.pos} className={`s ${s.done ? 'done' : ''} ${s.is_me ? 'mine' : ''}`}>
            <div className="dot" />
            <div>
              <b>{pick(s, 'name')} {s.is_me && <Chip tone="sun">{tr('محطتك', 'Your stop')}</Chip>}</b>
              <span className="t num">{s.done ? `${tr('وصل', 'arrived')} ${s.actual}` : `${tr('متوقع', 'expected')} ${s.eta}`}{s.eta !== s.sched && !s.done ? ` · ${tr('الأصلي', 'planned')} ${s.sched}` : ''}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>{lang === 'ar' ? 'رابط خاص بيك — متشاركوش مع حد لا تعرفه.' : 'This is your private link — only share it with people you trust.'}</p>
    </>
  )
}
