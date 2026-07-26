import type { Bag, Bean, RoastLevel, Shot, TasteTag } from '../domain/types';

// ============================================================
// הבעיה החוזרת שלך — ניתוח מצטבר על כל ההיסטוריה
// ============================================================
// המוח מנתח שוט מול שוט. כאן מסתכלים על התמונה הגדולה: מה הבעיה שחוזרת
// אליך שוב ושוב, באיזה הקשר היא מרוכזת (רמת קלייה, גיל קלייה, מטחנה),
// ומה מבין התיקונים באמת פתר אותה בפועל — לפי מה שקרה בשוט הבא.
//
// "מה עבד" נמדד מהפרמטרים בפועל ולא מההמלצה השמורה, כדי שגם שוטים
// ישנים (לפני שהמוח נוסף) ייכנסו לניתוח.

export type ProblemKind = 'sour' | 'bitter' | 'dry' | 'watery' | 'channeling';

const PROBLEM_LABELS: Record<ProblemKind, string> = {
  sour: 'חמיצות',
  bitter: 'מרירות',
  dry: 'יובש / עפיצות',
  watery: 'טעם מימי',
  channeling: 'תיעול (חמוץ ומר יחד)',
};

// סוג השינוי שבוצע בין שוט לשוט — נגזר מהפרמטרים עצמם
export type FixKind = 'grind' | 'yield' | 'dose' | 'temp' | 'multi' | 'none';

const FIX_LABELS: Record<FixKind, string> = {
  grind: 'שינוי דרגת טחינה',
  yield: 'שינוי Yield',
  dose: 'שינוי מנה (Dose)',
  temp: 'שינוי טמפרטורה',
  multi: 'כמה שינויים יחד',
  none: 'חזרה על אותם פרמטרים',
};

// ספי זיהוי שינוי — זהים לאלה שבמוח (aiEngine/adviceAudit) כדי שלא
// ייווצרו שתי הגדרות שונות ל"מה נחשב שינוי".
const GRIND_EPS = 0.01;
const YIELD_EPS = 1.5;
const DOSE_EPS = 0.4;

export interface ProblemContext {
  label: string;
  count: number;
  share: number; // אחוז מהמופעים של הבעיה
  overIndexed: boolean; // מרוכז כאן יותר מהמצפה לפי נתח השוטים הכללי
}

export interface FixOutcome {
  kind: FixKind;
  label: string;
  attempts: number;
  resolved: number; // הבעיה לא חזרה בשוט הבא
  resolveRate: number; // 0–100
}

export interface RecurringProblem {
  kind: ProblemKind;
  label: string;
  count: number;
  share: number; // אחוז מכל השוטים המדורגים
  avgRating: number;
  contexts: ProblemContext[];
  fixes: FixOutcome[]; // ממוין: הכי מוצלח קודם
  bestFix: FixOutcome | null; // התיקון עם אחוז הפתרון הגבוה (מינימום נסיונות)
}

const ROAST_LABELS: Record<RoastLevel, string> = {
  'light': 'קלייה בהירה',
  'light-medium': 'קלייה בהירה-בינונית',
  'medium': 'קלייה בינונית',
  'medium-dark': 'קלייה בינונית-כהה',
  'dark': 'קלייה כהה',
};

// דלי גיל קלייה — שלבי החיים של הפולים
function roastAgeBucket(days: number | null): string | null {
  if (days === null) return null;
  if (days < 5) return 'שבוע ראשון אחרי קלייה (Degassing)';
  if (days <= 14) return 'שיא הטריות (5–14 יום)';
  if (days <= 30) return 'בשלים (15–30 יום)';
  return 'מעל 30 יום מהקלייה';
}

function hasProblem(s: Shot, kind: ProblemKind): boolean {
  const tags = new Set<TasteTag>(s.tasteTags);
  if (kind === 'channeling') return tags.has('sour') && tags.has('bitter');
  // חמוץ+מר יחד מסווג כתיעול ולא כחמיצות/מרירות נפרדות — כמו במוח
  if (tags.has('sour') && tags.has('bitter')) return false;
  return tags.has(kind as TasteTag);
}

// מה שונה בין שני שוטים עוקבים
export function detectFix(prev: Shot, next: Shot): FixKind {
  const changed: FixKind[] = [];
  if (Math.abs(next.grindSetting - prev.grindSetting) > GRIND_EPS) changed.push('grind');
  if (Math.abs(next.yieldGrams - prev.yieldGrams) >= YIELD_EPS) changed.push('yield');
  if (Math.abs(next.doseGrams - prev.doseGrams) >= DOSE_EPS) changed.push('dose');
  if (next.machineTemp !== prev.machineTemp) changed.push('temp');
  if (changed.length === 0) return 'none';
  if (changed.length === 1) return changed[0];
  return 'multi';
}

// מינימומים כדי לא להסיק ממדגם זעיר
const MIN_SHOTS = 8;
const MIN_OCCURRENCES = 3;
const MIN_FIX_ATTEMPTS = 2;

export function analyzeRecurringProblems(params: {
  shots: Shot[];
  beans: Bean[];
  bags: Bag[];
}): RecurringProblem[] {
  const rated = params.shots.filter((s) => s.rating > 0);
  if (rated.length < MIN_SHOTS) return [];

  const beanMap = new Map(params.beans.map((b) => [b.id, b]));
  const bagMap = new Map(params.bags.map((b) => [b.id, b]));

  const roastAgeAt = (s: Shot): number | null => {
    const roastDate = bagMap.get(s.bagId)?.roastDate;
    if (!roastDate) return null;
    const d = Math.floor(
      (new Date(s.createdAt).getTime() - new Date(roastDate).getTime()) / 86_400_000,
    );
    return Number.isNaN(d) ? null : d;
  };

  // רצפים לפי פולים+מטחנה, מהישן לחדש — כדי למצוא "השוט הבא" האמיתי
  const chains = new Map<string, Shot[]>();
  for (const s of rated) {
    const k = `${s.beanId}|${s.grinderId}`;
    if (!chains.has(k)) chains.set(k, []);
    chains.get(k)!.push(s);
  }
  for (const c of chains.values()) c.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const nextOf = new Map<string, Shot>();
  for (const c of chains.values()) {
    for (let i = 0; i < c.length - 1; i++) nextOf.set(c[i].id, c[i + 1]);
  }

  // התפלגות בסיס של ההקשרים על כל השוטים — כדי לדעת מה "מעל המצופה"
  const baseCounts = new Map<string, number>();
  const bumpBase = (label: string | null) => {
    if (label) baseCounts.set(label, (baseCounts.get(label) ?? 0) + 1);
  };
  for (const s of rated) {
    const bean = beanMap.get(s.beanId);
    bumpBase(bean ? ROAST_LABELS[bean.roastLevel] : null);
    bumpBase(roastAgeBucket(roastAgeAt(s)));
  }

  const kinds: ProblemKind[] = ['sour', 'bitter', 'dry', 'watery', 'channeling'];
  const out: RecurringProblem[] = [];

  for (const kind of kinds) {
    const hits = rated.filter((s) => hasProblem(s, kind));
    if (hits.length < MIN_OCCURRENCES) continue;

    // ---- הקשרים: איפה הבעיה מרוכזת ----
    const ctxCounts = new Map<string, number>();
    const bump = (label: string | null) => {
      if (label) ctxCounts.set(label, (ctxCounts.get(label) ?? 0) + 1);
    };
    for (const s of hits) {
      const bean = beanMap.get(s.beanId);
      bump(bean ? ROAST_LABELS[bean.roastLevel] : null);
      bump(roastAgeBucket(roastAgeAt(s)));
    }
    const contexts: ProblemContext[] = [...ctxCounts.entries()]
      .map(([label, count]) => {
        const share = Math.round((count / hits.length) * 100);
        const baseShare = ((baseCounts.get(label) ?? 0) / rated.length) * 100;
        return { label, count, share, overIndexed: share > baseShare + 12 };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // ---- מה עבד: לכל מופע, מה שונה בשוט הבא והאם הבעיה נעלמה ----
    const attempts = new Map<FixKind, { attempts: number; resolved: number }>();
    for (const s of hits) {
      const next = nextOf.get(s.id);
      if (!next) continue;
      const fix = detectFix(s, next);
      const rec = attempts.get(fix) ?? { attempts: 0, resolved: 0 };
      rec.attempts += 1;
      if (!hasProblem(next, kind)) rec.resolved += 1;
      attempts.set(fix, rec);
    }
    const fixes: FixOutcome[] = [...attempts.entries()]
      .map(([kindOfFix, r]) => ({
        kind: kindOfFix,
        label: FIX_LABELS[kindOfFix],
        attempts: r.attempts,
        resolved: r.resolved,
        resolveRate: Math.round((r.resolved / r.attempts) * 100),
      }))
      .sort((a, b) => b.resolveRate - a.resolveRate || b.attempts - a.attempts);

    // התיקון המומלץ: הכי מוצלח מבין אלה שנוסו מספיק פעמים, ולא "בלי שינוי"
    const bestFix =
      fixes.find((f) => f.attempts >= MIN_FIX_ATTEMPTS && f.kind !== 'none' && f.resolveRate >= 50) ??
      null;

    out.push({
      kind,
      label: PROBLEM_LABELS[kind],
      count: hits.length,
      share: Math.round((hits.length / rated.length) * 100),
      avgRating: hits.reduce((a, s) => a + s.rating, 0) / hits.length,
      contexts,
      fixes,
      bestFix,
    });
  }

  return out.sort((a, b) => b.count - a.count);
}
