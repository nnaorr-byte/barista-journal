import { shotRatio, shotFlowRate, type Shot, type TasteTag, type RoastLevel } from '../domain/types';

// מנוע הלמידה האישית: מחלץ מההיסטוריה את הפרמטרים שמניבים
// את הדירוגים הגבוהים ביותר. עובד על ממוצע משוקלל לפי דירוג,
// כך ששוטים טובים "מושכים" את ההמלצה חזק יותר.

export interface PersonalInsights {
  shotCount: number;
  avgRating: number;
  bestShot: Shot | null;
  sweetSpot: {
    dose: number | null;
    yield: number | null;
    ratio: number | null;
    brewTime: number | null;
  };
  favoriteBeanIds: { beanId: string; avgRating: number; count: number }[];
  roastPreference: { roastLevel: RoastLevel; avgRating: number; count: number }[];
  tasteProfile: { tag: TasteTag; count: number; avgRating: number }[];
}

const MIN_RATING_FOR_LEARNING = 6; // לומדים רק משוטים מוצלחים יחסית

function weightedAvg(shots: Shot[], pick: (s: Shot) => number): number | null {
  const good = shots.filter((s) => s.rating >= MIN_RATING_FOR_LEARNING && pick(s) > 0);
  if (good.length === 0) return null;
  let sum = 0;
  let weights = 0;
  for (const s of good) {
    // משקל מעריכי לפי דירוג: שוט 10 משפיע פי ~4 משוט 6
    const w = Math.pow(1.6, s.rating - MIN_RATING_FOR_LEARNING);
    sum += pick(s) * w;
    weights += w;
  }
  return sum / weights;
}

export function computeInsights(
  shots: Shot[],
  beanRoastLevels: Map<string, RoastLevel>,
): PersonalInsights {
  const shotCount = shots.length;
  const avgRating = shotCount ? shots.reduce((a, s) => a + s.rating, 0) / shotCount : 0;
  const bestShot = shots.reduce<Shot | null>(
    (best, s) => (best === null || s.rating > best.rating ? s : best),
    null,
  );

  // פולים מועדפים
  const byBean = new Map<string, Shot[]>();
  for (const s of shots) {
    const arr = byBean.get(s.beanId) ?? [];
    arr.push(s);
    byBean.set(s.beanId, arr);
  }
  const favoriteBeanIds = [...byBean.entries()]
    .map(([beanId, arr]) => ({
      beanId,
      avgRating: arr.reduce((a, s) => a + s.rating, 0) / arr.length,
      count: arr.length,
    }))
    .filter((b) => b.count >= 2)
    .sort((a, b) => b.avgRating - a.avgRating);

  // העדפת קלייה
  const byRoast = new Map<RoastLevel, Shot[]>();
  for (const s of shots) {
    const roast = beanRoastLevels.get(s.beanId);
    if (!roast) continue;
    const arr = byRoast.get(roast) ?? [];
    arr.push(s);
    byRoast.set(roast, arr);
  }
  const roastPreference = [...byRoast.entries()]
    .map(([roastLevel, arr]) => ({
      roastLevel,
      avgRating: arr.reduce((a, s) => a + s.rating, 0) / arr.length,
      count: arr.length,
    }))
    .sort((a, b) => b.avgRating - a.avgRating);

  // פרופיל טעם: אילו טעמים מופיעים בשוטים עם דירוג גבוה
  const byTag = new Map<TasteTag, { count: number; ratingSum: number }>();
  for (const s of shots) {
    for (const tag of s.tasteTags) {
      const e = byTag.get(tag) ?? { count: 0, ratingSum: 0 };
      e.count += 1;
      e.ratingSum += s.rating;
      byTag.set(tag, e);
    }
  }
  const tasteProfile = [...byTag.entries()]
    .map(([tag, e]) => ({ tag, count: e.count, avgRating: e.ratingSum / e.count }))
    .sort((a, b) => b.avgRating - a.avgRating);

  return {
    shotCount,
    avgRating,
    bestShot,
    sweetSpot: {
      dose: weightedAvg(shots, (s) => s.doseGrams),
      yield: weightedAvg(shots, (s) => s.yieldGrams),
      ratio: weightedAvg(shots, (s) => shotRatio(s)),
      brewTime: weightedAvg(shots, (s) => s.brewTimeSec),
    },
    favoriteBeanIds,
    roastPreference,
    tasteProfile,
  };
}

// חוזק הלמידה לפי כמות נתונים — קובע כמה ההמלצה נשענת על ההיסטוריה
export function learningConfidence(relevantShots: number): 'rules' | 'low' | 'medium' | 'high' {
  if (relevantShots === 0) return 'rules';
  if (relevantShots < 5) return 'low';
  if (relevantShots < 15) return 'medium';
  return 'high';
}

export { shotRatio, shotFlowRate };
