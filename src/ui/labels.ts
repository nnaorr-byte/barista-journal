import type { MachineTempSetting, QualityLevel, RoastLevel, Shot, TasteTag } from '../domain/types';

export const TASTE_LABELS: Record<TasteTag, string> = {
  sour: 'חמוץ',
  bitter: 'מר',
  balanced: 'מאוזן',
  sweet: 'מתוק',
  dry: 'יבש',
  watery: 'מימי',
  flat: 'חסר מתיקות',
  other: 'אחר',
};

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  poor: 'חלש',
  ok: 'סביר',
  good: 'טוב',
  excellent: 'מצוין',
};

export const TEMP_LABELS: Record<MachineTempSetting, string> = {
  low: 'נמוכה',
  medium: 'בינונית (Medium)',
  high: 'גבוהה',
};

export const ROAST_LEVELS: { value: RoastLevel; label: string }[] = [
  { value: 'light', label: 'בהירה' },
  { value: 'light-medium', label: 'בהירה-בינונית' },
  { value: 'medium', label: 'בינונית' },
  { value: 'medium-dark', label: 'בינונית-כהה' },
  { value: 'dark', label: 'כהה' },
];

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function ratingClass(rating: number): string {
  return rating >= 7 ? 'good' : rating >= 5 ? 'mid' : 'bad';
}

// שורה אחת במסלול הכיול: מה הוזן בשוט, ולאן המוח שלח אחריו.
// ה"לאן" נגזר מהיעדים שנשמרו עם השוט ולא מ-changeLabel — כי המספר עצמו
// ("טחינה 18") הוא מה שמעניין במבט לאחור, לא שם הפעולה.
export function dialInStepLine(shot: Shot): { input: string; next: string } {
  const taste = shot.tasteTags.map((t) => TASTE_LABELS[t]).filter(Boolean).join(', ');
  const input =
    `${shot.brewTimeSec || '—'}ש · טחינה ${shot.grindSetting} · ${shot.yieldGrams}ג · ` +
    `${taste || 'לא תויג'} ${shot.rating}/10`;

  const t = shot.aiAdvice?.targets;
  if (!t) return { input, next: '—' };
  const moves: string[] = [];
  if (Math.abs(t.grindSetting - shot.grindSetting) >= 0.01) moves.push(`טחינה ${t.grindSetting}`);
  if (Math.abs(t.yieldGrams - shot.yieldGrams) >= 0.5) moves.push(`Yield ${t.yieldGrams}`);
  if (Math.abs(t.doseGrams - shot.doseGrams) >= 0.1) moves.push(`מנה ${t.doseGrams}`);
  if (moves.length === 0) {
    return { input, next: shot.aiAdvice?.changeKind === 'prep' ? 'הכנה' : 'ללא שינוי' };
  }
  return { input, next: moves.join(' · ') };
}

// תצוגת משקלים אחידה: "16←36 גרם" + ציון העצירה בפועל אם תועדה
export function shotWeights(s: {
  doseGrams: number;
  yieldGrams: number;
  yieldStopGrams?: number | null;
}): string {
  const stop = s.yieldStopGrams ? ` (עצירה ב-${s.yieldStopGrams})` : '';
  return `${s.doseGrams}←${s.yieldGrams} גרם${stop}`;
}
