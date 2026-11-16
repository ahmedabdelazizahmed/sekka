import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/readex-pro/400.css'
import '@fontsource/readex-pro/500.css'
import '@fontsource/readex-pro/600.css'
import '@fontsource/readex-pro/700.css'
import App from './App'
import { I18nProvider } from './i18n'
import { CompanyProvider } from './lib/company'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './components/ui'
import { DemoBar, DemoBoot } from './demo/DemoUI'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider><DemoBoot><CompanyProvider><AuthProvider><ToastProvider><App /><DemoBar /></ToastProvider></AuthProvider></CompanyProvider></DemoBoot></I18nProvider>
    </BrowserRouter>
  </StrictMode>
)
