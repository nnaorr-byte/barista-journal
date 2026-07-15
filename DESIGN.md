---
name: יומן בריסטה חכם
description: יומן שוטים חכם לאספרסו ביתי — תיעוד, ניתוח והמלצות במעטפת של זכוכית קרמה
colors:
  espresso-night: "#190e06"
  mocha-elevated: "#2a1b10"
  card-roast: "#251710"
  input-bean: "#1e1209"
  crema-ink: "#f6ead8"
  latte-muted: "#c2a582"
  crema-amber: "#e8a960"
  crema-strong: "#ffcf95"
  crema-light: "#ffe3bd"
  terracotta-fab: "#b45830"
  leaf-good: "#93c47f"
  honey-warn: "#e0b45e"
  clay-bad: "#dd8171"
typography:
  display:
    fontFamily: "Heebo, Segoe UI, Arial, sans-serif"
    fontSize: "3.6rem"
    fontWeight: 800
    lineHeight: 1
  headline:
    fontFamily: "Heebo, Segoe UI, Arial, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 800
    letterSpacing: "-0.2px"
  title:
    fontFamily: "Heebo, Segoe UI, Arial, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    letterSpacing: "-0.1px"
  body:
    fontFamily: "Heebo, Segoe UI, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Heebo, Segoe UI, Arial, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
rounded:
  sm: "12px"
  md: "16px"
  fab: "19px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  card: "18px"
components:
  button-primary:
    backgroundColor: "linear-gradient(160deg, rgba(255,190,110,0.30), rgba(255,160,80,0.10))"
    textColor: "#ffe6c2"
    rounded: "15px"
    padding: "13px 24px"
  button-secondary:
    backgroundColor: "rgba(255,227,189,0.05)"
    textColor: "{colors.crema-ink}"
    rounded: "15px"
    padding: "13px 24px"
  chip:
    backgroundColor: "{colors.mocha-elevated}"
    textColor: "{colors.crema-ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  chip-selected:
    backgroundColor: "linear-gradient(160deg, rgba(255,190,110,0.38), rgba(255,150,70,0.2))"
    textColor: "#fff1dd"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.card-roast}"
    rounded: "{rounded.md}"
    padding: "{spacing.card}"
  input:
    backgroundColor: "{colors.input-bean}"
    textColor: "{colors.crema-ink}"
    rounded: "{rounded.sm}"
    padding: "11px 13px"
  nav-fab:
    backgroundColor: "linear-gradient(165deg, #cf7240 0%, #b45830 55%, #98431f 100%)"
    textColor: "#fff6ec"
    rounded: "{rounded.fab}"
    size: "58px"
---

# Design System: יומן בריסטה חכם

## 1. Overview

**Creative North Star: "הקרמה הזכוכית"**

זכוכית ענבר חמה על רקע אספרסו כהה — כמו שכבת הקרמה שמתיישבת על שוט מושלם. כל האלמנטים ה"חיים" של הממשק (כפתורים ראשיים, ניווט, כותרת בגלילה) עשויים זכוכית קפה: גרדיאנט ענברי שקוף-למחצה, גבול מוזהב, טשטוש רקע, וזוהר חם במגע. הרקע הוא לילה של אספרסו (#190e06) שבו פולי קפה בודדים צונחים באיטיות — אווירה, לא רעש. המערכת מדויקת כמו כלי מדידה (מספרים טבולריים, יחסים, טווחי יעד) אבל לעולם לא קרה: החום מגיע מהפלטה, מהקול העברי האנושי, ומרגעי חגיגה שמורים להישגים אמיתיים.

המערכת דוחה במפורש את מה ש-PRODUCT.md אוסר: לא SaaS תאגידי גנרי, לא גיליון אקסל יבש, לא אפליקציית משחק צעקנית, ולא רשת חברתית. זו חוויה אישית, של אדם אחד ומכונת האספרסו שלו.

**Key Characteristics:**
- זכוכית ענבר כשפת המותג — שמורה לאלמנטים אינטראקטיביים ראשיים בלבד
- כהה כברירת מחדל ("לילה של אספרסו"), עם מצב בהיר "לאטה" מלא ושקול
- רכיבים מוחשיים ובטוחים: נוכחות פיזית, פידבק מיידי בלחיצה, זוהר חם במגע
- מספרים הם גיבורים: טבולריים, גדולים, מדויקים
- תנועה שמסבירה מצב (150–320ms, ease-out-quint), לעולם לא קישוט

## 2. Colors

פלטת אספרסו: לילה כהה של קפה קלוי שעליו ענבר קרמה זוהר — Restrained עם accent אחד שעובד קשה.

### Primary
- **ענבר קרמה** (#e8a960): צבע ההדגשה היחיד. גרפים, טבעות פוקוס, גבולות פעילים, מילוי פסי התקדמות. שיאו — **קרמה חזקה** (#ffcf95) לערכים מספריים וכותרות משנה, ו**קרמה בהירה** (#ffe3bd) לכותרות ראשיות.

### Secondary
- **טרקוטה** (גרדיאנט #cf7240→#98431f): שמורה בלעדית לכפתור "שוט חדש" המרכזי (ה-FAB). מופיעה במקום אחד ויחיד במסך.

### Neutral
- **לילה של אספרסו** (#190e06): רקע הגוף. תמיד עם גרדיאנט עדין של אור ענברי בפינות.
- **מוקה מורם** (#2a1b10): משטחים משניים — אריחי סטטיסטיקה, צ'יפים, בלוקים פנימיים.
- **קלייה** (#251710): רקע כרטיסים (בפועל דרך גרדיאנט card עדין).
- **דיו קרמה** (#f6ead8): טקסט ראשי. **לאטה עמום** (#c2a582): טקסט משני — תמיד ≥4.5:1 על כל הרקעים.

### Semantic
- **עלה** (#93c47f) הצלחה/בטווח · **דבש** (#e0b45e) אזהרה · **חרס** (#dd8171) בעיה. בשלושתם: טקסט/גבול, לא מילוי מסך.

### Named Rules
**חוק הזכוכית.** אפקט הזכוכית (גרדיאנט ענברי + blur + גבול מוזהב) מותר אך ורק על: כפתורים ראשיים, צ'יפים נבחרים, מרכז הטיימר, הניווט התחתון, והכותרת בגלילה. זכוכית על תוכן סטטי — אסורה.

**חוק הטרקוטה האחת.** הטרקוטה מופיעה רק על ה-FAB. אלמנט שני בטרקוטה שובר את ההיררכיה של הפעולה הראשית.

## 3. Typography

**Display/Body Font:** Heebo (עם Segoe UI, Arial כגיבוי) — מתארח מקומית ב-woff2 עם unicode-range נפרד לעברית וללטינית.

**Character:** משפחה אחת במשקלים 400–800. עברית ראשונה, RTL מלא; לטינית רק למונחי בריסטה בינלאומיים (Bottomless, Yield) ותמיד עם עברית לצידה.

### Hierarchy
- **Display** (800, 3.6rem / בתוך הטבעת 2.5rem, tabular-nums): ספרות הטיימר בלבד. `direction: ltr`.
- **Headline** (800, 1.3rem, -0.2px): כותרת האפליקציה, בצבע קרמה בהירה.
- **Title** (700, 1.05rem, -0.1px): כותרות כרטיסים (h2) — תמיד אייקון SVG 18px + טקסט, עם קו hairline מתחת.
- **Body** (400, 1rem, 1.55): טקסט רץ.
- **Label** (600, 0.82rem): תוויות שדות וטקסט משני, בלאטה עמום. רצפת גודל: 0.72rem — קטן מזה אסור.

### Named Rules
**חוק המספר הטבולרי.** כל ערך מספרי (דירוג, גרמים, שניות, אחוזים) מקבל `font-variant-numeric: tabular-nums`. מספרים שקופצים ברוחב בזמן ספירה/טיימר — באג.

## 4. Elevation

היברידי, בסדר הזה: (1) שכבות טונאליות — משטח בהיר יותר = קרוב יותר (לילה → קלייה → מוקה); (2) קו "קרמה" — border-top בהיר עדין על כרטיסים, כמו אור שנשבר בקצה; (3) צל רך אחד; (4) זוהר ענברי — שמור למצבי hover/בחירה/הישג בלבד.

### Shadow Vocabulary
- **צל כרטיס** (`0 1px 2px rgba(0,0,0,0.4), 0 6px 18px rgba(0,0,0,0.28)`): כרטיסים וטוסטים. היחיד במנוחה.
- **זוהר חם** (`0 0 16px–30px rgba(255,178,96,0.35)`): hover על זכוכית, צ'יפ נבחר, כרטיס-גיבור, שיא אישי.
- **טבעת חיתוך FAB** (`0 0 0 6px var(--bg-elevated)` + צל + זוהר): ה-FAB בלבד.

### Named Rules
**חוק הזוהר שהרווחת.** זוהר ענברי מופיע רק כתגובה — למגע, לבחירה או להישג. זוהר במנוחה מותר רק על כרטיס-הגיבור של מסך הבית.

## 5. Components

תחושה: **מוחשיים ובטוחים** — לכל רכיב נוכחות פיזית, פידבק מיידי (scale בלחיצה), וזוהר חם במגע.

### Buttons
- **Shape:** מעוגל-נדיב (15px; קטנים — גלולה 999px)
- **Primary:** זכוכית ענברית — גרדיאנט שקוף-למחצה, טקסט #ffe6c2, גבול מוזהב, inset highlight עליון. Hover: הגרדיאנט מתחזק + זוהר חם. Active: scale(0.97).
- **Secondary:** שקוף כמעט לגמרי (5% קרמה), גבול חצי-שקוף.
- **Danger:** גרדיאנט אדמדם שקוף עם טקסט #ffd9cf. פעולות הרסניות עוברות דרך ConfirmButton דו-שלבי — לעולם לא confirm() נטיבי.
- **Focus:** `outline: 3px` ענברי חצי-שקוף, offset 2px — אחיד לכל הכפתורים.

### Chips
- **Style:** גלולות (999px) על מוקה מורם, min-height 44px.
- **State:** נבחר = מילוי זכוכית ענברית + זוהר + משקל 700 + `aria-pressed`. בחירת דירוג = `role="radiogroup"`.

### Cards / Containers
- **Corner Style:** 16px · **Background:** גרדיאנט קלייה עדין · **Border:** border-soft עם border-top בהיר יותר (קו הקרמה) · **Padding:** 18px · כרטיס `hero` (אחד למסך, לכל היותר): גבול ענברי + זוהר במנוחה + כותרת מוגדלת.

### Inputs / Fields
- **Style:** רקע כהה שקוע (#1e1209), גבול רך, 12px radius. תווית מעל השדה (0.82rem, לאטה עמום).
- **Focus:** גבול ענברי + הילת box-shadow רכה (22% ענבר). בלי outline.

### Navigation
- זכוכית קפה קבועה בתחתית: רקע 88% מוקה + blur(14px), safe-area. פריט פעיל: קרמה חזקה + `aria-current="page"`. במרכז — ה-FAB הטרקוטה, מורם 24px מעל הסרגל.

### Signature: טבעת הטיימר
SVG עגול עם מסילה, קשת "חלון יעד" ירוקה שקופה, וקשת התקדמות שצבעה חי (ענבר → ירוק בחלון → אדום מעבר לו). בתוך החלון הטבעת זוהרת בפעימה; עצירה בתוכו — פעימת "בול" חד-פעמית. במרכז: כפתור זכוכית עם הספרות.

## 6. Do's and Don'ts

### Do:
- **Do** השתמש בטוקנים בלבד — גם ב-inline styles (`var(--good)`, לא hex).
- **Do** שמור על קונטרסט ≥4.5:1 בשני המצבים; מצב בהיר מקבל ערכי צבע משלו, לא שקיפות של הכהה.
- **Do** לווה כל שינוי מצב בתנועת ease-out-quint של 150–320ms, וכבה הכל תחת `prefers-reduced-motion`.
- **Do** תן לכל רכיב אינטראקטיבי ≥44×44px ו-scale קטן בלחיצה (0.9–0.97).
- **Do** אייקוני קו SVG (currentColor, stroke ~1.7) בכל ה-chrome; אימוג'י מותר רק בקול ה-AI.

### Don't:
- **Don't** "SaaS תאגידי גנרי" — אסור דשבורד קר וחסר אופי; כל מסך נושא את חום הקפה.
- **Don't** "גיליון אקסל יבש" — אסור טבלת נתונים בלי פרשנות; כל מספר מקבל הקשר או המלצה.
- **Don't** "אפליקציית משחק צעקנית" — אסור קונפטי על כל פעולה; חגיגה רק בדירוג 9+, שיא או אבן דרך.
- **Don't** "רשת חברתית" — אסור פידים, השוואות והתראות מציקות.
- **Don't** easing קפיצי/אלסטי, אנימציית width/height (רק transform/grid-rows), או זכוכית על תוכן סטטי.
- **Don't** אימוג'י מערכת ב-chrome, פס צבע צדדי (border-left) על כרטיסים, או gradient-text.
