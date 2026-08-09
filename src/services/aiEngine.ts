import type {
  AiAdvice, AiTargets, DialInSession, DialInState, Grinder, MachineTempSetting, Shot, TasteTag,
} from '../domain/types';
import { auditAdviceHistory } from './adviceAudit';
import { PREP_NOISE_SEC, type Repeatability } from './aging';
import { dialInDecide } from './dialInEngine';
import { analyzable, chokeFloor, fineLimit } from './shotFilter';
import { DEFAULT_TARGET_WINDOW, diagnosisBounds, type TargetWindow } from './targetWindow';

// ============================================================
// מוח ה-AI — מנוע ההמלצות לשוט הבא
// מימוש מלא של "מנוע AI לכיוון אספרסו" (docs/Espresso_AI_Engine_Guide.md):
//   עקרונות: שינוי משתנה אחד בלבד · סדר עדיפות טחינה→Yield→Dose ·
//   הטעם הוא המדד העליון, זמן החליטה כלי אבחון · עדיפות למתכון מוצלח.
// רץ כולו במכשיר — אפס שירותים חיצוניים, אפס עלות.
// הטיפוסים AiAdvice/AiTargets מוגדרים ב-domain/types.ts (נשמרים עם כל שוט).
//
// מוח אחד, שני מצבים: כשיש סשן כיול פעיל (params.dialIn), ההחלטה עוברת
// ל-dialInEngine.ts שמממש את docs/DIAL_IN_ENGINE.md. כשאין — הנתיב זהה
// למה שהיה כאן תמיד. האזהרות, נקודת העצירה ורמת הביטחון משותפות לשניהם.
// ============================================================

export type { AiAdvice, AiTargets };

const REMINDER =
  'שנה אך ורק את הפרמטר הזה. טחינה, Yield ו-Dose לעולם לא משתנים יחד — כך יודעים בוודאות מה השפיע.';

// התזכורת "משתנה בודד" נכונה רק להמלצות של פרמטר יחיד.
// המלצת "מתכון" משנה טחינה+Yield+Dose יחד בכוונה, והמלצת "הכנה" לא נוגעת בפרמטרים כלל.
function reminderFor(kind: AiAdvice['changeKind']): string {
  if (kind === 'recipe')
    return 'העתק את שלושת הערכים (טחינה, Yield, Dose) במדויק — זה מתכון שכבר הוכיח את עצמו על הפולים האלה.';
  if (kind === 'prep')
    return 'שנה רק את טכניקת ההכנה. הפרמטרים (טחינה, Yield, Dose) נשארים כשהיו — כך יודעים אם הטכניקה היא ששיפרה.';
  return REMINDER; // grind / yield / dose / temp / none — שינוי משתנה בודד
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- סיווג טעם (לפי קטגוריות המדריך) ----
type TasteClass =
  | { kind: 'positive' } // מתוק / מאוזן
  | { kind: 'negative'; taste: 'sour' | 'bitter' | 'dry' | 'watery' | 'flat' }
  | { kind: 'conflict' } // חמוץ + מר יחד — חשד לתיעול
  | { kind: 'neutral' }; // לא תויג טעם רלוונטי

// 'flat' (חסר מתיקות) אחרון בכוונה: הוא התלונה העדינה ביותר, ונכנס
// לתמונה רק כשאין תלונה חדה יותר. כשהוא מופיע *יחד* עם מרירות הוא
// מטופל כמאפיין של המרירות (צעד Yield קטן) ולא כתלונה נפרדת.
const NEG_ORDER = ['sour', 'bitter', 'dry', 'watery', 'flat'] as const;
const TASTE_HE: Record<string, string> = {
  sour: 'חמוץ', bitter: 'מר', dry: 'יבש', watery: 'מימי', flat: 'חסר מתיקות',
  sweet: 'מתוק', balanced: 'מאוזן',
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

// ---- הסלמת תיקון: אילו כלים כבר נוסו על "רצף" תלונות מאותו טעם ----
// רצף = שוטים רצופים (מהחדש לישן) שכולם נשאו את אותו טעם שלילי, כולל האחרון.
// כך יודעים אם Yield וטחינה כבר מוצו — ואפשר להסלים לטמפרטורה.
function negativeStreak(history: Shot[], last: Shot, taste: TasteTag): Shot[] {
  const idx = history.findIndex((s) => s.id === last.id);
  if (idx < 0) return [last];
  const streak: Shot[] = [];
  for (let i = idx; i >= 0; i--) {
    if (history[i].tasteTags.includes(taste)) streak.unshift(history[i]);
    else break;
  }
  return streak;
}

// ---- הכנה לא עקבית ----
// עד יולי 2026 נמדד כאן פיזור זמני החליטה ב-5 השוטים האחרונים, בלי קשר
// להגדרות. זה היה שגוי בשני כיוונים: הוא ספר שינויי טחינה מכוונים כאילו
// היו רעש, והוא ספר דריפט של Degassing כאילו הוא טמפינג רועד. שניהם
// גורמים לזמן לזוז מסיבות שאינן הבריסטה.
//
// המדידה עברה ל-services/aging.ts: פיזור על *הגדרות זהות בדיוק*, אחרי
// נטרול שיפוע ההזדקנות שנמדד לאותה שקית. הקורא מחשב ומעביר לכאן, כדי
// שהמנוע יישאר טהור ושאותו מספר ישמש גם את מדד החזרתיות במסכים.

// מה כבר שונה לאורך הרצף (בין שוטים עוקבים)
function remediesTried(streak: Shot[]): { yieldChanged: boolean; grindChanged: boolean } {
  let yieldChanged = false;
  let grindChanged = false;
  for (let i = 1; i < streak.length; i++) {
    if (Math.abs(streak[i].yieldGrams - streak[i - 1].yieldGrams) >= 1.5) yieldChanged = true;
    if (Math.abs(streak[i].grindSetting - streak[i - 1].grindSetting) >= 0.01) grindChanged = true;
  }
  return { yieldChanged, grindChanged };
}

// ---- טמפרטורה: כלי כיול שלישי, רק אחרי שמוצו Yield וטחינה ----
const TEMP_ORDER: MachineTempSetting[] = ['low', 'medium', 'high'];
const TEMP_HE: Record<MachineTempSetting, string> = {
  low: 'נמוכה', medium: 'בינונית', high: 'גבוהה',
};

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
  targetWindow?: TargetWindow; // חלון היעד של הפולים האלה — מקור האמת לזמן החליטה
  // כשיש סשן כיול פעיל, ההחלטה עוברת ל-DIAL IN v2.0 (dialInEngine.ts).
  // כל השאר — אזהרות, נקודת עצירה, רמת ביטחון — נשאר משותף.
  dialIn?: { session: DialInSession; sessionShots: Shot[] };
  // פיזור זמני החליטה על הגדרות זהות, מנוטרל הזדקנות (services/aging.ts).
  // מחושב בקורא כי הוא זה שמחזיק את השקיות, ומשמש גם את מדד החזרתיות
  // במסכים — מדידה אחת, לא שתיים שיכולות להיפרד.
  prepSpread?: Repeatability | null;
}): AiAdvice {
  const { lastShot: last, beanShots, grinder, grinderChanged } = params;
  const grindStep = grinder?.scaleStep || 1;
  // הקיר הדק נקרא מהרשימה הגולמית (שוט חנוק הוא בדיוק המידע), וההיסטוריה
  // שממנה לומדים מסוננת ממנו וממה שסומן כפסול.
  const floor = chokeFloor(beanShots);
  const fineFloor = fineLimit(floor, grindStep);
  const history = analyzable(beanShots);
  const prev = prevSameBeanShot(history, last);
  const t = last.brewTimeSec;
  const cls = classifyTaste(last);
  const warnings: string[] = [];

  // גבולות אבחון נגזרים מחלון היעד של הפולים האלה (ולא מקבוע גלובלי):
  // קלייה בהירה טרייה שואפת ל-30–36 שניות, כהה ל-22–28. שוט בתוך החלון
  // (או במרווח הסובלנות סביבו) נשפט לפי הטעם, לא לפי השעון.
  const window = params.targetWindow ?? DEFAULT_TARGET_WINDOW;
  const { tooFast, tooSlow } = diagnosisBounds(window);
  const windowText = `${window.min}–${window.max} שניות`;

  // שוט חנוק: אין זמן, אין טעם ואין דירוג למדוד. סיכום שמציג 0 בשלושתם
  // נראה כמו תיעוד חסר במקום כמו מה שהוא — מדידה של הקצה הדק.
  const lastShotSummary = last.choked
    ? `טחינה ${last.grindSetting} · המכונה נחנקה — הזרימה לא התחילה`
    : `${last.doseGrams}←${last.yieldGrams} גרם · ${t} שניות · טחינה ${last.grindSetting}` +
      ` · טעם: ${tasteText(last)} · דירוג ${last.rating}/10`;

  // ברירת מחדל: לשמור על אותם פרמטרים
  const targets: AiTargets = {
    doseGrams: last.doseGrams,
    yieldGrams: last.yieldGrams,
    grindSetting: last.grindSetting,
    machineTemp: last.machineTemp,
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
  // שוט חנוק פטור: הזמן שלו אינו מדידה, ואזהרה עליו רק מסתירה את האבחנה
  if (!last.choked && t > 0 && (t < 15 || t > 45)) {
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
  let dialInState: DialInState | null = null;
  let reminderOverride: string | null = null;

  // תמיד ביחס לדרגה האחרונה שהוזנה על המטחנה הזו, ובגבולות הסקאלה שלה
  const clampGrind = (v: number): number => {
    if (!grinder) return round1(v);
    return round1(Math.min(grinder.scaleMax, Math.max(grinder.scaleMin, v)));
  };
  // כשההצמדה לגבולות הסקאלה מחזירה את אותה דרגה, אין שינוי — וההמלצה
  // לא מתחזה לכזה. קודם הכותרת אמרה "דרגת טחינה — גס יותר" בזמן שהגוף
  // אמר "אי אפשר לעלות עוד", וגם ביקורת ההמלצות שפטה מול יעד שלא זז.
  const grindFiner = () => {
    targets.grindSetting = clampGrind(last.grindSetting - grindStep);
    // קיר החניקה: אם כבר נחנקת בדרגה הזו (או גסה ממנה) בפולים האלה,
    // לרדת עוד זו לא עדינות אלא חניקה נוספת. הכלי הזה מוצה כאן.
    if (fineFloor !== null && targets.grindSetting < fineFloor) {
      targets.grindSetting = last.grindSetting;
      changeKind = 'none';
      changeLabel = 'הטחינה בקיר החניקה';
      instruction =
        `תיעדת חניקה בטחינה ${floor}${grinder ? ` (${grinder.name})` : ''} בפולים האלה, ולכן ` +
        `${fineFloor} היא הדרגה הדקה ביותר שיש טעם לנסות. אתה כבר עליה או קרוב אליה — ` +
        'הכלי הזה מוצה. השינוי הבא צריך לבוא מ-Yield או מטמפרטורה.';
      return;
    }
    if (targets.grindSetting === last.grindSetting) {
      changeKind = 'none';
      changeLabel = 'הטחינה בקצה הדק של הסקאלה';
      instruction = `הטחינה כבר בקצה הדק של הסקאלה (${last.grindSetting}${grinder ? `, ${grinder.name}` : ''}) — אי אפשר לרדת עוד. בדוק בהגדרות שטווח הסקאלה של המטחנה מוגדר נכון; אם הוא נכון, הכלי הזה מוצה והשינוי הבא צריך לבוא מ-Yield או מטמפרטורה.`;
    } else {
      changeKind = 'grind';
      changeLabel = 'דרגת טחינה — דק יותר';
      instruction = `טחן דק יותר: עבור מדרגה ${last.grindSetting} לדרגה ${targets.grindSetting}${grinder ? ` (${grinder.name})` : ''}. מנה ו-Yield נשארים זהים.`;
    }
  };
  const grindCoarser = () => {
    targets.grindSetting = clampGrind(last.grindSetting + grindStep);
    if (targets.grindSetting === last.grindSetting) {
      changeKind = 'none';
      changeLabel = 'הטחינה בקצה הגס של הסקאלה';
      instruction = `הטחינה כבר בקצה הגס של הסקאלה (${last.grindSetting}${grinder ? `, ${grinder.name}` : ''}) — אי אפשר לעלות עוד. בדוק בהגדרות שטווח הסקאלה של המטחנה מוגדר נכון; אם הוא נכון, הכלי הזה מוצה והשינוי הבא צריך לבוא מ-Yield או מטמפרטורה.`;
    } else {
      changeKind = 'grind';
      changeLabel = 'דרגת טחינה — גס יותר';
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
  // טמפרטורה — כלי הכיול השלישי (רק אחרי שמוצו Yield וטחינה)
  const tempUp = () => {
    const i = TEMP_ORDER.indexOf(last.machineTemp);
    const next = TEMP_ORDER[Math.min(TEMP_ORDER.length - 1, i + 1)];
    targets.machineTemp = next;
    if (next === last.machineTemp) {
      changeKind = 'none';
      changeLabel = 'הטמפרטורה בשיא — אין כלי נוסף';
      instruction = `הטמפרטורה כבר בשיא (${TEMP_HE[last.machineTemp]}) — מיצית את כל כלי הכיול לחמיצות. אם היא נמשכת, ייתכן שהפולים חמוצים באופיים או טריים מדי (Degassing).`;
    } else {
      changeKind = 'temp';
      changeLabel = 'טמפרטורה — העלאה';
      instruction = `העלה את טמפרטורת המכונה מ${TEMP_HE[last.machineTemp]} ל${TEMP_HE[next]}. טחינה, Yield ומנה נשארים זהים — מים חמים יותר מעמיקים את החילוץ.`;
    }
  };
  const tempDown = () => {
    const i = TEMP_ORDER.indexOf(last.machineTemp);
    const next = TEMP_ORDER[Math.max(0, i - 1)];
    targets.machineTemp = next;
    if (next === last.machineTemp) {
      changeKind = 'none';
      changeLabel = 'הטמפרטורה במינימום — אין כלי נוסף';
      instruction = `הטמפרטורה כבר במינימום (${TEMP_HE[last.machineTemp]}) — מיצית את כל כלי הכיול למרירות. אם היא נמשכת, ייתכן שהפולים קלויים כהה מאוד או ישנים.`;
    } else {
      changeKind = 'temp';
      changeLabel = 'טמפרטורה — הורדה';
      instruction = `הורד את טמפרטורת המכונה מ${TEMP_HE[last.machineTemp]} ל${TEMP_HE[next]}. טחינה, Yield ומנה נשארים זהים — מים קרירים יותר ממתנים את החילוץ ומפחיתים מרירות.`;
    }
  };

  // ---- הכנה לא עקבית: מחושב בקורא (services/aging.ts) ומועבר לכאן ----
  const prepSpread = params.prepSpread ?? null;
  const prepUnstable = !!prepSpread && prepSpread.spreadSec >= PREP_NOISE_SEC;

  // ---- ענף הכיול: DIAL IN v2.0 גובר על עץ ההחלטה היומיומי ----
  // ראשון בשרשרת בכוונה. בכיול אין "חזרה למתכון" — אין עדיין מתכון,
  // ובשקית חוזרת המתכון הוא נקודת ההתחלה של התהליך ולא חלופה לו.
  // שכבות ההגנה (תיעול, הכנה לא יציבה) מיושמות בתוך dialInDecide.
  const recipe = findRecipe(history, last);
  if (params.dialIn) {
    const d = dialInDecide({
      session: params.dialIn.session,
      lastShot: last,
      sessionShots: params.dialIn.sessionShots,
      window,
      grindStep,
      grinderName: grinder?.name,
      clampGrind,
      prepSpread,
      chokeFloor: floor,
    });
    targets.doseGrams = d.targets.doseGrams;
    targets.yieldGrams = d.targets.yieldGrams;
    targets.grindSetting = d.targets.grindSetting;
    targets.machineTemp = d.targets.machineTemp;
    changeKind = d.changeKind;
    changeLabel = d.changeLabel;
    diagnosis = d.diagnosis;
    instruction = d.instruction;
    expectedResult = d.expectedResult;
    tone = d.tone;
    reminderOverride = d.reminder;
    dialInState = d.state;
  }
  // ---- השוט נחנק ----
  // אין כאן מה לאבחן מהטעם או מהשעון: הזרימה נעצרה, וכל מספר אחר בשוט
  // הזה נגזר מזה. הכיוון היחיד הוא גס יותר, והדרגה הזו נרשמת כקיר.
  else if (last.choked) {
    grindCoarser();
    diagnosis =
      `המכונה נחנקה בטחינה ${last.grindSetting}${grinder ? ` (${grinder.name})` : ''} — ` +
      'ההתנגדות גבוהה מכדי שהמים יעברו. זו לא בעיית טעם ולא בעיית Yield, ' +
      'ומכאן והלאה זו הדרגה שלא נרד מתחתיה בפולים האלה.';
    expectedResult = 'זרימה שמתחילה. משם ממשיכים לכייל לפי הזמן והטעם.';
    tone = 'warn';
    reminderOverride =
      'שוט חנוק לא נכנס לחישובים — הוא רק מסמן את הקצה. אל תשנה שום דבר חוץ מהטחינה.';
  }
  // ---- עדיפות למתכון מוצלח (עיקרון 4) ----
  else if (recipe && last.rating <= recipe.rating - 2 && deviatesFromRecipe(last, recipe, grindStep)) {
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
  // ---- מודל ביטחון: הכנה לא עקבית — מייצבים לפני שמכיילים ----
  // כשזמני החליטה האחרונים מפוזרים מאוד, טעם שלילי בשוט בודד הוא כנראה
  // רעש של הכנה ולא בעיית הגדרות. לא רודפים אחרי הרעש — קודם מייצבים.
  else if (prepUnstable && prepSpread && cls.kind === 'negative') {
    changeKind = 'prep';
    changeLabel = 'ייצוב ההכנה (לא הגדרות!)';
    diagnosis =
      `${prepSpread.shots} שוטים רצו על טחינה ${prepSpread.grindSetting} ומנה ${prepSpread.doseGrams} גרם — ` +
      `אותן הגדרות בדיוק — ובכל זאת נפרשו על ${prepSpread.spreadSec} שניות` +
      `${prepSpread.ageAdjusted ? ' (אחרי נטרול הזדקנות הפולים)' : ''}. ` +
      'את הפער הזה לא גרם שום שינוי שעשית, והוא לא הפולים — הוא ההכנה. ' +
      'שינוי הגדרות עכשיו מכייל על רעש.';
    instruction =
      'לפני שמכיילים — יַצֵּב את ההכנה: חזור על אותם פרמטרים בדיוק, עם פיזור אחיד במחט (WDT), ' +
      'פילוס, טמפינג ישר ולחץ קבוע. כשהפער יירד מתחת ל-4 שניות — נדע שהשינוי הבא באמת ישקף את הפולים.';
    expectedResult = 'זמני חליטה צמודים זה לזה — בסיס אמין לכיול הבא.';
    tone = 'warn';
  }
  // ---- שלב 1: זמן חליטה קצר ----
  else if (t > 0 && t < tooFast) {
    if (cls.kind === 'negative') {
      diagnosis = `זמן חליטה קצר (${t} שניות מול יעד ${windowText}) יחד עם טעם ${TASTE_HE[cls.taste]} — המים עברו מהר מדי דרך הפאק. הטחינה גסה מדי.`;
      grindFiner();
      expectedResult = 'זמן החליטה יתארך לכיוון חלון היעד, החילוץ יעמיק והטעם יתאזן.';
      tone = 'warn';
    } else if (cls.kind === 'positive') {
      diagnosis = `השוט מוצלח (${tasteText(last)}) למרות זמן קצר מהיעד (${t} שניות מול ${windowText}). לפי הכללים — הטעם הוא המדד החשוב ביותר, וזמן הוא רק כלי אבחון.`;
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
  else if (t > tooSlow) {
    if (cls.kind === 'negative') {
      diagnosis = `זמן חליטה ארוך (${t} שניות מול יעד ${windowText}) יחד עם טעם ${TASTE_HE[cls.taste]} — המים שהו יותר מדי בפאק. הטחינה דקה מדי.`;
      grindCoarser();
      expectedResult = 'זמן החליטה יתקצר לכיוון חלון היעד והטעם יתנקה.';
      tone = 'warn';
    } else if (cls.kind === 'positive') {
      diagnosis = `השוט מוצלח (${tasteText(last)}) למרות זמן ארוך מהיעד (${t} שניות מול ${windowText}). הטעם מנצח — לא נוגעים.`;
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
          case 'sour': {
            // הסלמה: Yield ← טחינה ← טמפרטורה, לפי מה שכבר נוסה ברצף התלונות
            const tried = remediesTried(negativeStreak(history, last, 'sour'));
            if (tried.yieldChanged && tried.grindChanged) {
              diagnosis = 'עדיין חמוץ אחרי שגם ה-Yield וגם הטחינה כבר נוסו — מיצינו את שני הכלים הראשונים. הכלי הבא הוא טמפרטורה.';
              tempUp();
              expectedResult = 'מים חמים יותר יעמיקו את החילוץ וימיסו את החמיצות שנותרה.';
            } else if (tried.yieldChanged) {
              diagnosis = 'עדיין חמוץ למרות שה-Yield כבר הוגדל — הגדלת Yield מוצתה. עוברים לטחינה.';
              grindFiner();
              expectedResult = 'חילוץ עמוק יותר שימיס את החמיצות במתיקות.';
            } else {
              diagnosis = `חמיצות בזמן תקין (${t} שניות) — החילוץ נעצר מוקדם מדי בשלב החומצי. לפי הסדר: קודם Yield, לא טחינה.`;
              yieldUp();
              expectedResult = 'המים הנוספים ימשכו את המתיקות שמאזנת את החמיצות.';
            }
            tone = 'warn';
            break;
          }
          case 'bitter': {
            // "חסר מתיקות" יחד עם מרירות = חילוץ שעבר במעט את נקודת המתיקות.
            // המדריך קורא שם לצעד קטן (גרם אחד), לא לצעד מלא.
            if (last.tasteTags.includes('flat')) {
              targets.yieldGrams = round1(Math.max(last.doseGrams, last.yieldGrams - 1));
              changeKind = 'yield';
              changeLabel = 'Yield — הקטנה קטנה';
              diagnosis = `חסרה מתיקות ויש גם מעט מרירות (${t} שניות) — החילוץ עבר במעט את נקודת המתיקות, ולכן הצעד קטן מהרגיל.`;
              instruction = `הקטן את ה-Yield בגרם אחד: יעד סופי של ${targets.yieldGrams} גרם בכוס (במקום ${last.yieldGrams}). טחינה ומנה נשארות זהות.`;
              expectedResult = 'עצירה גרם אחד מוקדם יותר — בדיוק לפני שהמרירות מכסה על המתיקות.';
              tone = 'warn';
              break;
            }
            const tried = remediesTried(negativeStreak(history, last, 'bitter'));
            if (tried.yieldChanged && tried.grindChanged) {
              diagnosis = 'עדיין מר אחרי שגם ה-Yield וגם הטחינה כבר נוסו — מיצינו את שני הכלים הראשונים. הכלי הבא הוא טמפרטורה.';
              tempDown();
              expectedResult = 'מים קרירים יותר ימתנו את החילוץ ויעצרו לפני התרכובות המרות.';
            } else if (tried.yieldChanged) {
              diagnosis = 'עדיין מר למרות שה-Yield כבר הוקטן — הקטנת Yield מוצתה. עוברים לטחינה.';
              grindCoarser();
              expectedResult = 'חילוץ מתון יותר שיעצור לפני התרכובות המרות.';
            } else {
              diagnosis = `מרירות בזמן תקין (${t} שניות) — החילוץ נמשך אל השלב המר. לפי הסדר: קודם Yield.`;
              yieldDown();
              expectedResult = 'עצירה מוקדמת שתשאיר את המרירות מחוץ לכוס.';
            }
            tone = 'warn';
            break;
          }
          case 'dry':
            // עפיצות היא חילוץ יתר של טאנינים, והם מגיעים בסוף החילוץ —
            // ולכן עוצרים מוקדם יותר. (DIAL IN v2.0; קודם לכן היה כאן Yield↑.)
            if (alreadyAdjustedYield(prev, last, 'down', 'dry')) {
              diagnosis = `עדיין יבש למרות הקטנת ה-Yield — עוברים לטחינה גסה יותר להפחתת העפיצות.`;
              grindCoarser();
              expectedResult = 'פחות טאנינים בכוס — סיום נקי יותר.';
            } else {
              diagnosis = `יובש/עפיצות בזמן תקין — החילוץ נמשך אל הטאנינים. מתחילים בהקטנת Yield.`;
              yieldDown();
              expectedResult = 'סיום רך יותר, בלי התחושה המחוספסת בפה.';
            }
            tone = 'warn';
            break;

          case 'flat':
            // חסרה מתיקות בלי מרירות: לא חילוץ יתר. לפי המדריך — טחינה
            // דקה יותר אינה בהכרח טובה יותר; דווקא מעט גסה נותנת זרימה
            // אחידה ומתיקות גבוהה יותר.
            diagnosis = `חסרה מתיקות בלי מרירות (${t} שניות) — זה לא חילוץ יתר, ולכן הקטנת Yield לא תעזור. טחינה מעט גסה יותר נותנת זרימה אחידה ומתיקות שמגיעה מעצמה.`;
            grindCoarser();
            expectedResult = 'זרימה אחידה יותר מהפאק ומתיקות מורגשת בלגימה האמצעית.';
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
  // בשוט חנוק אין Yield אמיתי לגזור ממנו נקודת עצירה, ושורה כזו תצא שטות.
  if (changeKind !== 'prep' && !last.choked) {
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
  if (finalKind === 'grind' || finalKind === 'yield' || finalKind === 'dose' || finalKind === 'temp') {
    const sameKindFollowed = auditAdviceHistory(history, grinder)
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
    reminder: reminderOverride ?? reminderFor(finalKind),
    dialIn: dialInState,
    grinderScale: grinder
      ? { min: grinder.scaleMin, max: grinder.scaleMax, step: grinder.scaleStep }
      : null,
  };
}
