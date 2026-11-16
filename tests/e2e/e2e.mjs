// End-to-end UI test against the running demo (`npm run demo`, port 4173).
import { launch, BASE, sleep } from './lib.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
const section = (t) => console.log('\n' + t)
const errors = []
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${tag}: ${r.status()} ${r.url()}`) })
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

async function staffLogin(page, role) {
  await page.goto(BASE + '/staff/login'); await page.getByRole('button', { name: role }).click(); await page.waitForURL(/\/staff$/, { timeout: 8000 })
}
const navLinks = (page) => page.locator('nav a, .nav a').allInnerTexts()

// 1. Landing
section('Landing')
{
  const { browser, page } = await launch({ mobile: true }); watch(page, 'landing')
  await page.goto(BASE + '/'); await page.waitForSelector('h1')
  ok((await page.getAttribute('html', 'dir')) === 'rtl', 'Arabic is RTL by default')
  ok(await noHScroll(page), 'no horizontal scroll on a phone')
  await page.getByRole('button', { name: /English/ }).first().click(); await sleep(300)
  ok((await page.getAttribute('html', 'dir')) === 'ltr', 'switching to English flips to LTR')
  await browser.close()
}

// 2. Student assistant
section('Student assistant')
let trackPath = ''
{
  const { browser, page } = await launch({ mobile: true }); watch(page, 'chat')
  await page.goto(BASE + '/chat')
  const say = async (t) => { await page.getByRole('textbox').fill(t); await page.keyboard.press('Enter'); await sleep(1200) }
  await say('الباص فين؟')
  ok(/موبايل|رقم/.test(await page.locator('body').innerText()), 'asks for identity before sharing anything')
  await say('01000000004 ST-00004')
  ok(/منة/.test(await page.locator('body').innerText()), 'greets the verified student by name')
  await say('الباص فين؟')
  const link = page.locator('a[href*="/track/"]').first()
  ok(await link.count() > 0, 'answer links to the live tracking page')
  trackPath = new URL(await link.getAttribute('href'), BASE).pathname
  await say('اشتراكي ينتهي امتى')
  ok(/جنيه/.test(await page.locator('body').innerText()), 'subscription answer shows the amount')
  const before = await page.locator('body').innerText()
  await say('رقم موبايل أحمد')
  const after = (await page.locator('body').innerText()).replace(before, '').replace(/0100000000[1234]|01100000001/g, '')
  if (/01\d{9}/.test(after)) console.log('   saw:', after.match(/01\d{9}/g))
  ok(!/01\d{9}/.test(after), 'never leaks a student phone number (office numbers are fine)')
  ok(await noHScroll(page), 'no horizontal scroll in chat')
  await browser.close()
}

// 3. Tracking page
section('Live tracking (student)')
{
  const { browser, page } = await launch({ mobile: true }); watch(page, 'track')
  await page.goto(BASE + trackPath); await page.waitForSelector('svg.map', { timeout: 8000 })
  ok(await page.locator('svg.map').count() === 1, 'map is drawn')
  ok(await page.locator('.plate').count() > 0, 'bus plate is shown')
  ok(/\d{1,2}:\d{2}/.test(await page.locator('.eta-big').innerText()), 'ETA is shown')
  ok(await noHScroll(page), 'no horizontal scroll')
  const t1 = await page.locator('svg.map g[transform*="translate"]').last().getAttribute('transform')
  await page.goto(BASE + '/track/not-a-real-token'); await sleep(1500)
  ok(!(await page.locator('svg.map').count()), 'unknown link shows no map')
  ok(t1 !== null, 'bus marker present')
  await browser.close()
}

// 4. Staff roles
section('Staff roles')
const roles = [['مالك الشركة', 9], ['مشرف التشغيل', 7], ['المحاسب', 4]]
for (const [role, n] of roles) {
  const { browser, page } = await launch(); watch(page, role)
  await staffLogin(page, role)
  const links = await navLinks(page)
  ok(links.length === n, `${role}: sees ${n} sections (saw ${links.length})`)
  if (role === 'المحاسب') {
    ok(!links.some((l) => /الأسطول/.test(l)), 'accountant has no fleet page')
    await page.goto(BASE + '/staff/fleet'); await sleep(1200)
    ok(!/6367|ك ص م/.test(await page.locator('main, .main').innerText()), 'accountant cannot open the fleet by URL')
  }
  if (role === 'مشرف التشغيل') {
    await page.goto(BASE + '/staff/students'); await sleep(1500)
    ok(!/01\d{9}/.test(await page.locator('table').first().innerText()), 'dispatcher sees masked phone numbers')
  }
  await browser.close()
}
{
  const { browser, page } = await launch(); watch(page, 'anon')
  await page.goto(BASE + '/staff'); await sleep(1200)
  ok(/login/.test(page.url()), 'unauthenticated /staff goes to login')
  await browser.close()
}

// 5. Owner flows: delay alert + report + audit
section('Owner flows')
{
  const { browser, page } = await launch(); watch(page, 'owner')
  await staffLogin(page, 'مالك الشركة'); await sleep(2500)
  ok(/\d{1,3}(,\d{3})*\s*جنيه/.test(await page.locator('.main, main').innerText()), 'owner sees revenue in the daily report')
  await page.goto(BASE + '/staff/live'); await page.waitForSelector('.ln')
  const before = await page.locator('.ln').count()
  await page.getByRole('button', { name: /تأخير \+10/ }).first().click(); await sleep(1500)
  ok(/تنبيه|اتبعت/.test(await page.locator('body').innerText()), 'a +10 min delay queues alerts to students')
  await page.goto(BASE + '/staff/messages'); await sleep(1200)
  await page.getByRole('button', { name: /الرسائل الخارجة/ }).click(); await sleep(800)
  ok(/متأخر/.test(await page.locator('.main, main').innerText()), 'delay message appears in the outbox')
  await page.goto(BASE + '/staff/settings'); await sleep(1500)
  ok(await page.locator('table tbody tr, .audit li, .audit-row').count() > 0, 'audit log has entries')
  ok(before >= 1, 'live board lists running trips')
  await browser.close()
}

// 6. Driver
section('Driver page')
{
  const { browser, page } = await launch(); watch(page, 'drv')
  let tok = null
  page.on('response', async (r) => { if (/staff_trips|staff_today/.test(r.url())) { try { const m = JSON.stringify(await r.json()).match(/"driver_token":"(\w+)"/); if (m && !tok) tok = m[1] } catch { /* ignore */ } } })
  await staffLogin(page, 'مشرف التشغيل'); await page.goto(BASE + '/staff/trips'); await sleep(2000)
  ok(!!tok, 'dispatcher can get a trip link for the driver')
  const { browser: b2, page: p2 } = await launch({ mobile: true }); watch(p2, 'drv2')
  await p2.goto(BASE + '/driver/' + tok); await sleep(1500)
  ok(await p2.locator('.plate').count() > 0, 'driver sees the bus plate')
  const arrive = p2.getByRole('button', { name: /وصلت/ })
  if (await arrive.count()) { await arrive.first().click(); await sleep(1200) }
  ok(await noHScroll(p2), 'driver page fits a phone')
  await p2.goto(BASE + '/driver/bad-token'); await sleep(1000)
  ok(!(await p2.locator('.plate').count()), 'wrong driver link shows nothing')
  await b2.close(); await browser.close()
}

section('Console / network')
ok(errors.length === 0, `no page errors or failed requests${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
