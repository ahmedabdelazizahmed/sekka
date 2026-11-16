// In-browser demo: the project's real SQL (RLS, role-checked functions, planning, maintenance, automations) runs inside
// PGlite (Postgres compiled to WebAssembly) in this page, behind a tiny Supabase-compatible handler. Nothing is sent to a
// server, every visitor gets a fresh private copy, and reloading the page resets it.
import { createMock } from '../../dev/mock-core.mjs'

export const DEMO_WEB = import.meta.env.VITE_DEMO_BROWSER === '1'
type Mock = Awaited<ReturnType<typeof createMock>>
let ready: Promise<Mock> | null = null
export type StepKey = 'engine' | 'data' | 'clock' | 'done'
export type Step = (key: StepKey) => void

export function startDemo(onStep: Step = () => {}): Promise<Mock> {
  if (!ready) ready = (async () => {
    onStep('engine')
    const [{ PGlite }, { btree_gist }] = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/btree_gist')])
    const base = import.meta.env.BASE_URL
    onStep('data')
    const [snap, meta] = await Promise.all([fetch(`${base}demo/sekka-db.tar.gz`).then((r) => r.blob()), fetch(`${base}demo/meta.json`).then((r) => r.json())])
    const db = new PGlite({ loadDataDir: snap, extensions: { btree_gist } })
    await db.waitReady
    onStep('clock')
    // The snapshot was taken at 07:10 on its demo day; restart the virtual clock from there so trips are running right now.
    await db.exec(`update public.company_settings set demo_shift_min =
      round(extract(epoch from ((date '${meta.d0}' + time '07:10') - (now() at time zone 'Africa/Cairo'))) / 60)::int where id = 1`)
    const mock = await createMock(db)
    onStep('done')
    return mock
  })()
  return ready
}

/** fetch() replacement handed to supabase-js in the web demo. */
export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const mock = await startDemo()
  const req = input instanceof Request ? input : null
  const url = req ? req.url : String(input)
  const headers: Record<string, string> = {}
  new Headers(init?.headers ?? req?.headers).forEach((v, k) => { headers[k.toLowerCase()] = v })
  const body = typeof init?.body === 'string' ? init.body : req ? await req.text() : ''
  const r = await mock.handle((init?.method ?? req?.method ?? 'GET').toUpperCase(), url, headers, body)
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (r.range) h['content-range'] = r.range
  const empty = r.json === null || r.json === undefined || r.status === 204
  return new Response(empty ? null : JSON.stringify(r.json), { status: r.status, headers: h })
}

/** Handy links for the demo bar: a student on the late Delta trip, and the driver of that trip. */
export async function demoLinks() {
  const mock = await startDemo()
  const s = await mock.admin(`select (public.student_status('01000000004', 'ST-00004'))->>'track_token' t`)
  const d = await mock.admin(`select t.driver_token d from public.trips t where t.status = 'running' order by t.delay_minutes desc, t.id limit 1`)
  return { track: s.rows[0]?.t as string | undefined, driver: d.rows[0]?.d as string | undefined }
}
