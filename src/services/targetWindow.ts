import type { Bag, Bean, RoastLevel, Shot } from '../domain/types';

// ============================================================
// חלון זמן החליטה — מקור אמת אחד לכל האפליקציה
// ============================================================
// לפני המודול הזה היו שלושה חלונות סותרים: המלצה לפי קלייה (28–34 לבהירה),
// המוח (קבוע 20/35) ומדד "הדופק שלך" (קבוע 22–32). התוצאה: שוט שעמד בדיוק
// ביעד שהאפליקציה נתנה נספר כפספוס במדד העקביות, ולפעמים גם קיבל הוראת
// תיקון מיותרת. עכשיו כולם נגזרים מכאן.
//
// שני שימושים, שני טווחים:
//   1. חלון היעד (min–max) — "לאן לכוון". לפי רמת קלייה, טריות וכיול אישי.
//   2. גבולות אבחון (diagnosisBounds) — רק מעבר להם זמן החליטה עצמו הוא
//      האבחנה. בתוך החלון + מרווח סובלנות, הטעם הוא הקובע.

export interface TargetWindow {
  min: number;
  max: number;
  source: 'roast' | 'personal'; // כללי לפי קלייה, או מכויל מהשוטים שלך
}

export interface RoastDefaults {
  ratio: number;
  timeMin: number;
  timeMax: number;
}

// נקודות פתיחה מקובלות: קליות בהירות סולחות ליחס ארוך יותר וזמן ארוך,
// קליות כהות מחלצות מהר וצריכות יחס קצר יותר.
export const ROAST_DEFAULTS: Record<RoastLevel, RoastDefaults> = {
  'light': { ratio: 2.5, timeMin: 28, timeMax: 34 },
  'light-medium': { ratio: 2.3, timeMin: 27, timeMax: 32 },
  'medium': { ratio: 2.0, timeMin: 25, timeMax: 30 },
  'medium-dark': { ratio: 1.9, timeMin: 24, timeMax: 29 },
  'dark': { ratio: 1.8, timeMin: 22, timeMax: 28 },
};

// חלון גיבוי כשאין מידע על הפולים (פולים שנמחקו וכו')
export const DEFAULT_TARGET_WINDOW: TargetWindow = { min: 25, max: 32, source: 'roast' };

// מרווח סובלנות סביב חלון היעד. רק מעבר לו זמן החליטה עצמו הופך לאבחנה —
// בתוכו מסתכלים על הטעם. מונע "תקן טחינה" על שוט שהחטיא את היעד בשנייה.
export const TIME_DIAGNOSIS_MARGIN = 3;

// פולים טריים מאוד עדיין משחררים CO₂ — הזרימה נוטה להיות איטית יותר.
const FRESH_ROAST_DAYS = 5;
const FRESH_ROAST_SHIFT = 2;

// שוטים שמשמשים לכיול אישי: דירוג 6+, השליש העליון (לפחות 3).
// אותה בחירה משמשת גם לכיול היחס ב-recommendation.ts — מיוצא כדי שלא
// יתפצלו לשתי הגדרות שונות של "השוטים הטובים שלי".
export function bestShotsForCalibration(beanShots: Shot[]): Shot[] {
  const rated = beanShots.filter((s) => s.rating >= 6);
  if (rated.length === 0) return [];
  return [...rated]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, Math.max(3, Math.ceil(rated.length / 3)));
}

export function computeTargetWindow(params: {
  roastLevel: RoastLevel;
  roastAgeDays?: number | null; // גיל הקלייה ברגע הרלוונטי (לא בהכרח היום)
  beanShots?: Shot[]; // היסטוריית הפולים — לכיול אישי. השמט כדי לקבל חלון כללי
}): TargetWindow {
  const defaults = ROAST_DEFAULTS[params.roastLevel] ?? ROAST_DEFAULTS.medium;

  // כיול אישי גובר על הכללים: ±2 שניות סביב זמן השוטים הטובים שלך.
  // רק שוטים עם זמן מתועד — שוט בלי זמן היה מוריד את הממוצע שלא לצורך.
  const best = bestShotsForCalibration(params.beanShots ?? []).filter((s) => s.brewTimeSec > 0);
  if (best.length > 0) {
    const avgTime = best.reduce((a, s) => a + s.brewTimeSec, 0) / best.length;
    return { min: Math.round(avgTime - 2), max: Math.round(avgTime + 2), source: 'personal' };
  }

  let { timeMin: min, timeMax: max } = defaults;
  const age = params.roastAgeDays;
  if (age !== null && age !== undefined && age < FRESH_ROAST_DAYS) {
    min += FRESH_ROAST_SHIFT;
    max += FRESH_ROAST_SHIFT;
  }
  return { min, max, source: 'roast' };
}

// גבולות שמעברם זמן החליטה עצמו הוא האבחנה (מהיר מדי / איטי מדי).
export function diagnosisBounds(w: TargetWindow): { tooFast: number; tooSlow: number } {
  return { tooFast: w.min - TIME_DIAGNOSIS_MARGIN, tooSlow: w.max + TIME_DIAGNOSIS_MARGIN };
}

// גיל הקלייה ברגע נתון (ולא "היום") — נדרש כדי לשפוט שוטים היסטוריים
// לפי החלון שהיה תקף כשהם נעשו.
export function roastAgeAt(roastDate: string | null, atIso: string): number | null {
  if (!roastDate) return null;
  const roast = new Date(roastDate).getTime();
  const at = new Date(atIso).getTime();
  if (Number.isNaN(roast) || Number.isNaN(at)) return null;
  return Math.floor((at - roast) / 86_400_000);
}

export type WindowResolver = (shot: Shot) => TargetWindow;

// פותר חלון יעד לכל שוט היסטורי, לפי רמת הקלייה של הפולים וגיל הקלייה
// ברגע השוט. בכוונה *בלי* כיול אישי: מדד עקביות שנגזר מהשוטים הטובים
// עצמם הוא מעגלי — הוא היה מודד את עצמו ולא את הדיוק שלך.
export function makeWindowResolver(beans: Bean[], bags: Bag[]): WindowResolver {
  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  return (shot) => {
    const bean = beanMap.get(shot.beanId);
    if (!bean) return DEFAULT_TARGET_WINDOW;
    const bag = bagMap.get(shot.bagId);
    return computeTargetWindow({
      roastLevel: bean.roastLevel,
      roastAgeDays: roastAgeAt(bag?.roastDate ?? null, shot.createdAt),
    });
  };
}
