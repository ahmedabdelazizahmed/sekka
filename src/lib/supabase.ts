import { createClient } from '@supabase/supabase-js'
import { DEMO_WEB, demoFetch } from '@/demo/boot'

const url = DEMO_WEB ? 'https://demo.sekka.local' : (import.meta.env.VITE_SUPABASE_URL as string | undefined)
const key = DEMO_WEB ? 'demo-anon-key' : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)

/** False when .env is missing: the UI then shows a clear setup message instead of failing silently. */
export const isConfigured = () => Boolean(url && key)

// Only the public anon key is used in the browser. Security comes from Row Level Security and the
// SECURITY DEFINER functions in supabase/migrations — never from hiding the key.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'public-anon-key-not-configured', {
  auth: { persistSession: isConfigured(), autoRefreshToken: isConfigured(), detectSessionInUrl: false, storageKey: 'sekka-auth' },
  ...(DEMO_WEB ? { global: { fetch: demoFetch } } : {}),
})
