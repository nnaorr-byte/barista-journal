import { shotRatio, type Bag, type Bean, type Grinder, type Shot } from '../domain/types';
import { analyzable, chokeFloor } from './shotFilter';
import { computeAgingSlope, roastAgeDays, type AgingSlope } from './aging';
import { isInTarget, TARGET_RATING } from './stats';
import type { WindowResolver } from './targetWindow';

// ============================================================
// ניתוח טחינה — מה דרגת הטחינה תרמה, על פולים אחד
// ============================================================
// השאלה: מבין דרגות הטחינה שניסית על הפולים האלה, איזו עבדה, כמה שניות
// שווה צעד אחד, ומה המסקנה. כל השקיות של אותם פולים נכנסות — לכל שוט
// מחושב גיל הקלייה של השקית *שלו*, כך שערבוב שקיות לא מזייף את הזמן.
//
// שני מקורות רעש עומדים בין הטחינה לבין הזמן, ושניהם נמדדו כאן קודם:
//   1. גיל הקלייה. הגזים מאטים את הזרימה, והזמן מתקצר עם הימים בלי שנגעת
//      בטחינה. מנוטרל דרך computeAgingSlope — כשהוא מדיד.
//   2. ההכנה. הפיזור הטבעי על הגדרות זהות הוא 4–5 שניות.
//
// לכן המודול הזה **מסרב להכריז מנצחת** כשההפרש קטן מהרעש. "אין הכרעה"
// הוא תשובה תקפה, ולעיתים קרובות התשובה הנכונה.

// פער דירוג מינימלי שנחשב מורגש בכוס. מתחת לזה גם מדגם ענק לא מעניין.
const MIN_RATING_GAP = 0.4;
// כמה שגיאות תקן צריך הפער לעבור כדי שלא יהיה צירוף מקרים
const SE_MULTIPLIER = 2;
// דרגה נכנסת להשוואה רק עם מספיק שוטים — שוט בודד אינו ממוצע
const MIN_SHOTS_PER_GRIND = 2;
// מינימום לרגרסיית זמן-מול-טחינה
const MIN_TIME_SHOTS = 6;
const MIN_TIME_R = 0.5;
// צעד טחינה שמזיז פחות משנייה אינו כלי עבודה
const MIN_SEC_PER_STEP = 1;

export interface GrindRow {
  grindSetting: number;
  shots: number;
  avgRating: number;
  ratingStdev: number;
  /**
   * זמן העצירה **כפי שנמדד**, ממוצע כשיש כמה שוטים. גולמי בכוונה:
   * העמודה הזאת היא מה שקרה בכוס, ומספר מתוקנן שמתחזה למדידה שולח
   * לחפש שוט שלא היה. תיקון הגיל חי רק ברגרסיה למטה, שם הוא נחוץ
   * כדי להפריד את הטחינה מהגזים.
   */
  avgTimeSec: number | null;
  minTimeSec: number | null;
  maxTimeSec: number | null;
  avgRatio: number | null;
  excellentPct: number;
  inTargetPct: number | null;
  isCurrent: boolean;
}

/** רצועת זמן חילוץ אחת, עם הטחינה שייצרה אותה */
export interface TimeBand {
  from: number;
  to: number;
  shots: number;
  avgRating: number;
  ratingStdev: number;
  grindMode: number;
  grindMin: number;
  grindMax: number;
}

/**
 * זמן החילוץ המנצח — לא "איפה נחתו הטובים" אלא ההפך: מחלקים את **כל**
 * השוטים לרצועות זמן ושואלים איזו רצועה מייצרת את הדירוג הגבוה ביותר.
 * ההבדל מהותי: SweetSpot מסתכל על הטובים ומתאר אותם, וזה מסתכל על הכול
 * ומשווה. רצועה עם דירוג גבוה ושוט אחד לא תנצח כאן.
 */
export interface WinningTime {
  bands: TimeBand[]; // ממוינות מהדירוג הגבוה לנמוך
  best: TimeBand;
  runnerUp: TimeBand | null;
  decisive: boolean;
  delta: number;
  se: number;
}

/** האזור שבו נחתו השוטים הטובים — טווח טחינה וטווח זמן, לא נקודה אחת */
export interface SweetSpot {
  shots: number;
  minRating: number;
  grindMin: number;
  grindMax: number;
  grindMode: number; // הדרגה שחוזרת הכי הרבה בין הטובים
  timeMin: number;
  timeMax: number;
  timeAvg: number;
}

export interface TimeVsGrind {
  secPerStep: number; // שניות לכל צעד אחד בסקאלת המטחנה
  r: number;
  shots: number;
  grinds: number;
  step: number; // צעד הסקאלה של המטחנה ששימשה
  meaningful: boolean;
}

export interface GrindVerdict {
  decisive: boolean;
  best: number;
  other: number;
  deltaRating: number;
  se: number;
  bestInTargetPct: number | null;
  otherInTargetPct: number | null;
}

export interface BestShotPick {
  shot: Shot;
  roastAge: number | null;
}

export interface GrindAnalysis {
  beanName: string;
  totalShots: number;
  rows: GrindRow[];
  time: TimeVsGrind | null;
  verdict: GrindVerdict | null;
  best: BestShotPick | null;
  sweetSpot: SweetSpot | null;
  winningTime: WinningTime | null;
  floor: number | null;
  slope: AgingSlope | null;
  /** האם הרגרסיה הצליחה לנטרל את שיפוע ההזדקנות (הטבלה תמיד גולמית) */
  ageAdjusted: boolean;
  conclusions: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- ניתוח ----
// rawShots: כל השוטים של אותם פולים, גולמיים. השוטים החנוקים נחוצים
// לקיר הדק ולכן אסור לסנן אותם לפני הכניסה לכאן.
export function analyzeGrind({
  rawShots, bags, bean, grinders, resolveWindow,
}: {
  rawShots: Shot[];
  bags: Bag[];
  bean: Bean | undefined;
  grinders: Grinder[];
  resolveWindow: WindowResolver;
}): GrindAnalysis | null {
  const usable = analyzable(rawShots).filter((s) => s.grindSetting > 0 && s.rating > 0);
  const byGrind = new Map<number, Shot[]>();
  for (const s of usable) {
    const list = byGrind.get(s.grindSetting);
    if (list) list.push(s);
    else byGrind.set(s.grindSetting, [s]);
  }
  // פחות משתי דרגות = לא שינית טחינה, ואין מה להשוות
  if (byGrind.size < 2) return null;

  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const timed = usable.filter((s) => s.brewTimeSec > 0);

  // ---- נטרול גיל ----
  // שיפוע גלובלי לפולים האלה ולא מקומי בציר הגיל: כאן מתקנים על פני כל
  // טווח הגילאים שנצפה, ושיפוע מקומי לא היה חל על קצותיו. משמש רק כשהוא
  // meaningful, ואחרת הזמנים נשארים גולמיים ונאמר כך בפירוש.
  const slope = computeAgingSlope(timed, bags, null);
  const ages = timed
    .map((s) => roastAgeDays(s, bagMap.get(s.bagId)))
    .filter((a): a is number => a !== null);
  const refAge = median(ages);
  const ageAdjusted = !!slope?.meaningful && ages.length > 0;
  const adjTime = (s: Shot): number => {
    if (!ageAdjusted || !slope) return s.brewTimeSec;
    const age = roastAgeDays(s, bagMap.get(s.bagId));
    if (age === null) return s.brewTimeSec;
    return s.brewTimeSec - slope.secPerDay * (age - refAge);
  };

  // ---- שורות הטבלה ----
  const currentGrind = [...usable].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.grindSetting;
  const rows: GrindRow[] = [...byGrind.entries()]
    .map(([grindSetting, list]) => {
      const withTime = list.filter((s) => s.brewTimeSec > 0);
      const times = withTime.map((s) => s.brewTimeSec);
      const ratings = list.map((s) => s.rating);
      const inTarget = withTime.filter((s) => isInTarget(s, resolveWindow(s))).length;
      return {
        grindSetting,
        shots: list.length,
        avgRating: round1(mean(ratings)),
        ratingStdev: stdev(ratings),
        avgTimeSec: times.length ? round1(mean(times)) : null,
        minTimeSec: times.length ? Math.min(...times) : null,
        maxTimeSec: times.length ? Math.max(...times) : null,
        avgRatio: withTime.length ? round1(mean(withTime.map((s) => shotRatio(s)))) : null,
        excellentPct: Math.round((list.filter((s) => s.rating >= TARGET_RATING).length / list.length) * 100),
        inTargetPct: withTime.length ? Math.round((inTarget / withTime.length) * 100) : null,
        isCurrent: grindSetting === currentGrind,
      };
    })
    // דק→גס. זו הקריאה הטבעית של הסקאלה: למעלה חונקים, למטה זורם מהר
    .sort((a, b) => a.grindSetting - b.grindSetting);

  // ---- כמה שניות שווה צעד טחינה ----
  const step = dominantGrinderStep(timed, grinders);
  const time = regressTimeOnGrind(timed, adjTime, step);

  // ---- מי טובה יותר ----
  const verdict = compareTopTwo(rows);

  // ---- השוט הכי טוב, והאזור שבו נחתו הטובים ----
  const best = pickBestShot(usable, resolveWindow, bagMap);
  const sweetSpot = findSweetSpot(timed);
  const winningTime = findWinningTime(timed);

  const floor = chokeFloor(rawShots);
  return {
    beanName: bean?.name ?? 'פולים שנמחקו',
    totalShots: usable.length,
    rows,
    time,
    verdict,
    best,
    sweetSpot,
    winningTime,
    floor,
    slope,
    ageAdjusted,
    conclusions: buildConclusions({ rows, time, verdict, best, sweetSpot, winningTime, ageAdjusted, floor }),
  };
}

// ---- זמן החילוץ המנצח ----
// מחלקים את כל השוטים לרצועות זמן ומשווים את הדירוג הממוצע ביניהן.
// הרצועות נגזרות מהטווח שלך בפועל ולא מסולם קבוע: מי שכל השוטים שלו
// בין 29 ל-36 היה מקבל מסולם קבוע רצועה אחת ותשובה ריקה.
const TARGET_BAND_SEC = 3; // רוחב רצועה מבוקש
const MAX_BANDS = 4;
const MIN_BAND_SHOTS = 2;

function findWinningTime(timed: Shot[]): WinningTime | null {
  if (timed.length < 4) return null;
  const times = timed.map((s) => s.brewTimeSec);
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const span = hi - lo;
  if (span < 2) return null; // כל השוטים באותו זמן — אין מה להשוות

  const count = Math.max(2, Math.min(MAX_BANDS, Math.round(span / TARGET_BAND_SEC)));
  const width = span / count;
  const buckets: Shot[][] = Array.from({ length: count }, () => []);
  for (const s of timed) {
    const idx = Math.min(count - 1, Math.floor((s.brewTimeSec - lo) / width));
    buckets[idx].push(s);
  }

  const bands: TimeBand[] = buckets
    .map((list, i) => {
      if (list.length < MIN_BAND_SHOTS) return null;
      const grinds = list.map((s) => s.grindSetting);
      const counts = new Map<number, number>();
      for (const g of grinds) counts.set(g, (counts.get(g) ?? 0) + 1);
      const ratings = list.map((s) => s.rating);
      return {
        // גבולות מעוגלים לשנייה — רצועה של 29.4–32.7 אינה הוראה שאפשר לפעול לפיה
        from: Math.round(lo + i * width),
        to: Math.round(lo + (i + 1) * width),
        shots: list.length,
        avgRating: round1(mean(ratings)),
        ratingStdev: stdev(ratings),
        grindMode: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0],
        grindMin: Math.min(...grinds),
        grindMax: Math.max(...grinds),
      };
    })
    .filter((b): b is TimeBand => b !== null)
    .sort((a, b) => b.avgRating - a.avgRating);

  if (bands.length === 0) return null;
  const [bestBand, runnerUp = null] = bands;
  const se = runnerUp
    ? Math.sqrt((bestBand.ratingStdev ** 2) / bestBand.shots + (runnerUp.ratingStdev ** 2) / runnerUp.shots)
    : 0;
  const delta = runnerUp ? bestBand.avgRating - runnerUp.avgRating : 0;
  return {
    bands,
    best: bestBand,
    runnerUp,
    decisive: !!runnerUp && delta >= MIN_RATING_GAP && delta > SE_MULTIPLIER * se,
    delta: round1(delta),
    se: round1(se),
  };
}

// ---- האזור המנצח ----
// לא נקודה אחת אלא טווח: באיזו טחינה ובאיזה זמן נחתו השוטים הטובים.
// הסף הוא 8+, ואם אין מספיק כאלה יורדים לשלושת הטובים ביותר — כדי
// שהתשובה תהיה קיימת גם למי שעדיין לא הגיע ל-8.
function findSweetSpot(timed: Shot[]): SweetSpot | null {
  if (timed.length < 3) return null;
  const sorted = [...timed].sort((a, b) => b.rating - a.rating);
  const top = sorted[0].rating;
  // הסף הוא הרמה העליונה שלך, לא "טוב" באופן כללי: 8+ על יומן שכולו 8–10
  // מחזיר כמעט הכול, וטווח שמכיל את כל השוטים אינו אזור מנצח אלא הרשימה.
  let picked = sorted.filter((s) => s.rating >= Math.max(TARGET_RATING, top - 1));
  // עדיין רוב היומן? מעלים לרמה העליונה בלבד
  if (picked.length > timed.length * 0.6) {
    const tighter = sorted.filter((s) => s.rating >= top);
    if (tighter.length >= 2) picked = tighter;
  }
  if (picked.length < 3) picked = sorted.slice(0, 3);
  if (picked.length < 2) return null;

  const grinds = picked.map((s) => s.grindSetting);
  const times = picked.map((s) => s.brewTimeSec);
  const counts = new Map<number, number>();
  for (const g of grinds) counts.set(g, (counts.get(g) ?? 0) + 1);
  const grindMode = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  return {
    shots: picked.length,
    minRating: Math.min(...picked.map((s) => s.rating)),
    grindMin: Math.min(...grinds),
    grindMax: Math.max(...grinds),
    grindMode,
    timeMin: Math.min(...times),
    timeMax: Math.max(...times),
    timeAvg: round1(mean(times)),
  };
}

// צעד הסקאלה של המטחנה ששימשה הכי הרבה בשוטים האלה. הצעד הוא מה שהופך
// "שניות לצעד" למספר שאפשר לפעול לפיו, ומטחנות שונות אינן באותה סקאלה.
function dominantGrinderStep(shots: Shot[], grinders: Grinder[]): number {
  const counts = new Map<string, number>();
  for (const s of shots) counts.set(s.grinderId, (counts.get(s.grinderId) ?? 0) + 1);
  const topId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const g = grinders.find((x) => x.id === topId);
  return g && g.scaleStep > 0 ? g.scaleStep : 1;
}

// רגרסיה לינארית של זמן החליטה על דרגת הטחינה
function regressTimeOnGrind(
  shots: Shot[], adjTime: (s: Shot) => number, step: number,
): TimeVsGrind | null {
  const grinds = new Set(shots.map((s) => s.grindSetting));
  if (shots.length < 2 || grinds.size < 2) return null;

  const xs = shots.map((s) => s.grindSetting);
  const ys = shots.map(adjTime);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0) return null;
  const perUnit = sxy / sxx;
  const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const secPerStep = perUnit * step;
  return {
    secPerStep: round1(secPerStep),
    r: Math.round(r * 100) / 100,
    shots: shots.length,
    grinds: grinds.size,
    step,
    meaningful:
      shots.length >= MIN_TIME_SHOTS
      && Math.abs(secPerStep) >= MIN_SEC_PER_STEP
      && Math.abs(r) >= MIN_TIME_R,
  };
}

// השוואת שתי הדרגות המדורגות הכי גבוה. הפער נחשב אמיתי רק אם הוא עובר
// גם את שגיאת התקן המשולבת וגם רצפה מוחלטת — מדגם גדול הופך כל פער
// למובהק סטטיסטית, וזה לא אומר שמרגישים אותו בכוס.
function compareTopTwo(rows: GrindRow[]): GrindVerdict | null {
  const eligible = rows.filter((r) => r.shots >= MIN_SHOTS_PER_GRIND);
  if (eligible.length < 2) return null;
  const [a, b] = [...eligible].sort((x, y) => y.avgRating - x.avgRating);
  const se = Math.sqrt((a.ratingStdev ** 2) / a.shots + (b.ratingStdev ** 2) / b.shots);
  const delta = a.avgRating - b.avgRating;
  return {
    decisive: delta >= MIN_RATING_GAP && delta > SE_MULTIPLIER * se,
    best: a.grindSetting,
    other: b.grindSetting,
    deltaRating: round1(delta),
    se: round1(se),
    bestInTargetPct: a.inTargetPct,
    otherInTargetPct: b.inTargetPct,
  };
}

// הדירוג דחוס בקצה העליון, ולכן שובר השוויון הראשון הוא קרבה למרכז חלון
// היעד: מבין שני שוטי 10, זה שנחת באמצע החלון הוא זה שאפשר לחזור עליו.
function pickBestShot(
  shots: Shot[], resolveWindow: WindowResolver, bagMap: Map<string, Bag>,
): BestShotPick | null {
  if (shots.length === 0) return null;
  const scored = shots.map((s) => {
    const w = resolveWindow(s);
    const center = (w.min + w.max) / 2;
    return { s, off: s.brewTimeSec > 0 ? Math.abs(s.brewTimeSec - center) : Infinity };
  });
  scored.sort((x, y) =>
    y.s.rating - x.s.rating
    || x.off - y.off
    || y.s.createdAt.localeCompare(x.s.createdAt));
  const shot = scored[0].s;
  return { shot, roastAge: roastAgeDays(shot, bagMap.get(shot.bagId)) };
}

// ---- המסקנה ----
// נגזרת מהמספרים, לא טקסט קבוע. כשאין הכרעה זה נאמר במפורש — זו מסקנה
// ולא היעדר מסקנה.
function buildConclusions({
  rows, time, verdict, best, sweetSpot, winningTime, ageAdjusted, floor,
}: {
  rows: GrindRow[];
  time: TimeVsGrind | null;
  verdict: GrindVerdict | null;
  best: BestShotPick | null;
  sweetSpot: SweetSpot | null;
  winningTime: WinningTime | null;
  ageAdjusted: boolean;
  floor: number | null;
}): string[] {
  const out: string[] = [];

  if (winningTime) {
    const w = winningTime.best;
    const grindPart = w.grindMin === w.grindMax
      ? `טחינה ${w.grindMin}`
      : `טחינה ${w.grindMin}–${w.grindMax}, רובם ${w.grindMode}`;
    if (winningTime.decisive && winningTime.runnerUp) {
      out.push(
        `זמן החילוץ המנצח שלך: ${w.from}–${w.to} שניות, דירוג ממוצע ${w.avgRating.toFixed(1)} `
        + `(${w.shots} שוטים, ${grindPart}). הרצועה הבאה אחריה, ${winningTime.runnerUp.from}–`
        + `${winningTime.runnerUp.to} שניות, מקבלת ${winningTime.runnerUp.avgRating.toFixed(1)} — `
        + `פער של ${winningTime.delta.toFixed(1)} נקודות, גדול משגיאת המדידה.`,
      );
    } else if (winningTime.runnerUp) {
      out.push(
        `הרצועה הטובה ביותר בזמן החילוץ היא ${w.from}–${w.to} שניות (${w.avgRating.toFixed(1)}, `
        + `${w.shots} שוטים, ${grindPart}), אבל היא לא נפרדת מ-${winningTime.runnerUp.from}–`
        + `${winningTime.runnerUp.to} שניות: הפער ${winningTime.delta.toFixed(1)} בתוך טווח השגיאה `
        + `(${winningTime.se.toFixed(1)}). הזמן לבדו עדיין לא מסביר את הדירוג אצלך.`,
      );
    } else {
      out.push(
        `כל השוטים המדורגים שלך נופלים ברצועת זמן אחת, ${w.from}–${w.to} שניות `
        + `(${grindPart}). אין רצועה שנייה להשוות אליה — נסה במכוון זמן אחר כדי לדעת.`,
      );
    }
  }

  if (sweetSpot) {
    const grindPart = sweetSpot.grindMin === sweetSpot.grindMax
      ? `טחינה ${sweetSpot.grindMin}`
      : `טחינה ${sweetSpot.grindMin}–${sweetSpot.grindMax} (רובם על ${sweetSpot.grindMode})`;
    const timePart = sweetSpot.timeMin === sweetSpot.timeMax
      ? `${sweetSpot.timeMin} שניות`
      : `${sweetSpot.timeMin}–${sweetSpot.timeMax} שניות`;
    out.push(
      `${sweetSpot.shots} השוטים הטובים שלך (${sweetSpot.minRating}+) יצאו ב${grindPart}, `
      + `בזמן עצירה של ${timePart} — ממוצע ${sweetSpot.timeAvg}. זה האזור לכוון אליו.`,
    );
  }

  if (verdict?.decisive) {
    out.push(
      `טחינה ${verdict.best} עדיפה על ${verdict.other} בפער של ${verdict.deltaRating} נקודות — `
      + `גדול מספיק כדי לא להיות מקרה (שגיאת המדידה ${verdict.se}). זו הדרגה לחזור אליה.`,
    );
  } else if (verdict) {
    out.push(
      `אין הכרעה בין טחינה ${verdict.best} ל-${verdict.other}: ההפרש ${verdict.deltaRating} נקודות, `
      + `בתוך טווח השגיאה (${verdict.se}). שתיהן עובדות לך באותה מידה, והבחירה ביניהן היא לא מה `
      + `שיזיז את הכוס — הפאק הוא כן.`,
    );
  }

  // ההצלבה המעניינת: מי שמנצחת בדירוג לא בהכרח מנצחת בחזרתיות
  if (verdict && verdict.bestInTargetPct !== null && verdict.otherInTargetPct !== null
      && verdict.bestInTargetPct + 15 < verdict.otherInTargetPct) {
    out.push(
      `שים לב להיפוך: טחינה ${verdict.other} נוחתת בחלון היעד ב-${verdict.otherInTargetPct}% `
      + `מהפעמים מול ${verdict.bestInTargetPct}% בטחינה ${verdict.best}. היא פחות מרשימה בשיא `
      + `ויותר צפויה — ולזה קוראים עקביות.`,
    );
  }

  if (time?.meaningful) {
    const dir = time.secPerStep < 0 ? 'מקצר' : 'מאריך';
    out.push(
      `כל צעד טחינה אחד ${dir} אצלך את זמן החליטה ב-${Math.abs(time.secPerStep)} שניות `
      + `(${time.shots} שוטים, מתאם ${Math.abs(time.r)}). זה שער ההמרה שלך: אם אתה רחוק `
      + `${Math.abs(time.secPerStep) * 2} שניות מהיעד — זה שני צעדים, לא ניחוש.`,
    );
  } else if (time) {
    out.push(
      `הקשר בין הטחינה לזמן החליטה עדיין לא יוצא מהרעש (${time.shots} שוטים, מתאם ${Math.abs(time.r)}). `
      + `כדי למדוד אותו צריך כמה שוטים על אותה דרגה בדיוק, ולא דרגה חדשה בכל פעם.`,
    );
  }

  if (!ageAdjusted && time) {
    out.push(
      'שער ההמרה לא נוקה מהזדקנות הפולים: אין מספיק שוטים על הגדרות זהות בגילאי שקית שונים '
      + 'כדי למדוד את השיפוע ולנטרל אותו. חלק מההפרש בזמן בין הדרגות עשוי להיות הגזים, לא הטחינה.',
    );
  }

  if (floor !== null) {
    out.push(`הקיר הדק שלך בפולים האלה הוא ${floor} — שם המכונה נחנקה. אין טעם לרדת לשם או מתחת.`);
  }

  if (best && best.roastAge !== null) {
    const row = rows.find((r) => r.grindSetting === best.shot.grindSetting);
    out.push(
      `השוט הטוב ביותר יצא בטחינה ${best.shot.grindSetting} ביום ${best.roastAge} מהקלייה`
      + `${row && row.shots >= MIN_SHOTS_PER_GRIND ? '' : ' — אבל זו דרגה שניסית פעם אחת, כך שהוא עדיין לא הוכחה'}.`,
    );
  }

  return out;
}
