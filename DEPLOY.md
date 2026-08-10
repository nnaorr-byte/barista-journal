# פרסום עדכון לאייפון (GitHub Pages)

האפליקציה בטלפון מותקנת מ-**GitHub Pages**, לא מהשרת המקומי. אין GitHub
Actions — הפריסה ידנית, שני build נפרדים.

**חי:** https://nnaorr-byte.github.io/barista-journal/
**ריפו:** `nnaorr-byte/barista-journal` (ענף `main`, פריסה לענף `gh-pages`)

---

## התהליך

```bash
npx tsc --noEmit -p tsconfig.app.json
```

```bash
npm run build
```

```bash
git add -A src docs DESIGN.md && git commit -m "..." && git push origin main
```

```bash
GITHUB_PAGES=true npm run build && npx gh-pages -d dist
```

```bash
npm run build
```

```bash
grep -rho 'cm[0-9]\{6\}/[0-9]\{2\}:[0-9]\{2\}' dist/assets/*.js | head -1
```

ואז **באייפון:** לפתוח את האפליקציה, לסגור לגמרי (סגירה מהמתגים), לפתוח שוב.
ה-service worker במצב `autoUpdate` — הגרסה החדשה נתפסת בפתיחה השנייה.
Pages מגיש את החדש תוך ~1–3 דקות מהדחיפה.

---

## למה שני build

| פקודה | base | בשביל |
|---|---|---|
| `npm run build` | `/` | הרצה מקומית (`npm run dev`, `npm run preview`) |
| `GITHUB_PAGES=true npm run build` | `/barista-journal/` | GitHub Pages |

`npx gh-pages -d dist` מפרסם את מה שיש ב-`dist` **באותו רגע**, ולכן חייבים
לבנות עם `GITHUB_PAGES=true` מיד לפניו. ה-build האחרון (בלי המשתנה) מחזיר
את `dist` המקומי, אחרת פתיחה ב-localhost תיתן מסך לבן.

## אימות שהעדכון הגיע

חותמת הגרסה בתחתית מסך ההגדרות: `cm{ddmmyy}/HH:MM` — נחתמת אוטומטית בזמן
ה-build לפי שעון ישראל (`__BUILD_TIME__` ב-vite.config).

## אימות מול GitHub

הדחיפה עוברת דרך Windows Credential Manager. הטוקן הוא fine-grained PAT בשם
`barista-deploy`, מוגבל לריפו הזה בלבד, הרשאת Contents: Read and write, פג
תוקף ~2026-10-24. כשיפוג — ליצור חדש באותן הגדרות ולהחליף מהטרמינל של נאור.
**לעולם לא להדביק טוקן בצ'אט.**

## זהות ה-git בפרויקט

`nnaorr-byte <nnaorr-byte@users.noreply.github.com>` בלבד. הריפו ציבורי,
ואימייל העבודה לא מופיע בו.

## אם משהו נשבר

- **מסך לבן ב-localhost אחרי פרסום** — שכחת את ה-`npm run build` האחרון.
- **הטלפון עדיין על הגרסה הישנה** — סגירה מלאה ופתיחה מחדש; אם עדיין,
  לחכות דקה (Pages) ולנסות שוב.
- **מספרים ישנים במסך שוט חדש** — טיוטה שמורה ב-localStorage. "התחל שוט נקי"
  בבאנר הטיוטה.
