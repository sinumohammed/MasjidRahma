import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './context/SettingsContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'

// Installed/standalone PWA sessions are long-lived and rarely fully closed,
// so they need a periodic check to notice a new deploy - a plain one-time
// registration (the plugin's default) never learns a new SW has activated.
const UPDATE_CHECK_INTERVAL_MS = 45 * 60 * 1000
registerSW({
  onRegisteredSW(swUrl, registration) {
    if (!registration) return
    setInterval(async () => {
      if (registration.installing || !navigator.onLine) return
      const resp = await fetch(swUrl, { cache: 'no-store' })
      if (resp?.status === 200) await registration.update()
    }, UPDATE_CHECK_INTERVAL_MS)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
)
