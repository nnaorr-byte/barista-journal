import { shotRatio, type Bag, type Bean, type Shot } from '../domain/types';

// שירות סטטיסטיקה: חישובי Dashboard, צריכת פולים ועלות לשוט.

export interface BagUsage {
  bag: Bag;
  shotsCount: number;
  gramsUsed: number;
  gramsLeft: number;
  costPerShot: number | null;
}

export function computeBagUsage(bag: Bag, shots: Shot[]): BagUsage {
  const bagShots = shots.filter((s) => s.bagId === bag.id);
  const gramsUsed = bagShots.reduce((a, s) => a + s.doseGrams, 0);
  const gramsLeft = Math.max(0, bag.weightGrams - gramsUsed);
  const costPerShot =
    bag.price !== null && bag.weightGrams > 0 && bagShots.length > 0
      ? (bag.price * (gramsUsed / bag.weightGrams)) / bagShots.length
      : null;
  return { bag, shotsCount: bagShots.length, gramsUsed, gramsLeft, costPerShot };
}

export interface MonthlyStats {
  month: string; // "2026-07"
  shots: number;
  avgRating: number;
}

export function monthlyBreakdown(shots: Shot[]): MonthlyStats[] {
  const byMonth = new Map<string, Shot[]>();
  for (const s of shots) {
    const month = s.createdAt.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(s);
    byMonth.set(month, arr);
  }
  return [...byMonth.entries()]
    .map(([month, arr]) => ({
      month,
      shots: arr.length,
      avgRating: arr.reduce((a, s) => a + s.rating, 0) / arr.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface BeanComparison {
  bean: Bean;
  shots: number;
  avgRating: number;
  bestRating: number;
  avgRatio: number;
  avgTime: number;
}

export function compareBeans(beans: Bean[], shots: Shot[]): BeanComparison[] {
  return beans
    .map((bean) => {
      const beanShots = shots.filter((s) => s.beanId === bean.id);
      if (beanShots.length === 0) return null;
      return {
        bean,
        shots: beanShots.length,
        avgRating: beanShots.reduce((a, s) => a + s.rating, 0) / beanShots.length,
        bestRating: Math.max(...beanShots.map((s) => s.rating)),
        avgRatio: beanShots.reduce((a, s) => a + shotRatio(s), 0) / beanShots.length,
        avgTime: beanShots.reduce((a, s) => a + s.brewTimeSec, 0) / beanShots.length,
      };
    })
    .filter((b): b is BeanComparison => b !== null)
    .sort((a, b) => b.avgRating - a.avgRating);
}

export function topShots(shots: Shot[], n: number, worst = false): Shot[] {
  const sorted = [...shots].sort((a, b) =>
    worst ? a.rating - b.rating : b.rating - a.rating,
  );
  return sorted.slice(0, n);
}

// זיהוי מגמה: משווה את ממוצע 10 השוטים האחרונים ל-10 שלפניהם
export interface Trend {
  direction: 'up' | 'down' | 'stable' | 'insufficient';
  recentAvg: number;
  previousAvg: number;
}

export function ratingTrend(shotsNewestFirst: Shot[]): Trend {
  if (shotsNewestFirst.length < 6) {
    return { direction: 'insufficient', recentAvg: 0, previousAvg: 0 };
  }
  const half = Math.min(10, Math.floor(shotsNewestFirst.length / 2));
  const recent = shotsNewestFirst.slice(0, half);
  const previous = shotsNewestFirst.slice(half, half * 2);
  const recentAvg = recent.reduce((a, s) => a + s.rating, 0) / recent.length;
  const previousAvg = previous.reduce((a, s) => a + s.rating, 0) / previous.length;
  const diff = recentAvg - previousAvg;
  return {
    direction: diff > 0.4 ? 'up' : diff < -0.4 ? 'down' : 'stable',
    recentAvg,
    previousAvg,
  };
}
