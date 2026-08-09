import type { Bag, Bean, RoastLevel, Shot } from '../domain/types';
import { analyzable, isAnalyzable } from './shotFilter';

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
  // שוט פסול או חנוק לא מכייל כלום — הוא בדיוק מה שהמדידה צריכה לסנן
  const rated = analyzable(beanShots).filter((s) => s.rating >= 6);
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

// כמה שוטים צריכים להיות לאותם פולים לפני שהחלון האישי נחשב אמין.
// מתחת לזה החלון היה נגזר מקבוצה קטנה מדי ומספר את עצמו.
export const MIN_PERSONAL_CALIBRATION_SHOTS = 5;

// חלון הדופק מכויל מהשוטים האחרונים ולא מכל ההיסטוריה. הסיבה נמדדה:
// כשהזמנים משתנים (למשל מ-26 שנ' ל-19), ממוצע על כל ההיסטוריה נופל בין
// שני הסגנונות ולא מתאים לאף אחד מהם — החלון יצא 20–24 בזמן שההמלצה על
// מסך הבית אמרה 16–20. הצירוף הזה הוא בדיוק הסתירה שהמדד היה אמור לפתור.
export const RECENT_CALIBRATION_SHOTS = 10;

// פותר חלון יעד לכל שוט היסטורי, לפי רמת הקלייה של הפולים וגיל הקלייה
// ברגע השוט. בלי כיול אישי — החלון המקצועי בלבד.
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

// פותר חלון יעד *אישי* — זה שמדד "הדופק שלך" מודד מולו.
//
// למה אישי: מנוע ההמלצות מכייל את חלון היעד מהשוטים הטובים של אותם פולים
// (computeTargetWindow עם beanShots), ולכן מדד שמודד מול החלון המקצועי בלבד
// סותר את ההמלצה שהאפליקציה עצמה נותנת — הוא סימן 0% למי שעשה בדיוק את מה
// שנכתב לו על מסך הבית. זה אותו חלון, מאותו חישוב, כדי שהמסכים לא יריבו.
//
// המעגליות מוכרת ולא מוסתרת: החלון נגזר מהשוטים הטובים שלך, ולכן אם הזמנים
// שלך נודדים — החלון נודד איתם. מה שמחזיק את המדד הוא התנאי השני,
// דירוג 8+: צריך גם לנחות בזמן המוכח וגם שהשוט ייצא טוב. שינוי סגנון מוריד
// את המספר עד שהזמן החדש הופך למוכח, וזה בדיוק מה שהמדד אמור לתפוס.
// בלי מינימום היסטוריה (MIN_PERSONAL_CALIBRATION_SHOTS) נופלים לחלון המקצועי.
export function makePersonalWindowResolver(
  beans: Bean[],
  bags: Bag[],
  shots: Shot[],
): WindowResolver {
  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const byBean = new Map<string, Shot[]>();
  for (const s of shots) {
    if (s.rating <= 0 || s.brewTimeSec <= 0 || !isAnalyzable(s)) continue;
    const list = byBean.get(s.beanId);
    if (list) list.push(s);
    else byBean.set(s.beanId, [s]);
  }
  // החדשים ראשונים, כדי שהחיתוך ל-RECENT_CALIBRATION_SHOTS יהיה חיתוך זמן
  for (const list of byBean.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (shot) => {
    const bean = beanMap.get(shot.beanId);
    if (!bean) return DEFAULT_TARGET_WINDOW;
    const roastAgeDays = roastAgeAt(bagMap.get(shot.bagId)?.roastDate ?? null, shot.createdAt);
    // רק שוטים עד לרגע השוט הנמדד: שבוע היסטורי נשפט לפי החלון שהיה תקף
    // אז, ולא לפי הסגנון של היום. אחרת דפדוף אחורה מראה 0% על שבוע שבו
    // דווקא היית עקבי, רק בזמן חליטה אחר.
    const upToNow = (byBean.get(shot.beanId) ?? []).filter((s) => s.createdAt <= shot.createdAt);
    if (upToNow.length < MIN_PERSONAL_CALIBRATION_SHOTS) {
      return computeTargetWindow({ roastLevel: bean.roastLevel, roastAgeDays });
    }
    return computeTargetWindow({
      roastLevel: bean.roastLevel,
      roastAgeDays,
      beanShots: upToNow.slice(0, RECENT_CALIBRATION_SHOTS),
    });
  };
}
