import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './context/SettingsContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'

// Installed/standalone PWA sessions are long-lived and rarely fully closed,
// so they need to actively check for a new deploy - browsers only re-check
// a service worker's script on their own schedule (at most ~once/24h on
// navigation), which is far too slow right after a fresh deploy. We force a
// check immediately on load, whenever the app/tab returns to the foreground,
// and periodically as a fallback for sessions left open in the background.
const UPDATE_CHECK_INTERVAL_MS = 45 * 60 * 1000
registerSW({
  onRegisteredSW(swUrl, registration) {
    if (!registration) return

    const checkForUpdate = async () => {
      if (registration.installing || !navigator.onLine) return
      try {
        const resp = await fetch(swUrl, { cache: 'no-store' })
        if (resp?.status === 200) await registration.update()
      } catch {
        // Offline or transient network error - next check will retry.
      }
    }

    checkForUpdate()
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.addEventListener('focus', checkForUpdate)
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
