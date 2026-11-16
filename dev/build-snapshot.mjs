// Builds the in-browser demo database: runs the project's SQL + fictional seed once, then saves a PGlite snapshot
// that the browser loads in a couple of seconds.   node dev/build-snapshot.mjs  →  public/demo/
import fs from 'node:fs'
import zlib from 'node:zlib'
import { buildDemoDb } from './mock-supabase.mjs'

const db = await buildDemoDb()
await db.exec(`update public.company_settings set site_url = ''`)   // links in messages are relative in the web demo
const d0 = (await db.query(`select app_today()::text d`)).rows[0].d
await db.exec('checkpoint')
const blob = await db.dumpDataDir('gzip')

// Shrink: the snapshot is taken right after a checkpoint, so recycled WAL segments that are not the newest hold only
// stale data. Zero them (they compress to nothing); the newest segment stays so recovery still finds its checkpoint.
function shrinkWal(tarBuf, keep) {
  const out = Buffer.from(tarBuf); const segs = []
  for (let off = 0; off + 512 <= out.length;) {
    const name = out.toString('utf8', off, off + 100).replace(/\0.*$/s, '')
    if (!name) break
    const size = parseInt(out.toString('utf8', off + 124, off + 136).replace(/\0.*$/s, '').trim() || '0', 8)
    if (/(^|\/)pg_wal\/[0-9A-F]{24}$/.test(name)) segs.push({ name, start: off + 512, size })
    off += 512 + Math.ceil(size / 512) * 512
  }
  segs.sort((a, b) => (a.name < b.name ? -1 : 1))
  const zero = keep === 'first' ? segs.slice(1) : keep === 'last' ? segs.slice(0, -1) : []
  for (const sg of zero) out.fill(0, sg.start, sg.start + sg.size)
  return out
}
// Try each variant and keep the first one that actually boots (verified here, in-process), so the build never ships a broken snapshot.
const raw0 = zlib.gunzipSync(Buffer.from(await blob.arrayBuffer()))
const { PGlite } = await import('@electric-sql/pglite')
const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist')
let packed = null
for (const keep of ['first', 'last', 'all']) {
  const cand = zlib.gzipSync(shrinkWal(raw0, keep), { level: 9 })
  try {
    const t = new PGlite({ loadDataDir: new Blob([cand]), extensions: { btree_gist } }); await t.waitReady
    if ((await t.query('select count(*)::int n from students')).rows[0].n > 0) { packed = cand; console.log('wal variant', keep); break }
  } catch { /* try next */ }
}
if (!packed) throw new Error('no snapshot variant booted')
fs.mkdirSync('public/demo', { recursive: true })
fs.writeFileSync('public/demo/sekka-db.tar.gz', packed)
fs.writeFileSync('public/demo/meta.json', JSON.stringify({ d0, builtAt: new Date().toISOString() }))
console.log('snapshot', (fs.statSync('public/demo/sekka-db.tar.gz').size / 1e6).toFixed(1) + ' MB, demo day', d0)
process.exit(0)
