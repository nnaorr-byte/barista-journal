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
  /** זמן ממוצע — מתוקנן לגיל כשהשיפוע מדיד, אחרת גולמי */
  avgTimeSec: number | null;
  avgRatio: number | null;
  excellentPct: number;
  inTargetPct: number | null;
  isCurrent: boolean;
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
  floor: number | null;
  slope: AgingSlope | null;
  /** האם עמודת הזמן עברה נטרול גיל בפועל */
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
      const ratings = list.map((s) => s.rating);
      const inTarget = withTime.filter((s) => isInTarget(s, resolveWindow(s))).length;
      return {
        grindSetting,
        shots: list.length,
        avgRating: round1(mean(ratings)),
        ratingStdev: stdev(ratings),
        avgTimeSec: withTime.length ? round1(mean(withTime.map(adjTime))) : null,
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

  // ---- השוט הכי טוב ----
  const best = pickBestShot(usable, resolveWindow, bagMap);

  return {
    beanName: bean?.name ?? 'פולים שנמחקו',
    totalShots: usable.length,
    rows,
    time,
    verdict,
    best,
    floor: chokeFloor(rawShots),
    slope,
    ageAdjusted,
    conclusions: buildConclusions({ rows, time, verdict, best, ageAdjusted, floor: chokeFloor(rawShots) }),
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
  rows, time, verdict, best, ageAdjusted, floor,
}: {
  rows: GrindRow[];
  time: TimeVsGrind | null;
  verdict: GrindVerdict | null;
  best: BestShotPick | null;
  ageAdjusted: boolean;
  floor: number | null;
}): string[] {
  const out: string[] = [];

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

  if (!ageAdjusted) {
    out.push(
      'הזמנים כאן גולמיים: אין מספיק שוטים על הגדרות זהות בגילאי שקית שונים כדי למדוד '
      + 'את שיפוע ההזדקנות ולנטרל אותו. חלק מההפרש בין הדרגות עשוי להיות הגזים, לא הטחינה.',
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
