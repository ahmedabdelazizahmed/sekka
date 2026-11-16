// Runs every test file in sequence and fails if any of them fails.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const files = [
  'tests/db/sekka.test.mjs',            // database: confidentiality, roles, planning, maintenance, automations, payments, tracking
  'tests/assistant/assistant.test.mjs', // assistant: understanding, verification, grounded answers, multi-step flows
]
const root = fileURLToPath(new URL('../', import.meta.url))
let failed = 0
for (const f of files) {
  console.log(`\n━━ ${f}`)
  const r = spawnSync(process.execPath, [f], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) { failed++; console.log(`✗ ${f} failed`) }
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nAll test files passed')
process.exit(failed ? 1 : 0)
