import type { AiAdvice, AiTargets, Grinder, Shot, TasteTag } from '../domain/types';
import { auditAdviceHistory } from './adviceAudit';

// ============================================================
// מוח ה-AI — מנוע ההמלצות לשוט הבא
// מימוש מלא של "מנוע AI לכיוון אספרסו" (docs/Espresso_AI_Engine_Guide.md):
//   עקרונות: שינוי משתנה אחד בלבד · סדר עדיפות טחינה→Yield→Dose ·
//   הטעם הוא המדד העליון, זמן החליטה כלי אבחון · עדיפות למתכון מוצלח.
// רץ כולו במכשיר — אפס שירותים חיצוניים, אפס עלות.
// הטיפוסים AiAdvice/AiTargets מוגדרים ב-domain/types.ts (נשמרים עם כל שוט).
// ============================================================

export type { AiAdvice, AiTargets };

const REMINDER =
  'שנה אך ורק את הפרמטר הזה. טחינה, Yield ו-Dose לעולם לא משתנים יחד — כך יודעים בוודאות מה השפיע.';

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- סיווג טעם (לפי קטגוריות המדריך) ----
type TasteClass =
  | { kind: 'positive' } // מתוק / מאוזן
  | { kind: 'negative'; taste: 'sour' | 'bitter' | 'dry' | 'watery' }
  | { kind: 'conflict' } // חמוץ + מר יחד — חשד לתיעול
  | { kind: 'neutral' }; // לא תויג טעם רלוונטי

const NEG_ORDER = ['sour', 'bitter', 'dry', 'watery'] as const;
const TASTE_HE: Record<string, string> = {
  sour: 'חמוץ', bitter: 'מר', dry: 'יבש', watery: 'מימי', sweet: 'מתוק', balanced: 'מאוזן',
};

function classifyTaste(shot: Shot): TasteClass {
  const tags = new Set<TasteTag>(shot.tasteTags);
  if (tags.has('sour') && tags.has('bitter')) return { kind: 'conflict' };
  const neg = NEG_ORDER.find((t) => tags.has(t));
  if (neg) return { kind: 'negative', taste: neg };
  if (tags.has('sweet') || tags.has('balanced')) return { kind: 'positive' };
  return { kind: 'neutral' };
}

function tasteText(shot: Shot): string {
  const parts = shot.tasteTags.map((t) => TASTE_HE[t] ?? t).filter(Boolean);
  return parts.length ? parts.join(', ') : 'לא תויג';
}

// ---- בדיקות היסטוריה: "אם כבר הוגדל/הוקטן ועדיין..." ----
function prevSameBeanShot(history: Shot[], last: Shot): Shot | null {
  const idx = history.findIndex((s) => s.id === last.id);
  return idx > 0 ? history[idx - 1] : null;
}

function alreadyAdjustedYield(
  prev: Shot | null, last: Shot, direction: 'up' | 'down', taste: string,
): boolean {
  if (!prev) return false;
  const delta = last.yieldGrams - prev.yieldGrams;
  const adjusted = direction === 'up' ? delta >= 1.5 : delta <= -1.5;
  return adjusted && prev.tasteTags.includes(taste as TasteTag);
}

// ---- מתכון מוצלח: favorite או השוט הטוב ביותר (8+ עם טעם חיובי) ----
function findRecipe(history: Shot[], last: Shot): Shot | null {
  const fav = [...history].reverse().find((s) => s.favorite && s.id !== last.id);
  if (fav) return fav;
  const good = history.filter(
    (s) => s.id !== last.id && s.rating >= 8 &&
      (s.tasteTags.includes('balanced') || s.tasteTags.includes('sweet')),
  );
  return good.sort((a, b) => b.rating - a.rating)[0] ?? null;
}

function deviatesFromRecipe(last: Shot, recipe: Shot, grindStep: number): boolean {
  return (
    Math.abs(last.grindSetting - recipe.grindSetting) >= grindStep ||
    Math.abs(last.yieldGrams - recipe.yieldGrams) > 2 ||
    Math.abs(last.doseGrams - recipe.doseGrams) > 0.4
  );
}

// ---- Confidence Score לפי המדריך ----
function computeConfidence(
  history: Shot[], targets: AiTargets, recipe: Shot | null, grindStep: number,
): { pct: number; reasons: string[] } {
  const reasons: string[] = [];

  // 1. מספר שוטים (עד 40 נק')
  const countPts = Math.min(40, history.length * 4);
  reasons.push(`${history.length} שוטים בהיסטוריית הפולים`);

  // 2. עקביות התוצאות (עד 20 נק') — פיזור זמני החליטה בשוטים המוצלחים
  const good = history.filter((s) => s.rating >= 7 && s.brewTimeSec > 0);
  let consistencyPts = 0;
  if (good.length >= 3) {
    const times = good.map((s) => s.brewTimeSec);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const std = Math.sqrt(times.reduce((a, t) => a + (t - mean) ** 2, 0) / times.length);
    consistencyPts = Math.max(0, Math.min(20, Math.round(20 - std * 4)));
    if (consistencyPts >= 12) reasons.push('השוטים המוצלחים שלך עקביים');
  }

  // 3. דמיון לשוטים מוצלחים (עד 20 נק')
  let similarityPts = 5;
  if (recipe) {
    const close =
      Math.abs(targets.grindSetting - recipe.grindSetting) <= grindStep &&
      Math.abs(targets.yieldGrams - recipe.yieldGrams) <= 2;
    similarityPts = close ? 20 : 8;
    if (close) reasons.push('ההמלצה קרובה למתכון שכבר הצליח לך');
  }

  // 4. הצלחת המלצות קודמות (עד 20 נק') — האם שינויים בעבר שיפרו את הדירוג
  let successPts = 10;
  const pairs: { improved: boolean }[] = [];
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    const changed =
      Math.abs(b.grindSetting - a.grindSetting) > 0.01 ||
      Math.abs(b.yieldGrams - a.yieldGrams) >= 1.5 ||
      Math.abs(b.doseGrams - a.doseGrams) >= 0.4;
    if (changed) pairs.push({ improved: b.rating > a.rating });
  }
  if (pairs.length >= 2) {
    const rate = pairs.filter((p) => p.improved).length / pairs.length;
    successPts = Math.round(rate * 20);
    if (rate >= 0.6) reasons.push('רוב השינויים בעבר אכן שיפרו את התוצאה');
  }

  const pct = Math.max(5, Math.min(95, countPts + consistencyPts + similarityPts + successPts));
  return { pct, reasons };
}

// ============================================================
// המנוע הראשי
// ============================================================
export function aiRecommend(params: {
  lastShot: Shot;
  beanShots: Shot[]; // היסטוריית הפולים על המטחנה הנוכחית בלבד, מהישן לחדש (כולל האחרון)
  grinder?: Grinder;
  grinderChanged?: boolean; // המטחנה שונה מזו של השוט הקודם של הפולים
  agingGapDays?: number | null; // ימים שעברו מאז השוט הקודם על הפולים האלה
  roastAgeDays?: number | null; // גיל הקלייה בימים בזמן השוט המתוכנן
}): AiAdvice {
  const { lastShot: last, beanShots, grinder, grinderChanged } = params;
  const history = beanShots;
  const grindStep = grinder?.scaleStep || 1;
  const prev = prevSameBeanShot(history, last);
  const t = last.brewTimeSec;
  const cls = classifyTaste(last);
  const warnings: string[] = [];

  const lastShotSummary =
    `${last.doseGrams}←${last.yieldGrams} גרם · ${t} שניות · טחינה ${last.grindSetting}` +
    ` · טעם: ${tasteText(last)} · דירוג ${last.rating}/10`;

  // ברירת מחדל: לשמור על אותם פרמטרים
  const targets: AiTargets = {
    doseGrams: last.doseGrams,
    yieldGrams: last.yieldGrams,
    grindSetting: last.grindSetting,
  };

  // ---- הפרדת מטחנות: החלפת מטחנה = ניתוח מתחיל מחדש ----
  if (grinderChanged) {
    warnings.push(
      `המטחנה השתנתה${grinder ? ` ל"${grinder.name}"` : ''} — הניתוח מתבסס רק על שוטים מהמטחנה הנוכחית. דרגות טחינה מהמטחנה הקודמת אינן ברות-השוואה.`,
    );
  }

  // ---- הזדקנות בין שוטים: פער ימים = פולים שאיבדו גזים בינתיים ----
  // רלוונטי רק אחרי שלב ה-Degassing (גיל 10+), כשהקצב של איבוד הגזים מורגש.
  const gap = params.agingGapDays ?? null;
  if (gap !== null && gap >= 5 && (params.roastAgeDays == null || params.roastAgeDays > 10)) {
    warnings.push(
      `עברו ${gap} ימים מהשוט הקודם על הפולים האלה${params.roastAgeDays != null ? ` (גיל קלייה: ${params.roastAgeDays} ימים)` : ''} — ` +
      'הפולים איבדו גזים בינתיים והזרימה עשויה להיות מהירה מהצפוי. ' +
      'אם השוט ירוץ מהר — זה כנראה הגיל ולא הטכניקה; ייתכן שתידרש טחינה עדינה בדרגה.',
    );
  }

  // ---- כלל זהב: זמן קיצוני ----
  if (t > 0 && (t < 15 || t > 45)) {
    warnings.push(
      `זמן חליטה קיצוני (${t} שניות) — המתכון עשוי להיות לא יציב.` +
      (cls.kind === 'positive' ? ' אבל הטעם מצוין, ולפי הכללים — לא משנים אוטומטית.' : ''),
    );
  }

  let diagnosis = '';
  let changeKind: AiAdvice['changeKind'] = 'none';
  let changeLabel = 'ללא שינוי';
  let instruction = '';
  let expectedResult = '';
  let tone: AiAdvice['tone'] = 'info';
  let recipeNote: string | null = null;

  // תמיד ביחס לדרגה האחרונה שהוזנה על המטחנה הזו, ובגבולות הסקאלה שלה
  const clampGrind = (v: number): number => {
    if (!grinder) return round1(v);
    return round1(Math.min(grinder.scaleMax, Math.max(grinder.scaleMin, v)));
  };
  const grindFiner = () => {
    targets.grindSetting = clampGrind(last.grindSetting - grindStep);
    changeKind = 'grind';
    changeLabel = 'דרגת טחינה — דק יותר';
    if (targets.grindSetting === last.grindSetting) {
      instruction = `הטחינה כבר בקצה הדק של הסקאלה (${last.grindSetting}${grinder ? `, ${grinder.name}` : ''}) — אי אפשר לרדת עוד. אם הבעיה נמשכת, בדוק את הגדרות הסקאלה של המטחנה.`;
    } else {
      instruction = `טחן דק יותר: עבור מדרגה ${last.grindSetting} לדרגה ${targets.grindSetting}${grinder ? ` (${grinder.name})` : ''}. מנה ו-Yield נשארים זהים.`;
    }
  };
  const grindCoarser = () => {
    targets.grindSetting = clampGrind(last.grindSetting + grindStep);
    changeKind = 'grind';
    changeLabel = 'דרגת טחינה — גס יותר';
    if (targets.grindSetting === last.grindSetting) {
      instruction = `הטחינה כבר בקצה הגס של הסקאלה (${last.grindSetting}${grinder ? `, ${grinder.name}` : ''}) — אי אפשר לעלות עוד. אם הבעיה נמשכת, בדוק את הגדרות הסקאלה של המטחנה.`;
    } else {
      instruction = `טחן גס יותר: עבור מדרגה ${last.grindSetting} לדרגה ${targets.grindSetting}${grinder ? ` (${grinder.name})` : ''}. מנה ו-Yield נשארים זהים.`;
    }
  };
  const yieldUp = () => {
    targets.yieldGrams = round1(last.yieldGrams + 3);
    changeKind = 'yield';
    changeLabel = 'Yield — הגדלה';
    instruction = `הגדל את ה-Yield ב-2–4 גרם: כוון ליעד סופי של ${targets.yieldGrams} גרם בכוס (במקום ${last.yieldGrams}). טחינה ומנה נשארות זהות.`;
  };
  const yieldDown = () => {
    targets.yieldGrams = round1(Math.max(last.doseGrams, last.yieldGrams - 3));
    changeKind = 'yield';
    changeLabel = 'Yield — הקטנה';
    instruction = `הקטן את ה-Yield ב-2–4 גרם: כוון ליעד סופי של ${targets.yieldGrams} גרם בכוס (במקום ${last.yieldGrams}). טחינה ומנה נשארות זהות.`;
  };

  // ---- עדיפות למתכון מוצלח (עיקרון 4) ----
  const recipe = findRecipe(history, last);
  if (recipe && last.rating <= recipe.rating - 2 && deviatesFromRecipe(last, recipe, grindStep)) {
    targets.doseGrams = recipe.doseGrams;
    targets.yieldGrams = recipe.yieldGrams;
    targets.grindSetting = recipe.grindSetting;
    changeKind = 'recipe';
    changeLabel = 'חזרה למתכון המוצלח';
    diagnosis = `השוט (${last.rating}/10) התרחק מהמתכון שכבר הוכיח את עצמו אצלך (${recipe.rating}/10). לפי הכללים — מתכון מוצלח מקבל עדיפות על ניסויים.`;
    instruction = `חזור למתכון: ${recipe.doseGrams} גרם ← ${recipe.yieldGrams} גרם, טחינה ${recipe.grindSetting}${grinder ? ` (${grinder.name})` : ''}, ${recipe.brewTimeSec} שניות.`;
    expectedResult = `שחזור התוצאה של ${recipe.rating}/10 מ-${new Date(recipe.createdAt).toLocaleDateString('he-IL')}.`;
    tone = 'info';
    recipeNote = '⭐ קיים מתכון מוצלח לפולים האלה — ההמלצה החזקה ביותר היא לחזור אליו לפני ניסויים חדשים.';
  }
  // ---- חשד לתיעול: חמוץ + מר יחד ----
  else if (cls.kind === 'conflict') {
    changeKind = 'prep';
    changeLabel = 'הכנת הפאק (לא הגדרות!)';
    diagnosis = 'חמוץ ומר בו-זמנית — סתירה שמעידה כמעט תמיד על תיעול (Channeling): חלק מהפאק חולץ יתר וחלק בחסר. שינוי הגדרות עכשיו רק יוסיף רעש.';
    instruction = 'חזור על אותם פרמטרים בדיוק, עם הכנת פאק מוקפדת: פיזור יסודי במחט (WDT), פילוס, טמפינג ישר ו-Puck Screen מונח היטב.';
    expectedResult = 'זרימה אחידה מה-Bottomless וטעם עקבי — ואז אפשר לכייל באמת.';
    tone = 'warn';
  }
  // ---- שלב 1: זמן חליטה קצר ----
  else if (t > 0 && t < 20) {
    if (cls.kind === 'negative') {
      diagnosis = `זמן חליטה קצר (${t} שניות) יחד עם טעם ${TASTE_HE[cls.taste]} — המים עברו מהר מדי דרך הפאק. הטחינה גסה מדי.`;
      grindFiner();
      expectedResult = 'זמן החליטה יתארך לכיוון חלון היעד, החילוץ יעמיק והטעם יתאזן.';
      tone = 'warn';
    } else if (cls.kind === 'positive') {
      diagnosis = `השוט מוצלח (${tasteText(last)}) למרות זמן קצר מהמקובל (${t} שניות). לפי הכללים — הטעם הוא המדד החשוב ביותר, וזמן הוא רק כלי אבחון.`;
      instruction = 'אל תשנה דבר. חזור על המתכון בדיוק.';
      expectedResult = 'שחזור של אותה תוצאה טובה.';
      tone = 'good';
    } else {
      diagnosis = `זמן קצר (${t} שניות) אך הטעם לא תויג — קשה לאבחן.`;
      instruction = 'חזור על אותם פרמטרים, והפעם תייג את הטעם (או השתמש באימון הטעימה המודרך).';
      expectedResult = 'אבחון מדויק בשוט הבא.';
      tone = 'info';
    }
  }
  // ---- שלב 1: זמן חליטה ארוך ----
  else if (t > 35) {
    if (cls.kind === 'negative') {
      diagnosis = `זמן חליטה ארוך (${t} שניות) יחד עם טעם ${TASTE_HE[cls.taste]} — המים שהו יותר מדי בפאק. הטחינה דקה מדי.`;
      grindCoarser();
      expectedResult = 'זמן החליטה יתקצר לכיוון חלון היעד והטעם יתנקה.';
      tone = 'warn';
    } else if (cls.kind === 'positive') {
      diagnosis = `השוט מוצלח (${tasteText(last)}) למרות זמן ארוך מהמקובל (${t} שניות). הטעם מנצח — לא נוגעים.`;
      instruction = 'אל תשנה דבר. חזור על המתכון בדיוק.';
      expectedResult = 'שחזור של אותה תוצאה טובה.';
      tone = 'good';
    } else {
      diagnosis = `זמן ארוך (${t} שניות) אך הטעם לא תויג — קשה לאבחן.`;
      instruction = 'חזור על אותם פרמטרים ותייג את הטעם בשוט הבא.';
      expectedResult = 'אבחון מדויק בשוט הבא.';
      tone = 'info';
    }
  }
  // ---- שלב 2: ניתוח הטעם (זמן בטווח) ----
  else {
    switch (cls.kind) {
      case 'positive':
        diagnosis = `שוט ${tasteText(last)} בזמן תקין (${t} שניות) — זה בדיוק המקום שרצינו להגיע אליו.`;
        instruction = 'אין לבצע שום שינוי. שמור את כל הפרמטרים — ואם עוד לא, סמן את השוט כמתכון ⭐.';
        expectedResult = 'עקביות. אותו שוט טוב, כל בוקר.';
        tone = 'good';
        break;
      case 'negative':
        switch (cls.taste) {
          case 'sour':
            if (alreadyAdjustedYield(prev, last, 'up', 'sour')) {
              diagnosis = `עדיין חמוץ למרות שה-Yield כבר הוגדל בשוט הקודם — הגדלת Yield מוצתה. עוברים לטחינה.`;
              grindFiner();
              expectedResult = 'חילוץ עמוק יותר שימיס את החמיצות במתיקות.';
            } else {
              diagnosis = `חמיצות בזמן תקין (${t} שניות) — החילוץ נעצר מוקדם מדי בשלב החומצי. לפי הסדר: קודם Yield, לא טחינה.`;
              yieldUp();
              expectedResult = 'המים הנוספים ימשכו את המתיקות שמאזנת את החמיצות.';
            }
            tone = 'warn';
            break;
          case 'bitter':
            if (alreadyAdjustedYield(prev, last, 'down', 'bitter')) {
              diagnosis = `עדיין מר למרות שה-Yield כבר הוקטן — הקטנת Yield מוצתה. עוברים לטחינה.`;
              grindCoarser();
              expectedResult = 'חילוץ מתון יותר שיעצור לפני התרכובות המרות.';
            } else {
              diagnosis = `מרירות בזמן תקין (${t} שניות) — החילוץ נמשך אל השלב המר. לפי הסדר: קודם Yield.`;
              yieldDown();
              expectedResult = 'עצירה מוקדמת שתשאיר את המרירות מחוץ לכוס.';
            }
            tone = 'warn';
            break;
          case 'dry':
            if (alreadyAdjustedYield(prev, last, 'up', 'dry')) {
              diagnosis = `עדיין יבש למרות הגדלת ה-Yield — עוברים לטחינה גסה יותר להפחתת העפיצות.`;
              grindCoarser();
              expectedResult = 'פחות טאנינים בכוס — סיום נקי יותר.';
            } else {
              diagnosis = `יובש/עפיצות בזמן תקין — סימן לחילוץ יתר נקודתי. מתחילים בהגדלת Yield.`;
              yieldUp();
              expectedResult = 'דילול העפיצות והחזרת הרכות למשקה.';
            }
            tone = 'warn';
            break;
          case 'watery':
            if (alreadyAdjustedYield(prev, last, 'down', 'watery')) {
              diagnosis = `עדיין מימי למרות הקטנת ה-Yield — לפי המדריך, השלב הבא: הגדלת המנה.`;
              targets.doseGrams = round1(last.doseGrams + 0.5);
              changeKind = 'dose';
              changeLabel = 'Dose — הגדלה';
              instruction = `הגדל את המנה ב-0.5 גרם בלבד: ${targets.doseGrams} גרם במקום ${last.doseGrams}. טחינה ו-Yield נשארים זהים.`;
              expectedResult = 'יותר קפה בפאק = גוף מלא וריכוז גבוה יותר.';
            } else {
              diagnosis = `טעם מימי — המשקה דליל. מתחילים בהקטנת Yield לריכוז המשקה.`;
              yieldDown();
              expectedResult = 'משקה מרוכז יותר עם גוף מורגש.';
            }
            tone = 'warn';
            break;
        }
        break;
      case 'neutral':
        diagnosis = `הטעם לא תויג ולכן אין אבחנה. הדירוג (${last.rating}/10) לבדו לא מספיק להחלטה אחראית.`;
        instruction = 'חזור על אותם פרמטרים, והפעם תייג את הטעם — או הפעל את אימון הטעימה המודרך.';
        expectedResult = 'אבחון אמין בשוט הבא.';
        tone = 'info';
        break;
    }
  }

  // ---- נקודת עצירה: יעד סופי ⟵ איפה לעצור בפועל ----
  // לפי הטפטוף הנמדד של המשתמש (אם תועדו עצירה+סופי), אחרת ברירת מחדל 3–4 גרם.
  if (changeKind !== 'prep') {
    const measuredDrips = history
      .filter((s) => s.yieldStopGrams && s.yieldGrams > (s.yieldStopGrams ?? 0))
      .map((s) => s.yieldGrams - (s.yieldStopGrams ?? 0));
    const measured = measuredDrips.length >= 2;
    const drip = measured
      ? round1(measuredDrips.reduce((a, b) => a + b, 0) / measuredDrips.length)
      : 3.5;
    const stopAt = round1(Math.max(targets.doseGrams, targets.yieldGrams - drip));
    instruction += ` עצור בפועל סביב ${stopAt} גרם — הטפטוף (${measured ? `~${drip} גרם בממוצע אצלך` : 'משוער 3–4 גרם'}) ישלים ליעד הסופי של ${targets.yieldGrams} גרם.`;
  }

  // ---- מודעות עצמית: המלצה דומה שיושמה בעבר ולא שיפרה ----
  // ההיסטוריה נושאת את ההמלצות שנשמרו עם כל שוט — המוח בודק את הרקורד של עצמו.
  // (cast: TS לא עוקב אחרי השמות שקורות בתוך ה-closures של grindFiner וכו')
  const finalKind = changeKind as AiAdvice['changeKind'];
  if (finalKind === 'grind' || finalKind === 'yield' || finalKind === 'dose') {
    const sameKindFollowed = auditAdviceHistory(history)
      .filter((o) => o.changeKind === finalKind && o.followed);
    if (sameKindFollowed.length > 0 && sameKindFollowed.every((o) => !o.improved)) {
      warnings.push(
        `שקיפות מלאה: המלצת "${changeLabel}" כבר יושמה ${sameKindFollowed.length === 1 ? 'פעם אחת' : `${sameKindFollowed.length} פעמים`} בעבר על הפולים האלה ולא העלתה את הדירוג. ` +
        'מנסים שוב כי זו האבחנה לפי הטעם — אבל אם גם הפעם לא יהיה שיפור, נפנה למשתנה אחר.',
      );
    }
  }

  const { pct, reasons } = computeConfidence(history, targets, recipe, grindStep);

  return {
    tone,
    lastShotSummary,
    diagnosis,
    changeKind,
    changeLabel,
    instruction,
    targets,
    expectedResult,
    confidencePct: pct,
    confidenceReasons: reasons,
    warnings,
    recipeNote,
    reminder: REMINDER,
  };
}
