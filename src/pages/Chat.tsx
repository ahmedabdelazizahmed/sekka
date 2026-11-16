import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { api } from '@/lib/api'
import { greeting, newState, reply, type Bot, type Deps, type State } from '@/assistant/engine'
import { Icon } from '@/components/Icon'
import { LangToggle } from '@/components/ui'
import { useCompany } from '@/lib/company'

interface Line { id: number; from: 'u' | 'b'; text?: string; card?: Bot['card']; chips?: string[] }

export default function Chat() {
  const { lang, tr, pick } = useI18n()
  const { company } = useCompany()
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const st = useRef<State>(newState(lang))
  const end = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const cache = useRef<ReturnType<Deps['catalog']> | null>(null)
  const deps = useMemo<Deps>(() => ({
    today: () => new Date().toISOString().slice(0, 10),
    status: api.studentStatus, request: api.studentRequest, track: api.track,
    catalog: () => (cache.current ??= Promise.all([api.company(), api.routes(), api.slots()]).then(([c, r, s]) => ({ company: c, routes: r, slots: s }))),
  }), [])
  useEffect(() => { document.body.classList.add('phone-body'); return () => document.body.classList.remove('phone-body') }, [])
  useEffect(() => { document.title = `${tr('مساعد الطلاب', 'Student assistant')} — ${pick(company, 'name') || 'Sekka'}` }, [company, pick, tr])
  useEffect(() => {
    if (!company || lines.length) return
    const g = greeting({ ...st.current, lang }, company)
    setLines([{ id: ++seq.current, from: 'b', text: g.text, chips: g.chips }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [lines, busy])
  // the tracking link inside a card must go through the router in production, but a normal link keeps the chat simple
  const send = async (raw: string) => {
    const msg = raw.trim(); if (!msg || busy) return
    setText(''); setBusy(true)
    setLines((l) => [...l.map((x) => ({ ...x, chips: undefined })), { id: ++seq.current, from: 'u', text: msg }])
    try {
      const out = await reply(msg, st.current, deps)
      await new Promise((r) => setTimeout(r, 350))
      setLines((l) => [...l, ...out.map((o) => ({ id: ++seq.current, from: 'b' as const, text: o.text, card: o.card, chips: o.chips }))])
    } catch { setLines((l) => [...l, { id: ++seq.current, from: 'b', text: tr('حصلت مشكلة في الاتصال. جرّب تاني بعد شوية.', 'Connection problem. Please try again in a moment.') }]) }
    finally { setBusy(false) }
  }
  return (
    <div className="phone-page">
      <div className="ph-head">
        <Link to="/" aria-label={tr('الرئيسية', 'Home')} className="ghost" style={{ background: 'rgba(255,255,255,.12)', borderRadius: 10, padding: '6px 10px', color: '#fff' }}>{lang === 'ar' ? '→' : '←'}</Link>
        <div className="grow"><b>{tr('مساعد', 'Assistant')} {pick(company, 'name')}</b><span className="s"><i /> {tr('بيجاوب من بيانات الشركة فقط', 'Answers from company data only')}</span></div>
        <LangToggle dark />
      </div>
      <div className="msgs" role="log" aria-live="polite">
        <div className="chat-note">{tr('نموذج للمساعد — الربط بواتساب خطوة منفصلة', 'Assistant preview — WhatsApp delivery is a separate step')}</div>
        {lines.map((m) => (
          <div key={m.id} style={{ display: 'contents' }}>
            <div className={`m ${m.from === 'u' ? 'u' : 'b'}`} dir="auto">
              {m.text}
              {m.card && (
                <div className="tc">
                  <div className="t"><span>{m.card.title}</span></div>
                  {m.card.progress !== undefined && <div className={`bar ${m.card.tone === 'ok' ? 'g' : m.card.tone === 'bad' ? 'r' : ''}`}><i style={{ width: `${Math.min(100, m.card.progress)}%` }} /></div>}
                  {m.card.lines.map((x, i) => <div key={i} className="small muted">{x}</div>)}
                  {m.card.link && <Link className="lnk" to={m.card.link}>{tr('افتح الخريطة والمتابعة ←', 'Open live map →')}</Link>}
                </div>
              )}
            </div>
            {m.chips && <div className="qr">{m.chips.map((c) => <button key={c} onClick={() => send(c)}>{c}</button>)}</div>}
          </div>
        ))}
        {busy && <div className="m b typing" aria-label={tr('جارٍ الكتابة', 'typing')}><i /><i /><i /></div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text) }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('اكتب رسالتك…', 'Type a message…')} aria-label={tr('رسالتك', 'Your message')} autoComplete="off" maxLength={300} />
        <button type="submit" aria-label={tr('إرسال', 'Send')} disabled={busy}><Icon name="send" /></button>
      </form>
    </div>
  )
}
