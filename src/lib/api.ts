import { supabase } from './supabase'
import type * as T from './types'

/** Calls a database function. Staff functions raise 'forbidden' etc.; student/driver functions return {error: code}. */
async function rpc<R>(fn: string, args: Record<string, unknown> = {}): Promise<R> {
  const r = await supabase.rpc(fn, args)
  if (r.error) throw new Error(/forbidden/.test(r.error.message) ? 'forbidden' : r.error.message)
  return r.data as R
}
const rows = async <R,>(q: PromiseLike<{ data: R[] | null; error: { message: string } | null }>) => { const r = await q; if (r.error) throw new Error(r.error.message); return r.data ?? [] }

export const api = {
  // ── public catalogue
  company: async () => { const r = await supabase.from('public_company').select('*').single(); if (r.error) throw new Error(r.error.message); return r.data as T.Company },
  universities: () => rows<T.University>(supabase.from('universities').select('*').order('id')),
  routes: () => rows<T.RouteRow>(supabase.from('routes').select('*, stops(*)').order('id')),
  slots: () => rows<T.Slot>(supabase.from('slots').select('*').order('depart_time')),

  // ── students (no login: phone + student code)
  studentStatus: (phone: string, code: string) => rpc<T.StudentStatus>('student_status', { p_phone: phone, p_code: code }),
  studentRequest: (phone: string, code: string, kind: string, payload: Record<string, unknown> = {}) => rpc<Record<string, unknown>>('student_request', { p_phone: phone, p_code: code, p_kind: kind, p_payload: payload }),
  track: (token: string) => rpc<T.TrackResult>('track_by_token', { p_token: token }),
  rateTrip: (token: string, trip: string, rating: number, comment?: string) => rpc<{ ok?: boolean; error?: string }>('rate_trip', { p_token: token, p_trip: trip, p_rating: rating, p_comment: comment ?? null }),

  // ── driver (private link per trip)
  driverTrip: (token: string) => rpc<T.DriverTrip & { error?: string }>('driver_trip', { p_token: token }),
  driverStart: (token: string) => rpc<{ ok?: boolean; error?: string }>('driver_start', { p_token: token }),
  driverArrive: (token: string, pos: number) => rpc<{ ok?: boolean; error?: string; done?: boolean }>('driver_arrive', { p_token: token, p_pos: pos }),
  driverBoard: (token: string, code: string) => rpc<{ ok?: boolean; error?: string; first_name?: string }>('driver_board', { p_token: token, p_code: code }),
  driverPing: (token: string, lat: number, lng: number) => rpc<{ ok?: boolean; error?: string }>('driver_ping', { p_token: token, p_lat: lat, p_lng: lng }),

  // ── staff session
  signIn: async (email: string, password: string) => { const r = await supabase.auth.signInWithPassword({ email, password }); if (r.error) throw new Error('bad_login'); return r.data },
  signOut: async () => { await supabase.auth.signOut() },
  me: async (): Promise<T.StaffMember | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const r = await supabase.from('staff').select('*').eq('id', session.user.id).maybeSingle()
    return (r.data as T.StaffMember | null) ?? null
  },

  // ── staff
  overview: () => rpc<T.Overview>('staff_overview'),
  trips: (date?: string) => rpc<T.StaffTrip[]>('staff_trips', { p_date: date ?? null }),
  live: () => rpc<T.LiveTrip[]>('staff_live'),
  setDelay: (trip: string, minutes: number, reason?: string) => rpc<{ ok?: boolean; error?: string; notified?: number }>('staff_set_delay', { p_trip: trip, p_minutes: minutes, p_reason: reason ?? null }),
  cancelTrip: (trip: string, reason?: string) => rpc<{ ok?: boolean; error?: string; notified?: number }>('staff_cancel_trip', { p_trip: trip, p_reason: reason ?? null }),
  simulate: (trip: string, pos: number, delay = 0) => rpc<{ ok?: boolean; error?: string }>('staff_simulate', { p_trip: trip, p_pos: pos, p_delay: delay }),
  setDemoClock: (time: string | null) => rpc<{ ok?: boolean; error?: string; now?: string }>('staff_set_demo_clock', { p_time: time }),
  planDay: (date?: string) => rpc<{ operating?: boolean; trips?: number; assignments?: number; buses_used?: number; shortfall_seats?: number; error?: string }>('plan_day', { p_date: date ?? null }),
  demand: (date?: string) => rpc<T.Demand>('staff_demand', { p_date: date ?? null }),
  fleet: () => rpc<T.FleetBus[]>('staff_fleet'),
  createOrder: (bus: number, kind: string, reason = '') => rpc<{ ok?: boolean; error?: string }>('staff_create_order', { p_bus: bus, p_kind: kind, p_reason: reason, p_date: null }),
  completeOrder: (id: string, cost: number) => rpc<{ ok?: boolean; error?: string }>('staff_complete_order', { p_id: id, p_cost: cost }),
  addCheck: (v: { bus: number; km: number; brake: number; oil: number; tire: number; temp: number; faults: number }) =>
    rpc<{ ok?: boolean; error?: string }>('staff_add_check', { p_bus: v.bus, p_km: v.km, p_brake: v.brake, p_oil: v.oil, p_tire: v.tire, p_temp: v.temp, p_faults: v.faults }),
  students: (q: string, route: number | null, limit = 60) => rpc<{ total: number; rows: T.StudentRow[] }>('staff_students', { p_q: q || null, p_route: route, p_limit: limit }),
  studentDetail: (id: string) => rpc<T.StudentDetail & { error?: string }>('staff_student_detail', { p_id: id }),
  updateStop: (id: string, stop: number) => rpc<{ ok?: boolean; error?: string }>('staff_update_student_stop', { p_id: id, p_stop: stop }),
  pipeline: () => rpc<T.PipelineRow[]>('staff_subscriptions'),
  recordPayment: (sub: string, amount: number, method: string, ref?: string) => rpc<{ ok?: boolean; error?: string; activated?: boolean; balance?: number }>('staff_record_payment', { p_sub: sub, p_amount: amount, p_method: method, p_ref: ref ?? null }),
  cashbox: (days = 7) => rpc<T.Cashbox>('staff_cashbox', { p_days: days }),
  requests: () => rpc<T.StaffRequest[]>('staff_requests'),
  resolveRequest: (id: string, approve: boolean, note?: string) => rpc<{ ok?: boolean; error?: string }>('staff_resolve_request', { p_id: id, p_approve: approve, p_note: note ?? null }),
  outbox: () => rpc<T.Outbox>('staff_outbox', { p_limit: 80 }),
  markSent: (id: string) => rpc<{ ok?: boolean }>('staff_mark_sent', { p_id: id }),
  audit: () => rpc<T.AuditRow[]>('staff_audit', { p_limit: 120 }),
  settings: () => rpc<T.Settings>('staff_settings'),
  updateSettings: (v: Partial<T.Settings>) => rpc<{ ok?: boolean }>('staff_update_settings', { p: v }),
  runAutomations: () => rpc<{ expired: number; reminders: number; overdue: number; orders: number; alerts: number }>('staff_run_automations'),
  sendDailyReport: () => rpc<{ queued: number }>('staff_send_daily_report'),
}
