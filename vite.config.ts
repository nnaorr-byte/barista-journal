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
      includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        // כולל את קובצי הפונט והאייקונים במטמון — כדי שהעיצוב יעבוד גם אופליין
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // אייקוני ה-512 נקראים רק ברגע ההתקנה, על ידי מערכת ההפעלה, מהרשת.
        // הכללתם במטמון המקדים הוסיפה 239KB להורדה של כל משתמש בלי תועלת.
        globIgnores: ['**/icon-512.png', '**/icon-maskable-512.png'],
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
        // maskable נפרד: אנדרואיד חותך עד ~80% מהשטח לפי צורת המסך, ולכן
        // באותו קובץ האיור מוקטן ל-80% על רקע כהה. 'any' נשאר במסגרת מלאה.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
