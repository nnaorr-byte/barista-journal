// עוזרי תאריכים משותפים.
//
// daysSince ישב ב-recommendation.ts, ו-freshness.ts ייבא אותו משם. ברגע
// ש-recommendation.ts נזקק לסוג הקלייה (שחי ב-freshness.ts) זה היה הופך
// למעגל ייבוא. הפונקציה עצמה לא שייכת לאף אחד מהשניים.

export function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}
