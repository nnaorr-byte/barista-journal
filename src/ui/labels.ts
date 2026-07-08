import type { FlavorNote, MachineTempSetting, QualityLevel, RoastLevel, TasteTag } from '../domain/types';

export const TASTE_LABELS: Record<TasteTag, string> = {
  sour: 'חמוץ',
  bitter: 'מר',
  balanced: 'מאוזן',
  sweet: 'מתוק',
  dry: 'יבש',
  watery: 'מימי',
  other: 'אחר',
};

export const FLAVOR_LABELS: Record<FlavorNote, string> = {
  fruity: '🍑 פירותי',
  citrus: '🍋 הדרים',
  berries: '🫐 פירות יער',
  floral: '🌸 פרחוני',
  chocolate: '🍫 שוקולד',
  caramel: '🍮 קרמל',
  nutty: '🥜 אגוזי',
  honey: '🍯 דבש',
  vanilla: '🌾 וניל',
  spices: '🌶️ תבלינים',
  earthy: '🪵 אדמתי',
  smoky: '💨 מעושן',
  winey: '🍷 ייני',
  buttery: '🧈 חמאתי',
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

// תצוגת משקלים אחידה: "16←36 גרם" + ציון העצירה בפועל אם תועדה
export function shotWeights(s: {
  doseGrams: number;
  yieldGrams: number;
  yieldStopGrams?: number | null;
}): string {
  const stop = s.yieldStopGrams ? ` (עצירה ב-${s.yieldStopGrams})` : '';
  return `${s.doseGrams}←${s.yieldGrams} גרם${stop}`;
}
