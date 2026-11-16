// Supabase (PostgREST + GoTrue) stand-in backed by the project's REAL SQL running in PGlite.
// Isomorphic: used by the local demo server (dev/server.mjs) and by the in-browser demo (src/demo).
export const DEMO_PASSWORD = 'demo1234'
export const OWNER = { id: 'a0000000-0000-4000-8000-000000000001', email: 'owner@demo.sekka.test', name: 'كريم (المالك)', role: 'owner' }
export const DISPATCHER = { id: 'a0000000-0000-4000-8000-000000000002', email: 'dispatch@demo.sekka.test', name: 'سلمى (التشغيل)', role: 'dispatcher' }
export const ACCOUNTANT = { id: 'a0000000-0000-4000-8000-000000000003', email: 'accounts@demo.sekka.test', name: 'منى (الحسابات)', role: 'accountant' }
export const STAFF = [OWNER, DISPATCHER, ACCOUNTANT]

const b64u = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (u) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp: 4102444800 })}.x`
const decode = (h) => {
  const m = /^Bearer\s+(.+)$/i.exec(h || '')
  if (!m) return null
  try { const p = JSON.parse(decodeURIComponent(escape(atob(m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); return p.sub ? p : null } catch { return null }
}

export async function createMock(db) {
  // ---- schema metadata (foreign keys) so embedded selects resolve like PostgREST ----
  const fks = (await db.query(`
    select c.conname, c.conrelid::regclass::text t, c.confrelid::regclass::text ft,
           (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(n,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n) cols,
           (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(n,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n) fcols,
           exists (select 1 from pg_index i where i.indrelid=c.conrelid and i.indisunique and i.indnatts=cardinality(c.conkey) and i.indkey::int2[] @> c.conkey and i.indpred is null) uniq
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`)).rows
  const bare = (s) => s.replace(/^public\./, '').replace(/"/g, '')
  fks.forEach((f) => { f.t = bare(f.t); f.ft = bare(f.ft) })

  let queue = Promise.resolve()
  const locked = (fn) => { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r }

  async function asUser(claims, sql, params = []) {
    const role = claims ? 'authenticated' : 'anon'
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${claims?.sub ?? ''}',false);`)
    try { return await db.query(sql, params) }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
  }

  // ---- select parsing -------------------------------------------------------
  function splitTop(s) {
    const out = []; let d = 0, cur = ''
    for (const ch of s) {
      if (ch === '(') d++
      if (ch === ')') d--
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  function parseSelect(s) {
    return splitTop(s || '*').map((it) => {
      const m = /^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s.exec(it)
      if (m) return { kind: 'embed', alias: m[1] || m[2], rel: m[2], hint: m[3], items: parseSelect(m[4]) }
      if (it === '*') return { kind: 'star' }
      return { kind: 'col', name: it.split(':').pop().replace(/::.*/, '').trim() }
    })
  }
  const q = (n) => `"${n}"`
  let depth = 0
  function buildCols(table, items, a) {
    return items.map((it) => {
      if (it.kind === 'star') return `${a}.*`
      if (it.kind === 'col') return `${a}.${q(it.name)}`
      const d = ++depth, c = `c${d}`
      let f = fks.find((x) => (it.hint ? x.conname === it.hint : false))
      if (!f) f = fks.find((x) => x.t === it.rel && x.ft === table) || fks.find((x) => x.t === table && x.ft === it.rel)
      if (!f) throw new Error(`no relationship ${table} -> ${it.rel}`)
      const childHolds = f.t === it.rel && f.ft === table && !(f.t === table && f.ft === table && false)
      const inner = buildCols(it.rel, it.items, c)
      if (childHolds && f.t === it.rel && (f.ft === table)) {
        const cond = f.cols.map((col, i) => `${c}.${q(col)} = ${a}.${q(f.fcols[i])}`).join(' and ')
        if (f.uniq) return `(select to_jsonb(s${d}) from (select ${inner.join(', ')} from public.${it.rel} ${c} where ${cond} limit 1) s${d}) as ${q(it.alias)}`
        return `(select coalesce(jsonb_agg(to_jsonb(s${d})), '[]'::jsonb) from (select ${inner.join(', ')} from public.${it.rel} ${c} where ${cond}) s${d}) as ${q(it.alias)}`
      }
      const cond = f.fcols.map((col, i) => `${c}.${q(col)} = ${a}.${q(f.cols[i])}`).join(' and ')
      return `(select to_jsonb(s${d}) from (select ${inner.join(', ')} from public.${it.rel} ${c} where ${cond} limit 1) s${d}) as ${q(it.alias)}`
    })
  }

  const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
  function buildWhere(sp, a, params) {
    const w = []
    for (const [k, v] of sp.entries()) {
      if (RESERVED.has(k)) continue
      let [op, ...rest] = v.split('.'); let val = rest.join('.')
      let neg = false
      if (op === 'not') { neg = true;[op, ...rest] = rest; val = rest.join('.') }
      const col = `${a}.${q(k)}`
      let c
      if (op === 'eq') { params.push(val); c = `${col} = $${params.length}` }
      else if (op === 'neq') { params.push(val); c = `${col} <> $${params.length}` }
      else if (op === 'gt') { params.push(val); c = `${col} > $${params.length}` }
      else if (op === 'gte') { params.push(val); c = `${col} >= $${params.length}` }
      else if (op === 'lt') { params.push(val); c = `${col} < $${params.length}` }
      else if (op === 'lte') { params.push(val); c = `${col} <= $${params.length}` }
      else if (op === 'is') c = val === 'null' ? `${col} is null` : `${col} is ${val}`
      else if (op === 'in') {
        const vals = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))
        c = `${col} in (${vals.map((x) => { params.push(x); return `$${params.length}` }).join(',')})`
      } else throw new Error('unsupported filter ' + v)
      w.push(neg ? `not (${c})` : c)
    }
    return w.length ? 'where ' + w.join(' and ') : ''
  }
  function buildOrder(sp, a) {
    const o = sp.get('order'); if (!o) return ''
    return 'order by ' + o.split(',').map((p) => {
      const [col, ...m] = p.split('.')
      return `${a}.${q(col)} ${m.includes('desc') ? 'desc' : 'asc'}${m.includes('nullsfirst') ? ' nulls first' : m.includes('nullslast') ? ' nulls last' : ''}`
    }).join(', ')
  }

  async function handleRest(method, url, headers, bodyText) {
    const claims = decode(headers.authorization)
    const pathname = url.pathname.replace(/^\/rest\/v1\//, '')
    const sp = url.searchParams
    const body = bodyText ? JSON.parse(bodyText) : null
    const prefer = headers.prefer || ''
    const wantObj = /vnd\.pgrst\.object/.test(headers.accept || '')

    if (pathname.startsWith('rpc/')) {
      const fn = pathname.slice(4)
      const meta = (await db.query(`select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid=p.prorettype where p.proname=$1 and p.pronamespace='public'::regnamespace limit 1`, [fn])).rows[0]
      if (!meta) return { status: 404, json: { message: 'function not found' } }
      const args = Object.entries(body || {})
      const call = `public.${fn}(${args.map(([k], i) => `${k} := $${i + 1}`).join(', ')})`
      const params = args.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
      let sql
      if (meta.proretset) sql = `select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) as j from ${call} f`
      else if (meta.typtype === 'c') sql = `select to_jsonb(f) as j from ${call} f`
      else sql = `select to_jsonb(${call}) as j`
      const r = await asUser(claims, sql, params)
      return { status: 200, json: r.rows[0]?.j ?? null }
    }

    const table = pathname
    const params = []
    if (method === 'GET' || method === 'HEAD') {
      const items = parseSelect(sp.get('select') || '*')
      depth = 0
      const cols = buildCols(table, items, 't')
      const where = buildWhere(sp, 't', params)
      const order = buildOrder(sp, 't')
      const lim = sp.get('limit') ? `limit ${parseInt(sp.get('limit'))}` : ''
      const off = sp.get('offset') ? `offset ${parseInt(sp.get('offset'))}` : ''
      const sql = `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as j from (select ${cols.join(', ')} from public.${table} t ${where} ${order} ${lim} ${off}) r`
      const r = await asUser(claims, sql, params)
      const rows = r.rows[0].j
      if (wantObj) {
        if (rows.length !== 1) return { status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` } }
        return { status: 200, json: rows[0] }
      }
      return { status: 200, json: rows, range: `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
    }

    const rep = /return=representation/.test(prefer)
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body]
      const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))]
      const conflict = sp.get('on_conflict')
      let sql = `insert into public.${table} (${keys.map(q).join(',')}) select ${keys.map(q).join(',')} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`
      if (conflict || /resolution=/.test(prefer)) {
        const ck = (conflict || 'id').split(',').map(q).join(',')
        const sets = keys.filter((k) => !(conflict || 'id').split(',').includes(k))
        sql += ` on conflict (${ck}) ` + (/ignore-duplicates/.test(prefer) || !sets.length ? 'do nothing' : `do update set ${sets.map((k) => `${q(k)} = excluded.${q(k)}`).join(', ')}`)
      }
      sql += ` returning to_jsonb(${table}.*) as j`
      const r = await asUser(claims, sql, [JSON.stringify(rows)])
      const out = r.rows.map((x) => x.j)
      return rep ? { status: 201, json: wantObj ? out[0] : out } : { status: 201, json: null }
    }
    if (method === 'PATCH') {
      const keys = Object.keys(body)
      const where = buildWhere(sp, 't', params)
      params.push(JSON.stringify(body))
      const sql = `update public.${table} as t set ${keys.map((k) => `${q(k)} = x.${q(k)}`).join(', ')} from (select * from jsonb_populate_record(null::public.${table}, $${params.length}::jsonb)) x ${where} returning to_jsonb(t.*) as j`
      const r = await asUser(claims, sql, params)
      return rep ? { status: 200, json: wantObj ? r.rows[0]?.j : r.rows.map((x) => x.j) } : { status: 204, json: null }
    }
    if (method === 'DELETE') {
      const where = buildWhere(sp, 't', params)
      const r = await asUser(claims, `delete from public.${table} as t ${where} returning to_jsonb(t.*) as j`, params)
      return rep ? { status: 200, json: r.rows.map((x) => x.j) } : { status: 204, json: null }
    }
    return { status: 405, json: { message: 'method not allowed' } }
  }

  async function userRow(email) {
    const r = await db.query(`select u.id, u.email, u.raw_user_meta_data meta from auth.users u where lower(u.email)=lower($1)`, [email])
    return r.rows[0]
  }
  const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: u.meta || {}, created_at: new Date().toISOString() })
  const session = (u) => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, refresh_token: 'demo-refresh', user: userJson(u) })

  async function handleAuth(method, url, headers, bodyText) {
    const p = url.pathname.replace(/^\/auth\/v1\//, '')
    if (p === 'token') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      if (url.searchParams.get('grant_type') === 'password') {
        const u = await userRow(body.email || '')
        if (!u || body.password !== DEMO_PASSWORD) return { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials', message: 'Invalid login credentials' } }
        return { status: 200, json: session(u) }
      }
      const c = decode(headers.authorization)
      return { status: 400, json: { message: 'no refresh in demo' } }
    }
    if (p === 'user') {
      const c = decode(headers.authorization)
      if (!c) return { status: 401, json: { message: 'no session' } }
      const u = (await db.query(`select id, email, raw_user_meta_data meta from auth.users where id=$1`, [c.sub])).rows[0]
      return { status: 200, json: userJson(u) }
    }
    if (p === 'logout') return { status: 204, json: null }
    return { status: 404, json: { message: 'not implemented in demo' } }
  }

  return {
    db,
    /** Run an admin query in turn with API requests (never in the middle of one). */
    admin: (sql, params) => locked(() => db.query(sql, params)),
    sessionFor: async (email) => session(await userRow(email)),
    handle: (method, urlStr, headers, bodyText) => locked(async () => {
      const url = new URL(urlStr)
      try {
        if (url.pathname.startsWith('/rest/v1/')) return await handleRest(method, url, headers, bodyText)
        if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(method, url, headers, bodyText)
        return { status: 404, json: { message: 'not found' } }
      } catch (e) {
        return { status: 400, json: { message: String(e.message || e), code: e.code || 'P0001' } }
      }
    }),
  }
}
