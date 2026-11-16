// Local demo mock: builds the demo database from the project's SQL, then exposes the Supabase-style handler.
import fs from 'node:fs'
import { makeDb } from '../tests/db/harness.mjs'
import { fileURLToPath } from 'node:url'
import { createMock as createCore, STAFF } from './mock-core.mjs'
export { DEMO_PASSWORD, OWNER, DISPATCHER, ACCOUNTANT } from './mock-core.mjs'

const P = fileURLToPath(new URL('../supabase/', import.meta.url))

/** Builds and seeds the demo database (used by the local server and by the snapshot builder). */
export async function buildDemoDb() {
  const db = await makeDb([P + 'migrations/0001_sekka_core.sql'])
  for (const u of STAFF)
    await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '{"name":"${u.name}"}');
      insert into public.staff (id, full_name, role) values ('${u.id}', '${u.name}', '${u.role}');`)
  await db.exec(fs.readFileSync(P + 'seed.sql', 'utf8'))
  if (!process.env.NO_SAMPLE) await db.exec(fs.readFileSync(P + 'seed-sample-data.sql', 'utf8'))
  return db
}

export async function createMock() {
  const db = await buildDemoDb()
  await db.exec(`update public.company_settings set site_url = 'http://localhost:${process.env.PORT || 4173}'`)   // so tracking links in messages work locally
  return createCore(db)
}
