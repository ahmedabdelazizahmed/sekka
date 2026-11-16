export type Role = 'owner' | 'dispatcher' | 'accountant'
export interface StaffMember { id: string; full_name: string; role: Role }

export interface Company { name_ar: string; name_en: string; tagline_ar: string; tagline_en: string; phone: string; whatsapp: string; term_name_ar: string; term_name_en: string; term_start: string; term_end: string;
  next_term_name_ar: string | null; next_term_name_en: string | null; next_term_start: string | null; next_term_end: string | null; payment_note_ar: string; payment_note_en: string; demo_mode: boolean; site_url: string }
export interface University { id: number; name_ar: string; name_en: string; city_ar: string; city_en: string }
export interface Stop { id: number; route_id: number; seq: number; name_ar: string; name_en: string; offset_min: number; lat: number; lng: number }
export interface RouteRow { id: number; code: string; name_ar: string; name_en: string; university_id: number; term_price: number; duration_min: number; stops?: Stop[] }
export interface Slot { id: number; direction: 'to' | 'from'; depart_time: string }

export type Phase = 'planned' | 'on_way' | 'near' | 'arrived' | 'passed' | 'done' | 'cancelled'
export interface TripStop { pos: number; stop_id: number; name_ar: string; name_en: string; lat: number; lng: number; sched: string; eta: string; actual: string | null; done: boolean; is_me: boolean }
export interface TripView {
  trip_id: string; direction: 'to' | 'from'; time: string; date: string; status: 'planned' | 'running' | 'completed' | 'cancelled'; phase: Phase; delay_minutes: number
  plate: string | null; driver_first: string | null; stops: TripStop[]; me_pos: number | null; last_pos: number; n: number; eta_at: string | null; eta_min: number | null
  route_ar: string; route_en: string; expected: number; cancel_reason: string | null; pos_float: number | null; gps: { lat: number; lng: number; age_s: number } | null; my_rating: number | null
}
export interface TrackResult { ok?: boolean; error?: string; first_name: string; now: string; trips: TripView[]; company: { name_ar: string; name_en: string; phone: string }; active: boolean }

export interface StudentStatus {
  ok?: boolean; error?: string; today: string
  student: { first_name: string; code: string; lang: 'ar' | 'en' }
  route: { name_ar: string; name_en: string; price: number; university_ar: string; university_en: string }
  stop: { id: number; name_ar: string; name_en: string }; to_time: string; from_time: string
  subscription: { status: string; ends_on: string; price: number; paid: number; balance: number; days_left: number; term_ar: string; term_en: string } | null
  renewal: { term_ar: string | null; term_en: string | null; price: number; requested: boolean; status: string | null; paid: number; balance: number; reference: string }
  track_token: string
  company: { name_ar: string; name_en: string; phone: string; whatsapp: string; payment_note_ar: string; payment_note_en: string }
}

export interface DriverTrip extends TripView { counts: Record<string, number>; next_students: { code: string; first_name: string; boarded: boolean }[]; boarded: number }

export interface RiskReason { code: string; w: number; km?: number; pct?: number; days?: number; mm?: number; n?: number; c?: number }
export interface Risk { bus_id: number; plate: string; score: number; level: 'ok' | 'watch' | 'soon' | 'urgent'; brake_days: number | null; km_since_service: number; km_left: number; reasons: RiskReason[] }
export interface FleetBus { id: number; plate: string; model: string; year: number; capacity: number; status: string; odometer_km: number; driver: string | null; risk: Risk
  order: { id: string; kind: string; reason: string; created_by: string; scheduled_for: string } | null; checks: { on: string; brake: number; km: number }[] }

export interface Report { date: string; students: number; expiring14: number; unpaid_renewals: number; revenue7?: number; trips: number; delayed: number; shortfall: number; urgent_buses: number; soon_buses: number; open_requests: number; rating: number | null; breakdowns7: number; text_ar?: string }
export interface Overview { role: Role; now: string; report: Report; demo_mode: boolean; loads: { time: string; direction: 'to' | 'from'; expected: number; capacity: number }[]; week: { d: string; boarded: number }[] }
export interface StaffTrip { id: string; time: string; direction: 'to' | 'from'; route_id: number; route_ar: string; route_en: string; status: string; delay_minutes: number; enrolled: number; expected: number; unassigned_seats: number; driver_token: string
  capacity: number; buses: { plate: string; capacity: number; driver: string | null }[]; boarded: number; last_pos: number; n: number; rating: number | null }
export interface LiveTrip extends TripView { route_id: number; notified: number; enrolled: number; buses: string[] }
export interface DemandSlot { route_id: number; name_ar: string; name_en: string; direction: 'to' | 'from'; time: string; enrolled: number; rate: number; expected: number | null; shortfall: number | null; capacity: number; buses: number; advice: 'unplanned' | 'shortfall' | 'overload' | 'low' | 'ok' }
export interface Demand { routes: { id: number; code: string; name_ar: string; name_en: string; students: number; price: number }[]; slots: DemandSlot[] }
export interface StudentRow { id: string; code: string; name: string; phone: string; status: string; route_ar: string; route_en: string; stop_ar: string; stop_en: string; university_ar: string; university_en: string; to_time: string; from_time: string; sub_status: string | null; ends_on: string | null; days_left: number | null }
export interface StudentDetail { id: string; code: string; name: string; phone: string; lang: string; status: string; route_id: number; stop_id: number
  subscriptions: { id: string; term: string; status: string; starts_on: string; ends_on: string; price: number; paid: number }[]
  payments: { amount: number; method: string; reference: string | null; at: string }[]; stops: { id: number; name_ar: string; name_en: string }[] }
export interface PipelineRow { student_id: string; code: string; name: string; route_ar: string; route_en: string; days_left: number; sub_id: string; price: number; balance: number; stage: 'healthy' | 'expiring' | 'awaiting_payment' | 'renewed' | 'expired'; rank: number }
export interface StaffRequest { id: string; kind: 'stop_change' | 'renewal' | 'absence' | 'complaint'; status: 'open' | 'done' | 'rejected'; at: string; student: string; code: string; payload: Record<string, string>; stop_ar: string | null; stop_en: string | null; current_stop_ar: string; current_stop_en: string }
export interface OutboxRow { id: string; kind: string; to: string; name: string | null; lang: string; body: string; status: 'queued' | 'sent' | 'skipped'; at: string }
export interface Outbox { whatsapp_enabled: boolean; queued: number; rows: OutboxRow[] }
export interface AuditRow { id: number; at: string; who: string | null; action: string; entity: string; ref: string | null; detail: string | null }
export interface Settings { phone: string; whatsapp: string; owner_phone: string; delay_alert_minutes: number; low_load_pct: number; high_load_pct: number; planning_margin_pct: number; payment_note_ar: string; payment_note_en: string; whatsapp_enabled: boolean; demo_mode: boolean }
export interface Cashbox { total: number; by_method: Record<string, number>; outstanding: number }
