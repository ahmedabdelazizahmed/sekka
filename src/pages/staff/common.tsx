import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'

export function PageTop({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="top">
      <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {right && <div className="row gap8 wrap">{right}</div>}
    </div>
  )
}

export const hhmm = (iso: string) => iso.slice(11, 16)

export function useReasonText() {
  const { tr, num } = useI18n()
  return (r: { code: string; km?: number; pct?: number; days?: number; mm?: number; n?: number; c?: number }) => {
    switch (r.code) {
      case 'service_overdue': return tr(`تعدّى ميعاد الصيانة الدورية بـ ${num(r.km ?? 0)} كم`, `${num(r.km ?? 0)} km past the service interval`)
      case 'service_due': return tr(`باقي ${num(r.km ?? 0)} كم على الصيانة الدورية`, `${num(r.km ?? 0)} km until the next service`)
      case 'service_soon': return tr(`باقي ${num(r.km ?? 0)} كم على الصيانة الدورية`, `${num(r.km ?? 0)} km until the next service`)
      case 'brakes_low': return tr(`فحمات الفرامل ${r.pct}% فقط`, `Brake pads at only ${r.pct}%`)
      case 'brakes_days': return tr(`الفرامل هتوصل لحد الأمان خلال حوالي ${r.days} يوم (حسب اتجاه التآكل)`, `Brakes reach the safety limit in about ${r.days} days (from the wear trend)`)
      case 'oil_low': return tr(`عمر الزيت ${r.pct}%`, `Oil life at ${r.pct}%`)
      case 'tires_low': return tr(`عمق الكاوتش ${r.mm} مم`, `Tyre depth ${r.mm} mm`)
      case 'engine_hot': return tr(`حرارة المحرك ${r.c}°`, `Engine temperature ${r.c}°`)
      case 'faults': return tr(`${r.n} أكواد أعطال في آخر أسبوعين`, `${r.n} fault codes in the last 2 weeks`)
      case 'breakdowns': return tr(`${r.n} أعطال خلال 90 يوم`, `${r.n} breakdowns in 90 days`)
      default: return r.code
    }
  }
}
