import type { Bag, RoastType, Shot } from '../domain/types';
import { daysSince } from './dates';
import { analyzable } from './shotFilter';

// חלון הטריות של פולי אספרסו לפי תאריך קלייה:
// • 0–4 ימים: הפולים עדיין "מגזזים" CO₂ (Degassing) — לא יציבים.
// • ~14 יום: שיא הטעם.
// • עד 30 יום: חלון מצוין.
// • 30–60 יום: עדיין טובים, מתחילים לרדת.
// • 60+ יום: איבדו מהטעם (דד-ליין).

export const PEAK_DAYS = 14;
export const FRESHNESS_DEADLINE_DAYS = 60;

// ===== שני שעונים =====
// המודל למעלה מניח שקנית פולים טריים ופתחת אותם מיד. כשקונים שקית
// שנקלתה לפני חודשיים ומעלה זה נשבר: היא נפתחת ישר כ"פג תוקף", עם תגית
// אדומה והתראה — על שקית שרק פתחת, בכוונה.
//
// זה לא באג בסף אלא בשעון. שני תהליכים שונים רצים כאן:
//   · Degassing — שחרור CO₂. נגמר תוך 3–4 שבועות מהקלייה, ומשפיע על
//     זמן החליטה. השעון שלו הוא תאריך הקלייה.
//   · חמצון — איבוד ארומטים ושומנים. משפיע על הטעם, ומאיץ מאוד ברגע
//     שהשקית נפתחת ושכבת ה-CO₂ המגנה נעלמת. השעון שלו הוא הפתיחה.
//
// בשקית טרייה שנפתחה מיד שני השעונים כמעט חופפים, ולכן ספירה מהקלייה
// עבדה. בשקית שנקנתה מיושנת הם מתפצלים — והשעון הקובע הוא הפתיחה.
export const AGED_PURCHASE_DAYS = 45; // קלייה עד פתיחה מעבר לזה = "נקנתה מיושנת"

// חלון הטריות של קלייה ישנה, נספר מהפתיחה:
//   0–30  שימוש מיטבי
//   30–60 ירידה בטעם ובאיכות
//   60    דד-ליין
export const AGED_OPTIMAL_DAYS = 30;
export const AGED_DEADLINE_DAYS = 60;

export type FreshnessStage = 'resting' | 'peak' | 'good' | 'fading' | 'expired' | 'unknown';

export interface Freshness {
  stage: FreshnessStage;
  ageDays: number | null; // ימים מהקלייה — תמיד, בשני השעונים
  // גיל הטריות: ימים מנקודת ההתחלה של החלון. בקלייה טרייה הוא זהה
  // ל-ageDays; בקלייה ישנה הוא נספר מהפתיחה. זה המספר שהפס מציג.
  freshnessAgeDays: number | null;
  freshnessScaleDays: number; // אורך הפס בימים (60 בשני המצבים)
  deadlineDate: string | null; // תאריך היעד (ISO date)
  daysToDeadline: number | null; // כמה ימים נשארו עד הדד-ליין (שלילי = עבר)
  label: string; // תווית קצרה לתצוגה
  cls: 'good' | 'warn' | 'bad' | 'muted'; // מחלקת צבע לתגית
  // 'roast' — קלייה טרייה, נספרת מהקלייה.
  // 'opened' — קלייה ישנה: הגזים כבר יצאו, והשעון שנותר הוא הפתיחה.
  clock: 'roast' | 'opened' | 'unknown';
  daysOpen: number | null;
}

// סוג הקלייה בפועל. בחירה מפורשת גוברת; בלעדיה נשמרת ההתנהגות שהייתה
// עד היום — זיהוי אוטומטי לפי הפער בין הקלייה לפתיחה.
export function resolveRoastType(
  roastType: RoastType | undefined, roastDate: string | null, openDate: string | null | undefined,
): RoastType {
  if (roastType) return roastType;
  if (!roastDate || !openDate) return 'fresh';
  const gap = Math.floor((new Date(openDate).getTime() - new Date(roastDate).getTime()) / 86_400_000);
  return gap >= AGED_PURCHASE_DAYS ? 'aged' : 'fresh';
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeFreshness(
  roastDate: string | null, openDate?: string | null, roastType?: RoastType,
): Freshness {
  const ageDays = daysSince(roastDate);
  const daysOpen = daysSince(openDate ?? null);
  const type = resolveRoastType(roastType, roastDate, openDate);

  // ---- קלייה ישנה: השעון הוא הפתיחה, ורק הוא ----
  // נבדק לפני תאריך הקלייה בכוונה: בפולים כאלה הקלייה היא מידע רקע,
  // והחלון כולו נגזר מהפתיחה. שקית שנפתחה היום היא יום 0, גם אם נקלתה
  // לפני 95 יום.
  if (type === 'aged') {
    if (!openDate || daysOpen === null) {
      return {
        stage: 'unknown', ageDays, freshnessAgeDays: null, freshnessScaleDays: AGED_DEADLINE_DAYS,
        deadlineDate: null, daysToDeadline: null,
        label: 'קלייה ישנה — חסר תאריך פתיחת שקית', cls: 'muted', clock: 'opened', daysOpen: null,
      };
    }
    const left = AGED_DEADLINE_DAYS - daysOpen;
    const base = {
      ageDays, daysOpen, clock: 'opened' as const,
      freshnessAgeDays: daysOpen,
      freshnessScaleDays: AGED_DEADLINE_DAYS,
      deadlineDate: addDays(openDate, AGED_DEADLINE_DAYS),
      daysToDeadline: left,
    };
    if (daysOpen <= AGED_OPTIMAL_DAYS) {
      return { ...base, stage: 'peak',
        label: `שימוש מיטבי · יום ${daysOpen} מהפתיחה`, cls: 'good' };
    }
    if (daysOpen < AGED_DEADLINE_DAYS) {
      return { ...base, stage: 'fading',
        label: `ירידה בטעם · יום ${daysOpen} מהפתיחה · ${left} ימים לדד-ליין`, cls: 'warn' };
    }
    return { ...base, stage: 'expired',
      label: `עברו ${daysOpen} ימים מהפתיחה — מעבר לדד-ליין`, cls: 'bad' };
  }

  // ---- קלייה טרייה: בדיוק כפי שהיה ----
  if (roastDate === null || ageDays === null) {
    return {
      stage: 'unknown', ageDays: null, freshnessAgeDays: null,
      freshnessScaleDays: FRESHNESS_DEADLINE_DAYS,
      deadlineDate: null, daysToDeadline: null,
      label: 'תאריך קלייה לא ידוע', cls: 'muted', clock: 'unknown', daysOpen,
    };
  }

  const deadlineDate = addDays(roastDate, FRESHNESS_DEADLINE_DAYS);
  const daysToDeadline = FRESHNESS_DEADLINE_DAYS - ageDays;

  let stage: FreshnessStage;
  let label: string;
  let cls: Freshness['cls'];

  if (ageDays < 5) {
    stage = 'resting';
    label = `בן ${ageDays} ימים — עדיין משחרר גזים`;
    cls = 'warn';
  } else if (ageDays <= 21) {
    stage = 'peak';
    label = `בשיא הטריות (יום ${ageDays})`;
    cls = 'good';
  } else if (ageDays <= 45) {
    stage = 'good';
    label = `טרי (יום ${ageDays})`;
    cls = 'good';
  } else if (ageDays < FRESHNESS_DEADLINE_DAYS) {
    stage = 'fading';
    label = `מתחיל לרדת · ${daysToDeadline} ימים לדד-ליין`;
    cls = 'warn';
  } else {
    stage = 'expired';
    label = `עבר ${ageDays - FRESHNESS_DEADLINE_DAYS} ימים מהדד-ליין`;
    cls = 'bad';
  }

  return {
    stage, ageDays,
    freshnessAgeDays: ageDays, // בקלייה טרייה שני הגילים חופפים
    freshnessScaleDays: FRESHNESS_DEADLINE_DAYS,
    deadlineDate, daysToDeadline, label, cls, clock: 'roast', daysOpen,
  };
}

export function formatDeadline(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ===== חלון הטריות המנצח האישי =====
// מחושב מהשוטים בפועל: טווח גיל-הקלייה שבו הדירוגים הכי גבוהים.
// משמש גם את עקומת הטריות (Analytics) וגם את ההתראה במסך הבית.

export const AGE_BUCKETS = [
  { label: '0–6', from: 0, to: 6 },
  { label: '7–13', from: 7, to: 13 },
  { label: '14–20', from: 14, to: 20 },
  { label: '21–29', from: 21, to: 29 },
  { label: '30–44', from: 30, to: 44 },
  { label: '45+', from: 45, to: 999 },
];

export interface WinningWindow {
  label: string;
  from: number;
  to: number;
  avg: number;
  count: number;
}

// זוגות (גיל קלייה ביום ההכנה, דירוג) לכל השוטים עם תאריך קלייה ידוע
export function shotAgeRatings(rawShots: Shot[], bags: Bag[]): { age: number; rating: number }[] {
  // עקומת הטריות מודדת טעם מול גיל — שוט פסול או חנוק אינו נקודה בה
  const shots = analyzable(rawShots);
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  return shots.flatMap((s) => {
    const roast = bagMap.get(s.bagId)?.roastDate;
    if (!roast || !s.rating) return [];
    const age = Math.floor((new Date(s.createdAt).getTime() - new Date(roast).getTime()) / 86400000);
    return age >= 0 && age <= 90 ? [{ age, rating: s.rating }] : [];
  });
}

// כמה הטווח המנצח חייב להקדים את הבא אחריו כדי להיחשב ממצא ולא רעש.
//
// נמדד על 54 השוטים של נאור: סטיית התקן של הדירוגים 0.89, ושגיאת התקן
// של ההפרש בין שני טווחים עם ~16 שוטים כל אחד היא 0.28. במדידה ההיא
// טווח 30–44 "ניצח" את 21–29 בהפרש של 0.011 — ארבעה אחוזים מסטיית תקן
// אחת, כלומר הטלת מטבע — והאפליקציה הכריזה עליו "הטווח שלך" ואז אמרה
// "אתה אחרי הטווח, שווה לסיים". סף של 0.3 הוא בערך סטיית תקן אחת.
export const MIN_WINDOW_MARGIN = 0.3;

// החלון המנצח: דורש לפחות 2 טווחים עם 2+ שוטים כדי שתהיה השוואה אמיתית,
// והפרש שגדול מהרעש כדי שתהיה מסקנה.
export function computeWinningWindow(shots: Shot[], bags: Bag[]): WinningWindow | null {
  const pts = shotAgeRatings(shots, bags);
  if (pts.length < 3) return null;
  const buckets = AGE_BUCKETS
    .map((b) => {
      const inB = pts.filter((p) => p.age >= b.from && p.age <= b.to);
      return {
        ...b,
        count: inB.length,
        avg: inB.length ? inB.reduce((a, p) => a + p.rating, 0) / inB.length : 0,
      };
    })
    .filter((b) => b.count >= 2)
    .sort((a, b) => b.avg - a.avg);
  if (buckets.length < 2) return null;
  return buckets[0].avg - buckets[1].avg >= MIN_WINDOW_MARGIN ? buckets[0] : null;
}
