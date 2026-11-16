import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { Icon } from '@/components/Icon'
import { Chip, ErrorBox, LangToggle, Loading, Plate, useToast } from '@/components/ui'

export default function Driver() {
  const { token = '' } = useParams()
  const { tr, pick } = useI18n()
  const toast = useToast()
  const { data: v, error, loading, reload } = useAsync(() => api.driverTrip(token), [token], 5000)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [gps, setGps] = useState(false)
  const watch = useRef<number | null>(null)
  const lastPing = useRef(0)
  useEffect(() => { document.body.classList.add('phone-body'); return () => document.body.classList.remove('phone-body') }, [])
  const act = async (fn: () => Promise<{ ok?: boolean; error?: string }>, okMsg?: string) => {
    setBusy(true)
    try { const r = await fn(); if (r.error) toast(tr('مش ممكن دلوقتي: ', 'Not possible now: ') + r.error); else if (okMsg) toast(okMsg); reload() } finally { setBusy(false) }
  }
  // Optional real GPS (the production path): the browser shares the position at most every 8 seconds while the trip runs.
  useEffect(() => {
    if (!gps || v?.status !== 'running' || !navigator.geolocation) return
    watch.current = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - lastPing.current < 8000) return
      lastPing.current = Date.now(); void api.driverPing(token, p.coords.latitude, p.coords.longitude)
    }, () => setGps(false), { enableHighAccuracy: true, maximumAge: 5000 })
    return () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current) }
  }, [gps, v?.status, token])

  const next = v && !v.error && v.status !== 'completed' ? v.stops.find((s) => s.pos === v.last_pos + 1) : undefined
  const waiting = next ? v?.counts[String(next.stop_id)] ?? 0 : 0
  return (
    <div className="phone-page">
      <div className="ph-head">
        <div className="grow"><b>{tr('صفحة السواق', 'Driver page')}</b><span className="s"><i /> {v?.route_ar ? pick({ r_ar: v.route_ar, r_en: v.route_en }, 'r') : '—'}</span></div>
        <LangToggle dark />
      </div>
      {loading && !v && <div style={{ padding: 24 }}><Loading /></div>}
      {error && <div style={{ padding: 16 }}><ErrorBox error={error} onRetry={reload} /></div>}
      {v?.error && <div className="empty" style={{ padding: 32 }}>{tr('رابط الرحلة غير صحيح.', 'This trip link is not valid.')}</div>}
      {v && !v.error && (
        <div className="drv-body">
          <div className="card flat">
            <div className="row between"><div><b className="num" style={{ fontSize: 22 }}>{v.time}</b> <span className="muted">{v.direction === 'to' ? tr('ذهاب إلى الجامعة', 'to campus') : tr('عودة من الجامعة', 'return trip')}</span></div>
              <Chip tone={v.status === 'running' ? 'ok' : v.status === 'completed' ? 'gray' : 'sun'} dot>{{ planned: tr('لم تبدأ', 'Not started'), running: tr('شغّالة', 'Running'), completed: tr('خلصت', 'Finished'), cancelled: tr('ملغية', 'Cancelled') }[v.status]}</Chip></div>
            <div className="row gap8 wrap" style={{ marginTop: 8 }}>{v.plate && <Plate>{v.plate}</Plate>}<span className="muted small">{tr(`الركاب المتوقعين ${v.expected} · ركبوا ${v.boarded}`, `${v.expected} expected · ${v.boarded} boarded`)}</span></div>
          </div>

          {v.status === 'planned' && <button className="drv-big" disabled={busy} onClick={() => act(() => api.driverStart(token), tr('بدأت الرحلة ✅', 'Trip started ✅'))}><Icon name="play" /> {tr('ابدأ الرحلة', 'Start the trip')}</button>}

          {v.status === 'running' && next && (
            <>
              <div className="card flat">
                <div className="lbl">{tr('المحطة الجاية', 'Next stop')}</div>
                <div className="row between"><b style={{ fontSize: 20 }}>{pick(next, 'name')}</b><Chip tone="sun">{tr(`${waiting} طالب مستني`, `${waiting} waiting`)}</Chip></div>
                <div className="hint num">{tr('الميعاد', 'Scheduled')} {next.sched}</div>
              </div>
              <button className="drv-big green" disabled={busy} onClick={() => act(() => api.driverArrive(token, next.pos), tr('تم تسجيل الوصول ✅', 'Arrival recorded ✅'))}><Icon name="check" /> {tr(`وصلت ${pick(next, 'name')}`, `Arrived at ${pick(next, 'name')}`)}</button>
              <div className="card flat">
                <div className="lbl">{tr('الطلاب في المحطة دي', 'Students at this stop')}</div>
                {v.next_students.length === 0 && <div className="hint">{tr('مفيش طلاب مسجلين هنا.', 'No students registered here.')}</div>}
                {v.next_students.map((s) => (
                  <div className="stu" key={s.code}><div><b>{s.first_name}</b> <span className="muted small num">{s.code}</span></div>
                    {s.boarded ? <Chip tone="ok">{tr('ركب', 'Boarded')}</Chip> : <button className="btn sm" disabled={busy} onClick={() => act(() => api.driverBoard(token, s.code))}>{tr('ركب', 'Boarded')}</button>}</div>
                ))}
                <form className="row gap8" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) void act(() => api.driverBoard(token, code), tr('تم تسجيل الركوب ✅', 'Boarding recorded ✅')).then(() => setCode('')) }}>
                  <input className="inp" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('كود الكارنيه (ST-00001)', 'Card code (ST-00001)')} aria-label={tr('كود الكارنيه', 'Card code')} />
                  <button className="btn dark" type="submit">{tr('تسجيل', 'Add')}</button>
                </form>
              </div>
              <label className="card flat row between" style={{ cursor: 'pointer' }}>
                <span><b>{tr('مشاركة موقعي', 'Share my location')}</b><span className="hint" style={{ display: 'block' }}>{tr('بتظهر للطلاب على الخريطة. الموقع بيتمسح بعد 10 دقايق.', 'Shown to students on the map. Location is erased after 10 minutes.')}</span></span>
                <input type="checkbox" checked={gps} onChange={(e) => setGps(e.target.checked)} style={{ width: 24, height: 24 }} />
              </label>
            </>
          )}
          {v.status === 'completed' && <div className="card flat" style={{ textAlign: 'center' }}><Icon name="check" size={28} /><p><b>{tr('تمت الرحلة. شكراً!', 'Trip completed. Thank you!')}</b></p></div>}
          {v.status === 'cancelled' && <div className="notice">{tr('الرحلة دي اتلغت من المكتب.', 'This trip was cancelled by the office.')}</div>}
          <p className="hint" style={{ textAlign: 'center' }}>{tr('الرابط ده خاص بالرحلة دي بس.', 'This link only works for this trip.')}</p>
        </div>
      )}
    </div>
  )
}
