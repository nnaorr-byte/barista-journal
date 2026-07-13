import type { Bag, Shot } from '../domain/types';
import { daysSince } from './recommendation';

// חלון הטריות של פולי אספרסו לפי תאריך קלייה:
// • 0–4 ימים: הפולים עדיין "מגזזים" CO₂ (Degassing) — לא יציבים.
// • ~14 יום: שיא הטעם.
// • עד 30 יום: חלון מצוין.
// • 30–60 יום: עדיין טובים, מתחילים לרדת.
// • 60+ יום: איבדו מהטעם (דד-ליין).

export const PEAK_DAYS = 14;
export const FRESHNESS_DEADLINE_DAYS = 60;

export type FreshnessStage = 'resting' | 'peak' | 'good' | 'fading' | 'expired' | 'unknown';

export interface Freshness {
  stage: FreshnessStage;
  ageDays: number | null; // ימים מהקלייה
  deadlineDate: string | null; // תאריך קלייה + 60 יום (ISO date)
  daysToDeadline: number | null; // כמה ימים נשארו עד הדד-ליין (שלילי = עבר)
  label: string; // תווית קצרה לתצוגה
  cls: 'good' | 'warn' | 'bad' | 'muted'; // מחלקת צבע לתגית
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeFreshness(roastDate: string | null): Freshness {
  const ageDays = daysSince(roastDate);
  if (roastDate === null || ageDays === null) {
    return {
      stage: 'unknown', ageDays: null, deadlineDate: null, daysToDeadline: null,
      label: 'תאריך קלייה לא ידוע', cls: 'muted',
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

  return { stage, ageDays, deadlineDate, daysToDeadline, label, cls };
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
export function shotAgeRatings(shots: Shot[], bags: Bag[]): { age: number; rating: number }[] {
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  return shots.flatMap((s) => {
    const roast = bagMap.get(s.bagId)?.roastDate;
    if (!roast || !s.rating) return [];
    const age = Math.floor((new Date(s.createdAt).getTime() - new Date(roast).getTime()) / 86400000);
    return age >= 0 && age <= 90 ? [{ age, rating: s.rating }] : [];
  });
}

// החלון המנצח: דורש לפחות 2 טווחים עם 2+ שוטים כדי שתהיה השוואה אמיתית
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
  return buckets.length >= 2 ? buckets[0] : null;
}
