import { createContext, useContext, type ReactNode } from 'react'
import { api } from './api'
import { useAsync } from './hooks'
import type { Company } from './types'

const C = createContext<{ company: Company | null; loading: boolean }>({ company: null, loading: true })
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useAsync(() => api.company(), [])
  return <C.Provider value={{ company: data, loading }}>{children}</C.Provider>
}
export const useCompany = () => useContext(C)
