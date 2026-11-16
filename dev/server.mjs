// One-process local demo: serves the built site AND a Supabase-compatible API backed by the project's real SQL
// running in PGlite. Nothing leaves your machine.   npm run demo   →  http://localhost:4173
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMock, DEMO_PASSWORD, OWNER, DISPATCHER, ACCOUNTANT } from './mock-supabase.mjs'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)), process.env.DIST || 'dist-demo')
const port = Number(process.env.PORT || 4173)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' }
const mock = await createMock()

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/')) {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end() }
    const chunks = []; for await (const c of req) chunks.push(c)
    const r = await mock.handle(req.method, req.url.startsWith('http') ? req.url : 'http://x' + req.url, req.headers, Buffer.concat(chunks).toString())
    res.writeHead(r.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...(r.range ? { 'content-range': r.range } : {}) })
    return res.end(r.json === null || r.json === undefined ? '' : JSON.stringify(r.json))
  }
  if (url.pathname.startsWith('/__stage/')) { const sf = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage', path.basename(url.pathname)); if (fs.existsSync(sf)) { res.setHeader('content-type', types[path.extname(sf)] || 'application/octet-stream'); return fs.createReadStream(sf).pipe(res) } }
  let f = path.join(root, decodeURIComponent(url.pathname))
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html')
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream')
  fs.createReadStream(f).pipe(res)
}).listen(port, () => console.log(`Sekka demo running on http://localhost:${port}\nOwner:      ${OWNER.email} / ${DEMO_PASSWORD}\nDispatcher: ${DISPATCHER.email} / ${DEMO_PASSWORD}\nAccountant: ${ACCOUNTANT.email} / ${DEMO_PASSWORD}\nStudent chat: phone 01100000001 · code ST-00001`))
