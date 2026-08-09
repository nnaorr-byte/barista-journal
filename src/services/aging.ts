import type { Bag, Shot } from '../domain/types';
import { isAnalyzable } from './shotFilter';

// ============================================================
// הזדקנות וחזרתיות — שני מדדים מאותה מדידה
// ============================================================
// שני הדברים שמזיזים את זמן החליטה כשלא נגעת בכלום:
//
//   1. הפולים. פולים טריים משחררים CO₂ שמאט את הזרימה. ככל שהם
//      מתיישנים הזמן מתקצר. נמדד אצל נאור: ‎-1.64 שנ׳ ליום סביב יום 17,
//      ‎-0.55 סביב יום 22, ואפס מיום 27 — בדיוק צורת הדעיכה של Degassing.
//   2. ההכנה. WDT, פילוס, טמפינג, לחץ. זה מה שנשאר אחרי שמנטרלים את (1).
//
// לכן שניהם מחושבים כאן ולא בשני מקומות: אי אפשר למדוד את ההכנה בלי
// לנטרל קודם את הפולים. מדד חזרתיות שלא עושה את זה מאשים את הבריסטה
// בדריפט שכולו גזים — וזו בדיוק הטעות שהמדידה הזו נועדה למנוע.
//
// השיפוע *נמדד לכל שקית*, לא נגזר מעקומה מובנית. שקית טרייה תיתן שיפוע
// תלול, שקית בת חודש תיתן אפס, ושקית שנקנתה מיושנת תיתן אפס מהיום
// הראשון — בלי מקרה מיוחד לאף אחד מהם.

export interface SettingGroup {
  grindSetting: number;
  doseGrams: number;
  shots: Shot[];
  ages: number[]; // גיל הקלייה בכל שוט
  times: number[]; // זמן החליטה בכל שוט
}

export interface AgingSlope {
  secPerDay: number; // שלילי = הזמן מתקצר עם הגיל
  r: number; // מתאם פירסון על השאריות
  shots: number; // כמה שוטים נכנסו למדידה
  groups: number; // כמה קבוצות הגדרות
  ageFrom: number;
  ageTo: number;
  // שלוש תוצאות ולא שתיים. "נמדד ויצא אפס" הוא ממצא בפני עצמו — הוא אומר
  // שהזמן לא נודד ושכל פער שנשאר הוא ההכנה. פולים שנקנו מיושנים אמורים
  // להגיע לשם מהיום הראשון, ואסור שזה ייראה כמו "אין מספיק נתונים".
  measured: boolean; // מדגם מספיק כדי להגיד משהו
  meaningful: boolean; // השיפוע גדול מספיק כדי להרגיש אותו
}

export interface Repeatability {
  spreadSec: number; // הפער בין המהיר לאיטי, אחרי נטרול גיל
  stdevSec: number;
  grindSetting: number;
  doseGrams: number;
  shots: number;
  ageAdjusted: boolean; // האם הופעל תיקון גיל בפועל
}

// מינימום שוטים בקבוצת הגדרות זהות כדי שהיא תיחשב מדידה ולא צירוף מקרים
const MIN_GROUP = 3;
// מעל זה, פיזור על הגדרות זהות הוא רעש הכנה ולא שונות טבעית.
// מכויל מעל הפיזור הטבעי שנמדד (4–5 שנ׳) כדי שההתראה תסמן הרעה אמיתית
// ולא את קו הבסיס. אותו סף כמו prepNoise במנוע הכיול.
export const PREP_NOISE_SEC = 6;

export function roastAgeDays(shot: Shot, bag: Bag | undefined): number | null {
  if (!bag?.roastDate) return null;
  const ms = new Date(shot.createdAt).getTime() - new Date(bag.roastDate).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

// קיבוץ לפי הגדרות זהות בדיוק. רק בתוך קבוצה כזו אפשר לדעת שהזמן זז
// מסיבה שאינה שינוי שעשינו בכוונה.
export function groupBySettings(shots: Shot[], bags: Bag[]): SettingGroup[] {
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const map = new Map<string, SettingGroup>();
  for (const s of shots) {
    // שוט פסול או חנוק אינו מדידה של זמן — והמדידה כאן היא כולה זמן
    if (!s.brewTimeSec || !isAnalyzable(s)) continue;
    const age = roastAgeDays(s, bagMap.get(s.bagId));
    if (age === null) continue;
    const key = `${s.grindSetting}|${s.doseGrams}`;
    let g = map.get(key);
    if (!g) {
      g = { grindSetting: s.grindSetting, doseGrams: s.doseGrams, shots: [], ages: [], times: [] };
      map.set(key, g);
    }
    g.shots.push(s);
    g.ages.push(age);
    g.times.push(s.brewTimeSec);
  }
  return [...map.values()];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- שיפוע ההזדקנות ----
// רגרסיה עם אפקטים קבועים לכל קבוצת הגדרות: מחסרים מכל קבוצה את הממוצע
// שלה ומאחדים את השאריות. כך שינוי טחינה בין קבוצות לא נכנס לחישוב, ורק
// התנועה *בתוך* הגדרות זהות — כלומר הזמן — נמדדת.
// הדעיכה של Degassing אינה לינארית: ‎-1.6 שנ׳ ליום ביום 17 מול אפס ביום 27.
// שיפוע אחד על כל חיי השקית היה ממוצע שאינו נכון לאף נקודה בה. לכן
// המדידה מקומית בציר הגיל — רק שוטים בסביבת הגיל שמעניין אותנו עכשיו.
// ±5 ולא ±7: בנתונים אמיתיים חלון של שבוע לכל צד גלש מתקופת הדריפט
// התלול אל התקופה השטוחה והחזיר ‎-1.1 שנ׳/יום לגיל שבו כבר אין דריפט.
const AGE_WINDOW_DAYS = 5;
// שיפוע קטן מזה לא מורגש בכוס וגם לא יציב מספיק כדי לדווח עליו
const MEANINGFUL_SEC_PER_DAY = 0.3;
// קבוצת הגדרות נחשבת רלוונטית רק אם השתמשת בה לאחרונה
const RECENT_DAYS = 14;

export function computeAgingSlope(
  shots: Shot[], bags: Bag[], focusAge?: number | null,
): AgingSlope | null {
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const scoped = focusAge == null ? shots : shots.filter((s) => {
    const a = roastAgeDays(s, bagMap.get(s.bagId));
    return a !== null && Math.abs(a - focusAge) <= AGE_WINDOW_DAYS;
  });
  const groups = groupBySettings(scoped, bags).filter((g) => g.shots.length >= MIN_GROUP);
  if (groups.length === 0) return null;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let n = 0;
  let ageFrom = Infinity;
  let ageTo = -Infinity;
  for (const g of groups) {
    // קבוצה שכל השוטים בה מאותו יום לא תורמת מידע על גיל
    if (new Set(g.ages).size < 2) continue;
    const ma = mean(g.ages);
    const mt = mean(g.times);
    for (let i = 0; i < g.ages.length; i++) {
      const da = g.ages[i] - ma;
      const dt = g.times[i] - mt;
      sxy += da * dt;
      sxx += da * da;
      syy += dt * dt;
      n++;
      ageFrom = Math.min(ageFrom, g.ages[i]);
      ageTo = Math.max(ageTo, g.ages[i]);
    }
  }
  if (sxx <= 0 || n < MIN_GROUP + 1) return null;

  const secPerDay = sxy / sxx;
  const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  return {
    secPerDay: Math.round(secPerDay * 100) / 100,
    r: Math.round(r * 100) / 100,
    shots: n,
    groups: groups.length,
    ageFrom,
    ageTo,
    measured: n >= 6,
    meaningful:
      n >= 6 && Math.abs(secPerDay) >= MEANINGFUL_SEC_PER_DAY && Math.abs(r) >= 0.4,
  };
}

// כמה שניות צפוי הזמן לזוז בין שני גילאים, לפי השיפוע שנמדד
export function predictDrift(slope: AgingSlope | null, fromAge: number, toAge: number): number | null {
  if (!slope?.meaningful) return null;
  const delta = slope.secPerDay * (toAge - fromAge);
  return Math.round(delta * 10) / 10;
}

// ---- חזרתיות ----
// הפיזור בזמן החליטה על הגדרות זהות, אחרי נטרול השיפוע. זה מה שנשאר
// כשמורידים גם את ההגדרות וגם את הפולים — כלומר ההכנה.
export function computeRepeatability(
  shots: Shot[], bags: Bag[], slope: AgingSlope | null,
): Repeatability | null {
  if (shots.length === 0) return null;
  // שער עדכניות: קבוצת הגדרות שנטשת לפני שבועיים לא מתארת את מה שאתה
  // עושה עכשיו. בלי זה, קבוצה ישנה עם 3+ שוטים גוברת על ההגדרות הנוכחיות
  // רק בזכות הוותק — ובפועל הוצגה דרגת טחינה מסקאלה שכבר לא בשימוש.
  const newestAll = shots.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt;
  const cutoff = new Date(new Date(newestAll).getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const groups = groupBySettings(shots, bags).filter(
    (g) => g.shots.length >= MIN_GROUP && g.shots.some((s) => s.createdAt >= cutoff),
  );
  if (groups.length === 0) return null;

  const adjust = slope?.meaningful ? slope.secPerDay : 0;
  const scored = groups.map((g) => {
    const ma = mean(g.ages);
    // הזמן שהיה מתקבל אילו כל השוטים בקבוצה נעשו באותו יום
    const adj = g.times.map((t, i) => t - adjust * (g.ages[i] - ma));
    const m = mean(adj);
    return {
      grindSetting: g.grindSetting,
      doseGrams: g.doseGrams,
      shots: g.shots.length,
      spreadSec: Math.round((Math.max(...adj) - Math.min(...adj)) * 10) / 10,
      stdevSec: Math.round(Math.sqrt(mean(adj.map((x) => (x - m) ** 2))) * 10) / 10,
      ageAdjusted: adjust !== 0,
      newest: g.shots.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt,
    };
  });
  // הקבוצה שבה השתמשת לאחרונה — היא הרלוונטית למה שאתה עושה עכשיו
  scored.sort((a, b) => b.newest.localeCompare(a.newest));
  const { newest: _newest, ...best } = scored[0];
  return best;
}

// ---- הידוק ההכנה ----
// פער מקסימום-מינימום של קבוצה אחת רגיש לחריג בודד. למדד מצב כללי עדיף
// סטיית התקן המשוקללת של *כל* השאריות: כמה כל שוט סוטה מממוצע קבוצת
// ההגדרות שלו, על פני כל הקבוצות. זה המספר שאמור לרדת ככל שהפאק משתפר.
export interface PrepTightness {
  stdevSec: number;
  shots: number;
  groups: number;
}

function residuals(shots: Shot[], bags: Bag[], slope: AgingSlope | null): number[] {
  const adjust = slope?.meaningful ? slope.secPerDay : 0;
  const out: number[] = [];
  for (const g of groupBySettings(shots, bags)) {
    if (g.shots.length < MIN_GROUP) continue;
    const ma = mean(g.ages);
    const adj = g.times.map((t, i) => t - adjust * (g.ages[i] - ma));
    const m = mean(adj);
    for (const x of adj) out.push(x - m);
  }
  return out;
}

export function computePrepTightness(
  shots: Shot[], bags: Bag[], slope: AgingSlope | null,
): PrepTightness | null {
  const res = residuals(shots, bags, slope);
  if (res.length < 6) return null;
  const groups = groupBySettings(shots, bags).filter((g) => g.shots.length >= MIN_GROUP).length;
  return {
    stdevSec: Math.round(Math.sqrt(mean(res.map((x) => x * x))) * 10) / 10,
    shots: res.length,
    groups,
  };
}

// האם ההכנה מתהדקת? חצי ראשון מול חצי שני של ההיסטוריה.
// דורש 6 שאריות בכל חצי — מתחת לזה ההפרש הוא רעש ולא מגמה.
export function prepTightnessTrend(
  shots: Shot[], bags: Bag[],
): { recent: number; previous: number; deltaSec: number } | null {
  const sorted = [...shots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const newer = sorted.slice(mid);
  const a = computePrepTightness(older, bags, computeAgingSlope(older, bags));
  const b = computePrepTightness(newer, bags, computeAgingSlope(newer, bags));
  if (!a || !b) return null;
  return {
    recent: b.stdevSec,
    previous: a.stdevSec,
    deltaSec: Math.round((b.stdevSec - a.stdevSec) * 10) / 10,
  };
}

// אי-יציבות הכנה: הגדרות זהות שנתנו זמנים רחוקים, אחרי נטרול גיל.
// מחליף את המודל הישן שמדד פיזור על חמשת השוטים האחרונים בלי קשר
// להגדרות — מודל שספר את השינויים המכוונים שלנו כאילו היו רעש.
export function prepInstability(
  shots: Shot[], bags: Bag[], slope: AgingSlope | null,
): Repeatability | null {
  const rep = computeRepeatability(shots, bags, slope);
  return rep && rep.spreadSec >= PREP_NOISE_SEC ? rep : null;
}
