/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'
import { incrementBadgeCount } from './utils/badge'

declare const self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

interface PushPayload {
  title: string
  body: string
  url?: string
}

self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json() as PushPayload
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: data.url || '/' },
      })
      // Home-screen icon badge count (Android Chrome; not supported by iOS
      // home-screen web apps) - best-effort, never blocks showing the
      // notification itself if unsupported or denied.
      if ('setAppBadge' in navigator) {
        try {
          const count = await incrementBadgeCount()
          await navigator.setAppBadge(count)
        } catch {
          // Badging API unavailable - not critical.
        }
      }
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data?.url as string) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c): c is WindowClient => 'focus' in c)
      if (existing) return existing.focus()
      return self.clients.openWindow(targetUrl)
    })
  )
})
