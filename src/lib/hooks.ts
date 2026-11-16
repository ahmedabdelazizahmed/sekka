import { useCallback, useEffect, useRef, useState } from 'react'

/** Tiny data hook: runs `fn` on mount / when deps change, optionally polls, exposes reload(). */
export function useAsync<R>(fn: () => Promise<R>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<R | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const run = useCallback((quiet = false) => {
    const id = ++seq.current
    if (!quiet) setLoading(true)
    fn().then((d) => { if (id === seq.current) { setData(d); setError(null) } })
      .catch((e) => { if (id === seq.current) setError(e as Error) })
      .finally(() => { if (id === seq.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  useEffect(() => { if (!pollMs) return; const h = setInterval(() => run(true), pollMs); return () => clearInterval(h) }, [pollMs, run])
  return { data, error, loading, reload: () => run(true), setData }
}
