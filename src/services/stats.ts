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

// ===== חלון היעד ("הדופק שלך") =====
// שוט "בחלון היעד" = גם זמן חליטה בטווח הקלאסי וגם דירוג מצוין.
// זהו המדד ל"עקביות אמיתית" — לא רק שוט טוב במקרה, אלא שוט מכוון שהצליח.
export const TARGET_TIME_MIN = 22;
export const TARGET_TIME_MAX = 32;
export const TARGET_RATING = 8;

export function isInTarget(s: Shot): boolean {
  return (
    s.brewTimeSec >= TARGET_TIME_MIN &&
    s.brewTimeSec <= TARGET_TIME_MAX &&
    s.rating >= TARGET_RATING
  );
}

// ===== סיכום שבועי =====
// שבוע ישראלי: ראשון–שבת, בזמן מקומי.

export function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export interface WeeklySummary {
  start: Date;
  end: Date; // לא כולל (תחילת השבוע הבא)
  count: number;
  avgRating: number | null;
  bestShot: Shot | null;
  days: number[]; // שוטים לכל יום, א'–ש'
  dayAvgRatings: (number | null)[]; // דירוג ממוצע לכל יום
  daysWithCoffee: number;
  prevCount: number;
  prevAvg: number | null;
  // הדופק שלך: אחוז השוטים בחלון היעד (זמן 22–32 שנ' + דירוג 8+)
  inTargetCount: number;
  inTargetPct: number | null;
  prevInTargetPct: number | null;
}

// offset=0 → השבוע הנוכחי, 1 → שעבר, וכן הלאה
export function weeklySummary(shots: Shot[], offset = 0): WeeklySummary {
  const start = weekStart(new Date());
  start.setDate(start.getDate() - 7 * offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - 7);

  const inRange = (s: Shot, a: Date, b: Date) => {
    const t = new Date(s.createdAt);
    return t >= a && t < b;
  };
  const wk = shots.filter((s) => inRange(s, start, end));
  const prev = shots.filter((s) => inRange(s, prevStart, start));

  const days = Array(7).fill(0) as number[];
  const sums = Array(7).fill(0) as number[];
  const cnts = Array(7).fill(0) as number[];
  for (const s of wk) {
    const d = new Date(s.createdAt).getDay();
    days[d] += 1;
    if (s.rating > 0) { sums[d] += s.rating; cnts[d] += 1; }
  }
  const rated = wk.filter((s) => s.rating > 0);
  const prevRated = prev.filter((s) => s.rating > 0);
  const inTargetCount = wk.filter(isInTarget).length;
  return {
    start,
    end,
    count: wk.length,
    avgRating: rated.length ? rated.reduce((a, s) => a + s.rating, 0) / rated.length : null,
    bestShot: rated.length ? [...rated].sort((a, b) => b.rating - a.rating)[0] : null,
    days,
    dayAvgRatings: cnts.map((c, i) => (c ? sums[i] / c : null)),
    daysWithCoffee: days.filter(Boolean).length,
    prevCount: prev.length,
    prevAvg: prevRated.length ? prevRated.reduce((a, s) => a + s.rating, 0) / prevRated.length : null,
    inTargetCount,
    inTargetPct: wk.length ? Math.round((inTargetCount / wk.length) * 100) : null,
    prevInTargetPct: prev.length
      ? Math.round((prev.filter(isInTarget).length / prev.length) * 100)
      : null,
  };
}

// כמה שבועות אחורה יש נתונים (לגבולות הדפדוף במסך הסיכום)
export function weeksBackWithData(shots: Shot[]): number {
  if (shots.length === 0) return 0;
  const oldest = shots.reduce((m, s) => (s.createdAt < m ? s.createdAt : m), shots[0].createdAt);
  const cur = weekStart(new Date()).getTime();
  const old = weekStart(new Date(oldest)).getTime();
  return Math.max(0, Math.round((cur - old) / (7 * 86400000)));
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
