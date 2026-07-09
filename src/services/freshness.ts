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
