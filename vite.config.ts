import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// מספר גרסה שנוצר בזמן build — cm{ddmmyy}/HH:MM לפי שעון ישראל
// (Asia/Jerusalem) כדי שלא יושפע מאזור הזמן של מכונת הבנייה.
function buildVersion(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  return `cm${p.day}${p.month}${p.year}/${p.hour}:${p.minute}`
}

export default defineConfig({
  // מספר גרסה אוטומטי בזמן build — מוצג בהגדרות לאימות שהעדכון הגיע למכשיר
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
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
