import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // חותמת זמן הבנייה — מוצגת בהגדרות כדי לוודא שהעדכון הגיע למכשיר
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  // בבניית GitHub Pages (משתנה סביבה בזרימת ה-Actions) האתר יושב תחת
  // https://<user>.github.io/barista-journal/ — מקומית נשארים בשורש.
  base: process.env.GITHUB_PAGES ? '/barista-journal/' : '/',
  // פורט קבוע — הנתונים נשמרים לפי הכתובת, אסור שהיא תשתנה בין הפעלות
  preview: { port: 4173, strictPort: true, host: true },
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // כולל את קובצי הפונט במטמון — כדי שהעיצוב יעבוד גם אופליין
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
      manifest: {
        name: 'יומן בריסטה חכם',
        short_name: 'בריסטה',
        description: 'יומן בריסטה אישי עם AI Coach להשגת האספרסו המושלם',
        theme_color: '#2b1d16',
        background_color: '#1d130e',
        display: 'standalone',
        dir: 'rtl',
        lang: 'he',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
