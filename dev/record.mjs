// Records the demo story as video. Needs the demo server running (npm run demo).
// usage: node dev/record.mjs h|v     → out/<mode>.webm  (+ stills in out/stills)
import { chromium } from 'playwright'
import fs from 'node:fs'
const mode = process.argv[2] || 'h'
const [W, H] = mode === 'h' ? [1920, 1080] : [1080, 1920]
const BASE = process.env.BASE_URL || 'http://localhost:4173'
const exe = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
fs.mkdirSync('out/stills', { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'ar-EG', timezoneId: 'Africa/Cairo' })
await ctx.addInitScript(() => { try { localStorage.setItem('sekka-lang', 'ar') } catch {} })
const page = await ctx.newPage()
const dir = `out/frames/${mode}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const cdp = await ctx.newCDPSession(page); const frames = []
cdp.on('Page.screencastFrame', async (f) => { const n = frames.length; fs.writeFileSync(`${dir}/${String(n).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64')); frames.push(f.metadata.timestamp); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
await page.goto(`${BASE}/__stage/stage.html?mode=${mode}`)
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
await page.waitForFunction(() => window.cap && document.getElementById('phone')?.contentDocument?.readyState === 'complete')
const d = page.frameLocator('#desk'), ph = page.frameLocator('#phone')
const cap = (t, s) => page.evaluate(([t, s]) => window.cap(t, s), [t, s])
const card = (t, s) => page.evaluate(([t, s]) => window.card(t, s), [t, s])
const still = (n) => page.screenshot({ path: `out/stills/${mode}-${n}.png` })
async function click(loc, { pause = 350 } = {}) {
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  const b = await loc.boundingBox(); if (!b) throw new Error('no box')
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await page.evaluate(([x, y]) => window.cur(x, y), [x, y]); await sleep(650)
  await page.evaluate(([x, y]) => window.rip(x, y), [x, y]); await sleep(120)
  await loc.click(); await sleep(pause)
}
async function type(loc, text) {
  const b = await loc.boundingBox(); await page.evaluate(([x, y]) => window.cur(x, y), [b.x + b.width / 2, b.y + b.height / 2]); await sleep(600)
  await loc.click(); await loc.pressSequentially(text, { delay: 70 }); await sleep(250); await page.keyboard.press('Enter')
}

await sleep(500)
if (mode === 'h') {
  await card('سكّة', 'اعرف الباص فين — والشركة تدير كل حاجة لوحدها'); await sleep(3200); await card(null)
  // staff login (owner)
  await cap('الشركة كلها في شاشة واحدة', 'طلاب · رحلات · تحصيل · صيانة — بيتحسبوا من بيانات الشركة نفسها')
  await click(d.getByRole('button', { name: 'مالك الشركة' }), { pause: 2800 })
  await still('overview'); await sleep(2500)
  // student asks the assistant
  await cap('الطالب بيسأل المساعد: الباص فين؟', 'بيرد من بيانات الشركة بس — ومش بيدّي رقم أو بيان لحد مش متحقق منه')
  await type(ph.getByRole('textbox'), '01000000004 ST-00004'); await sleep(1700)
  await type(ph.getByRole('textbox'), 'الباص فين؟'); await sleep(2300)
  await still('chat')
  await cap('تتبع مباشر زي أوبر', 'الخريطة، اسم السواق، رقم اللوحة، والوصول المتوقع لمحطتك')
  await click(ph.locator('a[href*="/track/"]').first(), { pause: 3500 })
  await still('track')
  // dispatcher watches live board and advances
  await cap('المشرف بيتابع كل الباصات الشغّالة', 'كل رحلة على خطها — والمتأخر بيظهر بالأحمر')
  await click(d.getByRole('link', { name: 'التتبع المباشر' }), { pause: 2500 })
  await still('live')
  const row = d.locator('.ln', { hasText: 'الدلتا' })
  await cap('الباص بيتحرك… والطالب بيشوفه', 'الباص بيتنقل على الخريطة لحظة بلحظة وبيتحدّث الوصول المتوقع')
  await click(row.getByRole('button', { name: /تقدّم/ }), { pause: 6500 })
  await click(row.getByRole('button', { name: /تقدّم/ }), { pause: 6500 })
  await still('moved')
  await cap('حصل تأخير؟ الطلاب بيتبلّغوا لوحدهم', 'رسالة لكل طالب في الرحلة بوقته الجديد — من غير ما حد يتصل بحد')
  await click(row.getByRole('button', { name: /تأخير/ }), { pause: 7000 })
  await still('delay')
  // fleet
  await cap('صيانة قبل ما يحصل العطل', 'كل باص له درجة خطورة من 0 لـ 100 وأسبابها مكتوبة بوضوح')
  await click(d.getByRole('link', { name: 'الأسطول والصيانة' }), { pause: 3500 })
  await still('fleet'); await sleep(2500)
  // lines
  await cap('توزيع الباصات حسب الطلب', 'بيتوقع الحضور الفعلي ويوزّع أصغر باص يكفي — من غير تعارض')
  await click(d.getByRole('link', { name: 'الخطوط والطلب' }), { pause: 3500 })
  await still('lines'); await sleep(2500)
  // subscriptions
  await cap('تجديد الاشتراكات تلقائي', 'تذكير قبل الانتهاء بـ 14 و7 و1 يوم، ومتابعة اللي لسه ما دفعش')
  await click(d.getByRole('link', { name: 'الاشتراكات' }), { pause: 3500 })
  await still('subs'); await sleep(2200)
  // owner report + privacy
  await cap('بيانات الطلاب محمية', 'صلاحيات لكل دور · أرقام الموبايل مخفية عن المشرف · وسجل بكل من فتح إيه')
  await click(d.getByRole('link', { name: 'الإعدادات والسجل' }), { pause: 3500 })
  await still('settings'); await sleep(2500)
  await cap(null); await card('سكّة', 'نظام تشغيل لشركات نقل الطلاب — تتبع · اشتراكات · توزيع · صيانة · حماية بيانات'); await sleep(3500)
} else {
  await card('اعرف الباص فين', 'زي أوبر.. بس لباص جامعتك'); await sleep(2800); await card(null)
  await cap('اسأل المساعد', 'رقمك وكودك — والرد من بيانات الشركة'); await sleep(900)
  await type(ph.getByRole('textbox'), '01000000004 ST-00004'); await sleep(1800)
  await type(ph.getByRole('textbox'), 'الباص فين؟'); await sleep(2500)
  await still('chat')
  await cap('افتح الخريطة', 'شوف الباص وهو جاي ليك'); await sleep(600)
  await click(ph.locator('a[href*="/track/"]').first(), { pause: 3500 })
  await still('track'); await sleep(2500)
  await cap('اسم السواق ورقم اللوحة', 'ومواعيد كل محطة في الطريق'); await sleep(900)
  await ph.locator('.sheet, body').first().evaluate((e) => window.scrollTo({ top: 520, behavior: 'smooth' })).catch(() => {})
  await sleep(3500); await still('stops')
  await ph.locator('body').evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(1800)
  await cap('لو اتأخر.. بيتبلّغك', 'رسالة بالوقت الجديد من غير ما تسأل'); await sleep(3500)
  await cap(null); await card('سكّة', 'مواصلات جامعية مضمونة وفي معادها'); await sleep(3000)
}
await sleep(400); await cdp.send('Page.stopScreencast'); await ctx.close(); await browser.close()
const lines = frames.map((t, i) => `file '${process.cwd()}/${dir}/${String(i).padStart(6, '0')}.jpg'\nduration ${(i < frames.length - 1 ? frames[i + 1] - t : 0.4).toFixed(4)}`)
lines.push(`file '${process.cwd()}/${dir}/${String(frames.length - 1).padStart(6, '0')}.jpg'`)
fs.writeFileSync(`${dir}/list.txt`, lines.join('\n'))
console.log('frames', frames.length, 'seconds', (frames.at(-1) - frames[0]).toFixed(1))
