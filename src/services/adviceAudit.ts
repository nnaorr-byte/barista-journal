import type { AiAdvice, Shot } from '../domain/types';

// ===== ביקורת המלצות: המוח בודק את עצמו =====
// כל שוט נושא את ההמלצה שניתנה עליו (aiAdvice). השוט הבא באותם
// פולים+מטחנה מגלה אם ההמלצה יושמה — ואם היא עבדה.

export interface AdviceOutcome {
  shotId: string; // השוט שעליו ניתנה ההמלצה
  nextShotId: string; // השוט שבו נבחנה
  changeKind: AiAdvice['changeKind'];
  changeLabel: string;
  followed: boolean; // הפרמטרים של השוט הבא תואמים את היעדים
  improved: boolean; // הדירוג עלה (או נשמר, כשההמלצה הייתה "ללא שינוי")
  ratingFrom: number;
  ratingTo: number;
}

// המלצות מדידות בלבד — prep/recipe לא ניתנות לשיפוט מהפרמטרים
const MEASURABLE: AiAdvice['changeKind'][] = ['none', 'grind', 'yield', 'dose', 'temp'];

// האם השוט הבא יישם את יעדי ההמלצה (עם סובלנות מדידה סבירה)
export function isAdviceFollowed(advice: AiAdvice, next: Shot): boolean {
  const t = advice.targets;
  switch (advice.changeKind) {
    case 'grind':
      return Math.abs(next.grindSetting - t.grindSetting) <= 0.26;
    case 'yield':
      return Math.abs(next.yieldGrams - t.yieldGrams) <= 2;
    case 'dose':
      return Math.abs(next.doseGrams - t.doseGrams) <= 0.3;
    case 'temp':
      return t.machineTemp != null && next.machineTemp === t.machineTemp;
    case 'none':
      // "אל תשנה דבר" — יושם אם באמת לא שונה דבר מהותי
      return (
        Math.abs(next.grindSetting - t.grindSetting) <= 0.01 &&
        Math.abs(next.doseGrams - t.doseGrams) <= 0.5 &&
        Math.abs(next.yieldGrams - t.yieldGrams) <= 2.5
      );
    default:
      return false;
  }
}

// ביקורת על היסטוריה אחת (אותם פולים+מטחנה), ממוינת מהישן לחדש
export function auditAdviceHistory(history: Shot[]): AdviceOutcome[] {
  const out: AdviceOutcome[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    const advice = history[i].aiAdvice;
    if (!advice || !MEASURABLE.includes(advice.changeKind)) continue;
    const next = history[i + 1];
    if (!history[i].rating || !next.rating) continue;
    const followed = isAdviceFollowed(advice, next);
    const improved = advice.changeKind === 'none'
      ? next.rating >= history[i].rating // "שמור על המתכון" מצליחה אם הרמה נשמרה
      : next.rating > history[i].rating;
    out.push({
      shotId: history[i].id,
      nextShotId: next.id,
      changeKind: advice.changeKind,
      changeLabel: advice.changeLabel,
      followed,
      improved,
      ratingFrom: history[i].rating,
      ratingTo: next.rating,
    });
  }
  return out;
}

// ביקורת גלובלית: מקבץ לפי פולים+מטחנה
export function auditAllAdvice(shots: Shot[]): AdviceOutcome[] {
  const groups = new Map<string, Shot[]>();
  for (const s of shots) {
    const k = `${s.beanId}|${s.grinderId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const out: AdviceOutcome[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    out.push(...auditAdviceHistory(g));
  }
  return out;
}

// התוצאה עבור שוט בודד ביומן: מה קרה להמלצה שניתנה עליו
export function adviceOutcomeForShot(
  shot: Shot,
  advice: AiAdvice | null,
  allShots: Shot[],
): AdviceOutcome | null {
  if (!advice || !MEASURABLE.includes(advice.changeKind) || !shot.rating) return null;
  const next = allShots
    .filter((s) => s.beanId === shot.beanId && s.grinderId === shot.grinderId && s.createdAt > shot.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next || !next.rating) return null;
  const followed = isAdviceFollowed(advice, next);
  const improved = advice.changeKind === 'none' ? next.rating >= shot.rating : next.rating > shot.rating;
  return {
    shotId: shot.id,
    nextShotId: next.id,
    changeKind: advice.changeKind,
    changeLabel: advice.changeLabel,
    followed,
    improved,
    ratingFrom: shot.rating,
    ratingTo: next.rating,
  };
}
