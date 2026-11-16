import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { isConfigured, supabase } from './supabase'
import type { StaffMember } from './types'

interface Ctx { staff: StaffMember | null; loading: boolean; login: (e: string, p: string) => Promise<void>; logout: () => Promise<void> }
const A = createContext<Ctx>({ staff: null, loading: true, login: async () => {}, logout: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => { try { setStaff(await api.me()) } catch { setStaff(null) } finally { setLoading(false) } }, [])
  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return }
    void refresh()
    const { data } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') setStaff(null) })
    return () => data.subscription.unsubscribe()
  }, [refresh])
  const login = useCallback(async (email: string, password: string) => {
    await api.signIn(email, password)
    const me = await api.me()
    if (!me) { await api.signOut(); throw new Error('not_staff') }   // a signed-in user who is not in `staff` gets nothing
    setStaff(me)
  }, [])
  const logout = useCallback(async () => { await api.signOut(); setStaff(null) }, [])
  return <A.Provider value={{ staff, loading, login, logout }}>{children}</A.Provider>
}
export const useAuth = () => useContext(A)
