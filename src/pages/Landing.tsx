import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useCompany } from '@/lib/company'
import { useAsync } from '@/lib/hooks'
import { api } from '@/lib/api'
import { isConfigured } from '@/lib/supabase'
import { Icon } from '@/components/Icon'
import { DemoTag, LangToggle, Logo } from '@/components/ui'

export default function Landing() {
  const { tr, pick, money } = useI18n()
  const { company } = useCompany()
  const routes = useAsync(() => api.routes(), [])
  const slots = useAsync(() => api.slots(), [])
  useEffect(() => { document.body.classList.remove('phone-body'); document.title = `${pick(company, 'name') || 'Sekka'} — ${tr('إدارة نقل الطلاب الجامعي', 'University student-transport operations')}` }, [company, pick, tr])

  if (!isConfigured()) return <div className="sec"><div className="notice">{tr('لم يتم ضبط ملف البيئة (.env) بعد. راجع README.', 'The .env file is not configured yet. See the README.')}</div></div>

  const feats = [
    { i: 'pin', c: 'i2', t: tr('تتبع مباشر زي أوبر', 'Live tracking, Uber-style'), d: tr('الطالب يشوف الباص على الخريطة، رقم العربية والسواق، وميعاد الوصول لمحطته بالدقيقة.', 'Students see the bus on a map, its plate and driver, and the arrival time at their own stop.') },
    { i: 'msg', c: 'i1', t: tr('مساعد للطلاب', 'Student assistant'), d: tr('يرد على الباص فين، الاشتراك، التجديد وتغيير المحطة. يجاوب من بيانات الشركة بس ومش بيألّف.', "Answers where's my bus, subscription, renewal and stop changes — from your data only, never invented.") },
    { i: 'card', c: 'i3', t: tr('تجديد الاشتراكات تلقائي', 'Automatic renewals'), d: tr('تذكير قبل الانتهاء بـ 14 و7 و1 يوم، متابعة الدفع، وإيصال لكل دفعة.', 'Reminders 14, 7 and 1 days before expiry, payment follow-up and a receipt for each payment.') },
    { i: 'route', c: 'i1', t: tr('توزيع الباصات حسب الطلب', 'Buses planned from demand'), d: tr('يتوقع عدد الراكبين لكل رحلة من حضور الأسابيع اللي فاتت ويوزع الباصات بدون تعارض.', 'Forecasts riders per trip from past attendance and assigns buses with no clashes.') },
    { i: 'wrench', c: 'i4', t: tr('صيانة قبل العطل', 'Maintenance before breakdown'), d: tr('درجة خطورة لكل باص مع أسبابها: الفرامل، الزيت، الكاوتش وعداد الكيلومترات.', 'A risk score per bus with its reasons: brakes, oil, tyres and mileage.') },
    { i: 'shield', c: 'i3', t: tr('بيانات الطلاب محمية', 'Student data protected'), d: tr('صلاحيات لكل دور، رقم الموبايل مخفي عن المشرف، وسجل بكل من فتح ملف طالب.', 'Per-role access, masked phones for dispatchers, and an audit log of who opened a student file.') },
  ]
  return (
    <div>
      <header className="hero">
        <div className="top-bar" style={{ color: '#fff' }}>
          <div className="brand"><Logo /><div><b>{pick(company, 'name') || 'سكّة'}</b><span>{pick(company, 'tagline')}</span></div></div>
          <div className="row gap8"><DemoTag /><LangToggle dark /></div>
        </div>
        <div className="inner">
          <div>
            <h1>{tr('اعرف الباص فين، والشركة تدير كل حاجة لوحدها', 'Know where the bus is. Let the company run itself.')}</h1>
            <p className="lead">{tr('نظام تشغيل لشركات نقل طلاب الجامعات: متابعة الباصات لحظة بلحظة، تجديد الاشتراكات، توزيع الرحلات، وصيانة قبل ما تحصل عطلة.', 'An operations hub for university student-transport companies: live bus tracking, subscription renewals, trip planning and maintenance before breakdowns.')}</p>
            <div className="cta">
              <Link className="btn lg" to="/chat"><Icon name="msg" /> {tr('جرّب مساعد الطلاب', 'Try the student assistant')}</Link>
              <Link className="btn lg ghost" to="/staff/login"><Icon name="chart" /> {tr('لوحة الإدارة', 'Open the dashboard')}</Link>
            </div>
          </div>
          <div className="card" style={{ background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)', color: '#fff', boxShadow: 'none' }}>
            <h2 style={{ color: '#fff' }}>{tr('خطوط الشركة', 'Company lines')}</h2>
            <p className="hint" style={{ color: '#cfc3f0' }}>{tr('الجامعات هنا وجهات للرحلات فقط', 'Universities appear only as destinations')}</p>
            <div className="lines-list">
              {(routes.data ?? []).map((r) => (
                <div key={r.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,.12)' }}>
                  <span>{pick(r, 'name')}</span><b className="num">{money(r.term_price)} {tr('ج.م', 'EGP')}</b>
                </div>
              ))}
            </div>
            <p className="hint" style={{ color: '#cfc3f0', marginTop: 12 }}>{tr('رحلات الذهاب', 'To campus')}: {(slots.data ?? []).filter((x) => x.direction === 'to').map((x) => x.depart_time.slice(0, 5)).join(' · ')} — {tr('العودة', 'Return')}: {(slots.data ?? []).filter((x) => x.direction === 'from').map((x) => x.depart_time.slice(0, 5)).join(' · ')}</p>
          </div>
        </div>
      </header>

      <section className="sec">
        <h2>{tr('كل اللي الشركة محتاجاه في مكان واحد', 'Everything the company needs in one place')}</h2>
        <p className="lead">{tr('مبني على بيانات الشركة نفسها: كل رقم ظاهر له سبب، ومفيش حاجة مخترعة.', "Built on the company's own data: every number has a reason, nothing is invented.")}</p>
        <div className="feat">
          {feats.map((f) => <div className="card" key={f.t}><div className={`ic ${f.c}`}><Icon name={f.i} size={22} /></div><h3>{f.t}</h3><p>{f.d}</p></div>)}
        </div>
      </section>

      <section className="sec" style={{ paddingTop: 0 }}>
        <h2>{tr('جرّب العرض التجريبي', 'Try the demo')}</h2>
        <p className="lead">{tr('كل البيانات وهمية. الساعة في العرض بتبدأ من 7:10 صباحًا عشان تشوف الرحلات شغالة.', 'All data is fictional. The demo clock starts at 07:10 so you see trips already running.')}</p>
        <div className="demo-grid">
          <div className="card demo-card">
            <div><h3>{tr('طالب', 'Student')}</h3><p className="hint">{tr('افتح الشات واكتب رقمك وكودك، أو شوف صفحة التتبع.', 'Open the chat and send the number and code, or see the tracking page.')}</p>
              <p className="small">{tr('الموبايل', 'Phone')}: <code>01100000001</code><br />{tr('الكود', 'Code')}: <code>ST-00001</code></p></div>
            <div className="row gap8 wrap"><Link className="btn sm dark" to="/chat">{tr('افتح الشات', 'Open chat')}</Link></div>
          </div>
          <div className="card demo-card">
            <div><h3>{tr('إدارة الشركة', 'Company staff')}</h3><p className="hint">{tr('ثلاث صلاحيات: مالك، مشرف تشغيل، محاسب — ولكل واحد شاشات مختلفة.', 'Three roles: owner, dispatcher, accountant — each sees different screens.')}</p>
              <p className="small"><code>owner@demo.sekka.test</code><br /><code>dispatch@demo.sekka.test</code><br /><code>accounts@demo.sekka.test</code><br />{tr('كلمة المرور', 'Password')}: <code>demo1234</code></p></div>
            <Link className="btn sm dark" to="/staff/login">{tr('دخول الإدارة', 'Staff sign-in')}</Link>
          </div>
          <div className="card demo-card">
            <div><h3>{tr('السواق', 'Driver')}</h3><p className="hint">{tr('كل رحلة لها رابط خاص للسواق من صفحة "رحلات اليوم": يبدأ الرحلة، يسجّل الوصول، ويمسح كارنيه الطالب.', 'Every trip has a private driver link on the "Trips" page: start, mark arrivals, scan student cards.')}</p></div>
            <span className="chip gray">{tr('من لوحة الإدارة', 'From the dashboard')}</span>
          </div>
        </div>
        <div className="note" style={{ marginTop: 18 }}><Icon name="spark" /><div>{tr('الشات هنا نموذج للمساعد. الربط الفعلي بواتساب يحتاج حساب واتساب للأعمال (WhatsApp Business API) وهو خطوة منفصلة. التتبع الحي الحقيقي يحتاج هاتف السواق يشارك الموقع؛ في العرض الخريطة بتتحرك من تسجيل الوصول للمحطات.', 'The chat here is a front for the assistant. Real WhatsApp delivery needs a WhatsApp Business API account, a separate step. Real live tracking needs the driver’s phone to share its location; in the demo the map moves from stop check-ins.')}</div></div>
      </section>
      <footer className="foot">{pick(company, 'name') || 'Sekka'} · {tr('نسخة تجريبية للعرض فقط — شركة وبيانات خيالية', 'Demo for presentation only — fictional company and data')} · {tr('تصميم وتطوير: أحمد عبد العزيز', 'Designed & built by Ahmed Abdelaziz')}</footer>
    </div>
  )
}
