import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves in main.tsx (via virtual:pwa-register)
      // to add a periodic update check for long-lived installed sessions -
      // leaving this on 'auto' would inject a second, bare registration.
      injectRegister: false,
      // A hand-written service worker (src/sw.ts) instead of the generated
      // default - needed to add push/notificationclick listeners, which the
      // generateSW strategy has no way to hook into.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Masjid Rahma',
        short_name: 'Masjid Rahma',
        description: 'Masjid financial management and dues tracking',
        theme_color: '#aa3bff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // No runtimeCaching for /api/: this is a live financial ledger with
      // per-user authenticated routes (e.g. /api/members/me). Only the
      // precached app shell (JS/CSS/icons) is served from cache — API
      // requests always go straight to the network, uncached.
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  ssr: {
    noExternal: [],
  },
})
