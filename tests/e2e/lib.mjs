// Tiny Playwright helper for the UI test. Needs the demo server running: `npm run demo` (port 4173).
import { chromium } from 'playwright'
import fs from 'node:fs'
const require_fs = () => fs
export const BASE = process.env.BASE_URL || 'http://localhost:4173'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function launch({ mobile = false, lang = 'ar' } = {}) {
  const exe = process.env.PW_CHROMIUM || (['/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'].find((f) => { try { return require_fs().existsSync(f) } catch { return false } }))
  const browser = await chromium.launch(exe ? { executablePath: exe } : {})
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 810 },
    locale: lang === 'ar' ? 'ar-EG' : 'en-GB', timezoneId: 'Africa/Cairo',
  })
  await ctx.addInitScript((l) => { try { localStorage.setItem('sekka-lang', l) } catch {} }, lang)
  return { browser, ctx, page: await ctx.newPage() }
}
