import { useEffect, useMemo, useRef, useState } from 'react'
import type { TripView } from '@/lib/types'
import { useI18n } from '@/i18n'

type Pt = { x: number; y: number }
type Seg = [Pt, Pt, Pt, Pt]
const W = 360, H = 380, PADX = 52, PADT = 62, PADB = 70

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const bez = (s: Seg, t: number): Pt => { const a = lerp(s[0], s[1], t), b = lerp(s[1], s[2], t), c = lerp(s[2], s[3], t); return lerp(lerp(a, b, t), lerp(b, c, t), t) }
const split = (s: Seg, t: number): Seg => { const a = lerp(s[0], s[1], t), b = lerp(s[1], s[2], t), c = lerp(s[2], s[3], t), d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t); return [s[0], a, d, f] }
const d = (s: Seg, move = true) => `${move ? `M${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)} ` : ''}C${s[1].x.toFixed(1)} ${s[1].y.toFixed(1)} ${s[2].x.toFixed(1)} ${s[2].y.toFixed(1)} ${s[3].x.toFixed(1)} ${s[3].y.toFixed(1)}`

/** Catmull-Rom → cubic Bézier segments through the stops (a smooth road-like line). */
export function buildSegments(pts: Pt[]): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    out.push([p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2])
  }
  return out
}

/** Fit real lat/lng into the SVG box, keeping the aspect ratio (longitude scaled by cos(latitude)). */
export function project(stops: { lat: number; lng: number }[]): Pt[] {
  const k = Math.cos((stops.reduce((s, p) => s + p.lat, 0) / stops.length) * Math.PI / 180)
  const xs = stops.map((p) => p.lng * k), ys = stops.map((p) => -p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const sx = (W - 2 * PADX) / Math.max(maxX - minX, 1e-6), sy = (H - PADT - PADB) / Math.max(maxY - minY, 1e-6), s = Math.min(sx, sy)
  const ox = (W - (maxX - minX) * s) / 2, oy = PADT + (H - PADT - PADB - (maxY - minY) * s) / 2
  return stops.map((_, i) => ({ x: ox + (xs[i] - minX) * s, y: oy + (ys[i] - minY) * s }))
}

/** Deterministic "city" backdrop: soft blocks, a river and a few streets so the map feels like a map, without any tile service. */
function Backdrop() {
  return (
    <g transform={`scale(1 ${H / 420})`}>
      <rect width={W} height={420} fill="#efe8dc" />
      {Array.from({ length: 9 }).map((_, i) => <rect key={'a' + i} x={-20 + i * 46} y={-10} width={30} height={H + 20} fill="#f6f1e8" opacity={0.7} />)}
      {Array.from({ length: 10 }).map((_, i) => <rect key={'b' + i} x={-10} y={-10 + i * 46} width={W + 20} height={22} fill="#f6f1e8" opacity={0.75} />)}
      <path d="M-10 330 C80 300 140 380 230 340 S340 290 380 310 L380 350 C330 330 280 380 220 385 S80 345 -10 372 Z" fill="#cfe3ee" opacity={0.85} />
      <rect x={236} y={40} width={92} height={64} rx={16} fill="#dcebd2" /><rect x={20} y={190} width={64} height={52} rx={14} fill="#dcebd2" />
      <path d="M-10 120 L370 150 M60 -10 L90 430 M250 -10 L210 430" stroke="#fff" strokeWidth={5} fill="none" opacity={0.9} />
    </g>
  )
}

export default function RouteMap({ view, mini = false }: { view: TripView; mini?: boolean }) {
  const { pick, tr } = useI18n()
  const stops = view.stops
  const pts = useMemo(() => project(stops), [stops])
  const segs = useMemo(() => buildSegments(pts), [pts])
  const pf = view.pos_float ?? (view.status === 'completed' ? stops.length : 1)
  const idx = Math.min(Math.max(Math.floor(pf) - 1, 0), segs.length - 1)
  const frac = view.status === 'completed' ? 1 : Math.min(Math.max(pf - Math.floor(pf), 0), 1)
  const bus = view.status === 'planned' && view.last_pos === 0 ? pts[0] : (segs.length ? bez(segs[idx], view.status === 'completed' ? 1 : (pf >= stops.length ? 1 : frac)) : pts[0])
  const traveled = [...segs.slice(0, idx).map((s, i) => d(s, i === 0)), ...(segs[idx] && pf >= 1 ? [d(split(segs[idx], frac), idx === 0)] : [])].join(' ')
  const full = segs.map((s, i) => d(s, i === 0)).join(' ')
  const me = stops.find((s) => s.is_me)
  const meIdx = me ? stops.indexOf(me) : -1
  const late = view.delay_minutes >= 5

  // glide the marker between server updates
  const [shown, setShown] = useState<Pt>(bus)
  const raf = useRef(0)
  useEffect(() => {
    cancelAnimationFrame(raf.current)
    const from = shown, to = bus, t0 = performance.now(), dur = 1800
    const tick = (now: number) => { const k = Math.min(1, (now - t0) / dur); setShown({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }); if (k < 1) raf.current = requestAnimationFrame(tick) }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus.x, bus.y])

  const label = mini ? null : (s: typeof stops[number], p: Pt, i: number) => (i === 0 || i === stops.length - 1 || s.is_me) && (
    <text key={'l' + i} x={p.x} y={p.y + (i === 0 ? -16 : 24)} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#2b1b4b" stroke="#fffdf8" strokeWidth={3.5} paintOrder="stroke">{pick(s, 'name')}</text>
  )
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img"
      aria-label={tr(`خريطة الخط: الباص عند ${Math.round((pf / Math.max(stops.length, 1)) * 100)}% من الطريق`, `Route map: the bus is ${Math.round((pf / Math.max(stops.length, 1)) * 100)}% of the way`)}>
      <Backdrop />
      <path d={full} fill="none" stroke="#fff" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
      <path d={full} fill="none" stroke="#b9aedb" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      {traveled && <path d={traveled} fill="none" stroke="#ff7a45" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />}
      {stops.map((s, i) => {
        const p = pts[i]; const isEnd = i === stops.length - 1
        return (
          <g key={s.pos}>
            {isEnd ? <rect x={p.x - 8} y={p.y - 8} width={16} height={16} rx={4} fill="#2b1b4b" stroke="#fff" strokeWidth={3} />
              : <circle cx={p.x} cy={p.y} r={s.is_me ? 0 : 6} fill={s.done ? '#ff7a45' : '#fff'} stroke={s.done ? '#fff' : '#8a74e0'} strokeWidth={3} />}
            {label?.(s, p, i)}
          </g>
        )
      })}
      {me && meIdx >= 0 && (
        <g transform={`translate(${pts[meIdx].x} ${pts[meIdx].y})`}>
          <circle r={19} fill="#1b1030" opacity={0.14} /><circle r={9} fill="#1b1030" stroke="#fff" strokeWidth={3} />
        </g>
      )}
      {view.status !== 'cancelled' && (
        <g transform={`translate(${shown.x} ${shown.y})`}>
          <circle r={24} fill={late ? '#b8283f' : '#ff7a45'} opacity={0.22}><animate attributeName="r" values="18;28;18" dur="2.4s" repeatCount="indefinite" /></circle>
          <circle r={15} fill={late ? '#b8283f' : '#2b1b4b'} stroke="#fff" strokeWidth={3} />
          <g transform="translate(-8 -8) scale(.67)" stroke="#fff" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17V6a2 2 0 012-2h10a2 2 0 012 2v11M3 13h18M8.5 8h7M5 17h14v2H5z" /></g>
        </g>
      )}
    </svg>
  )
}
