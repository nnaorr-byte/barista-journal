import type {
  AiAdvice, AiTargets, DialInKind, DialInPhase, DialInSession, DialInState, Shot,
} from '../domain/types';
import type { TargetWindow } from './targetWindow';

// ============================================================
// מנוע ה-DIAL IN — כיול פולים חדשים
// מימוש של docs/DIAL_IN_ENGINE.md (v2.0) אחד-לאחד.
// ============================================================
// זה לא מוח שני. זה ענף בתוך המוח: aiEngine קורא לכאן כשיש סשן כיול פעיל,
// ונופל לעץ ההחלטה הרגיל בכל מצב אחר. שכבות ההגנה (תיעול, הכנה לא יציבה),
// האזהרות, נקודת העצירה ורמת הביטחון — כולן מגיעות מ-aiEngine ומשותפות.
//
// מה שונה כאן מהיומיום:
//   · שלב 1 עובד בטחינה בלבד. Yield לא זז עד שנכנסים לחלון הזמן.
//   · צעד ה-Yield הוא 2 גרם (ולא 3), עד שני צעדים, ואז עוברים לטחינה
//     ומחזירים את ה-Yield לנקודת האפס — כדי למדוד את הטחינה החדשה נקי.
//   · Dose קפוא לאורך כל התהליך (עיקרון הזהב 3).
//   · יש שלב 4 שאין ביומיום: ציד ה-Sweet Spot — פותחים טחינה בצעדים
//     קטנים כל עוד משתפר, וחוזרים צעד אחורה כשיורד.
//   · הסשן נסגר רק באישור המשתמש, לא אוטומטית.

export const DIAL_IN_DEFAULT_YIELD = 30; // "Yield יעד סופי" מהמדריך
const YIELD_STEP = 2; // צעד Yield רגיל
const YIELD_STEP_FINE = 1; // "חסרה מתיקות עם מעט מרירות"
const MAX_YIELD_STEPS = 2; // אחרי שניים — עוברים לטחינה

const round1 = (n: number) => Math.round(n * 10) / 10;

const PHASE_LABEL: Record<DialInPhase, string> = {
  'window': 'שלב 1 · כניסה לאזור העבודה',
  'taste': 'שלב 3 · כוונון עדין',
  'sweet-spot': 'שלב 4 · ציד ה-Sweet Spot',
  'confirm': 'סיום · אישור המתכון',
};
const PHASE_STEP: Record<DialInPhase, 1 | 3 | 4> = {
  'window': 1, 'taste': 3, 'sweet-spot': 4, 'confirm': 4,
};

const REMINDER_ONE_VAR =
  'משתנה אחד בלבד. ה-Dose קפוא עד סוף הכיול — זו נקודת הייחוס שכל השאר נמדד מולה.';
const REMINDER_RESET =
  'כאן זזים שני דברים יחד בכוונה: הטחינה משתנה וה-Yield חוזר לנקודת האפס. ' +
  'בלי האיפוס לא תדע אם השיפור בא מהטחינה או מה-Yield שנשאר מהניסיון הקודם.';
const REMINDER_TASTE =
  'הזמן הוא כלי עזר, לא היעד. אם השוט הכי טעים יוצא ב-17 שניות — זה המתכון הנכון.';

// ---- סיווג התלונה לפי המדריך ----
// הסדר משנה. "חסרה מתיקות" נבדק לפני "מר" רק כששניהם מתויגים יחד, כי
// המדריך מתייחס למרירות שם כמאפיין של התלונה ולא כתלונה בפני עצמה
// ("אם יש מעט מרירות: הקטן Yield ב-1 גרם").
export type DialInComplaint =
  | 'conflict' // חמוץ + מר — חשד לתיעול
  | 'sour' | 'bitter' | 'dry' | 'watery'
  | 'flat' // חסרה מתיקות
  | 'thin' // חסר גוף (body = חלש)
  | 'perfect' // מתוק/מאוזן בדירוג 8+
  | 'good' // חיובי אבל עוד לא שם
  | 'untagged';

export function dialInComplaint(shot: Shot): DialInComplaint {
  const tags = new Set(shot.tasteTags);
  if (tags.has('sour') && tags.has('bitter')) return 'conflict';
  if (tags.has('flat') && tags.has('bitter')) return 'flat';
  if (tags.has('sour')) return 'sour';
  if (tags.has('bitter')) return 'bitter';
  if (tags.has('dry')) return 'dry';
  if (tags.has('watery')) return 'watery';
  if (tags.has('flat')) return 'flat';
  if (shot.body === 'poor') return 'thin';
  const positive = tags.has('sweet') || tags.has('balanced');
  // גוף "חלש" כבר נתפס למעלה כ-'thin', ולכן כאן נשאר רק גוף תקין או לא מתויג:
  // שדה ריק לא חוסם התקדמות.
  if (positive && shot.rating >= 8) return 'perfect';
  if (positive) return 'good';
  return 'untagged';
}

// ---- רעש הכנה, בגרסת הכיול ----
// המודל הכללי של המוח (brewTimeInstability) מודד פיזור בזמני החליטה של
// חמשת השוטים האחרונים. בכיול הוא מודד את עצמו: שלב 1 *נועד* להזיז את
// הזמן בעשר שניות, ולכן המודל הכללי היה עוצר כל כיול באמצע בטענה
// שההכנה לא יציבה. כאן נמדדים רק שוטים רצופים שבהם לא שינינו כלום
// בכוונה — אותה טחינה, אותו Yield. רק אז פיזור הוא באמת רעש הכנה.
const PREP_NOISE_RANGE_SEC = 6;
function prepNoise(
  sessionShots: Shot[],
): { min: number; max: number; range: number; count: number } | null {
  const last = sessionShots[sessionShots.length - 1];
  if (!last) return null;
  const same: Shot[] = [];
  for (let i = sessionShots.length - 1; i >= 0; i--) {
    const s = sessionShots[i];
    const sameSetup =
      Math.abs(s.grindSetting - last.grindSetting) < 0.01 &&
      Math.abs(s.yieldGrams - last.yieldGrams) < 1;
    if (sameSetup && s.brewTimeSec > 0) same.unshift(s);
    else break;
  }
  if (same.length < 3) return null;
  const times = same.map((s) => s.brewTimeSec);
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { min, max, range: max - min, count: same.length };
}

// כמה כבר נוסה על אותה תלונה ברציפות — קובע אם Yield מוצה ועוברים לטחינה
function remediesTried(
  sessionShots: Shot[], complaint: DialInComplaint,
): { yieldSteps: number; grindChanged: boolean } {
  const streak: Shot[] = [];
  for (let i = sessionShots.length - 1; i >= 0; i--) {
    if (dialInComplaint(sessionShots[i]) === complaint) streak.unshift(sessionShots[i]);
    else break;
  }
  let yieldSteps = 0;
  let grindChanged = false;
  for (let i = 1; i < streak.length; i++) {
    // סף 1 גרם ולא 1.5 — צעד ה"חסרה מתיקות" הוא גרם אחד
    if (Math.abs(streak[i].yieldGrams - streak[i - 1].yieldGrams) >= 1) yieldSteps++;
    if (Math.abs(streak[i].grindSetting - streak[i - 1].grindSetting) >= 0.01) grindChanged = true;
  }
  return { yieldSteps, grindChanged };
}

// ============================================================

export interface DialInContext {
  session: DialInSession;
  lastShot: Shot;
  sessionShots: Shot[]; // שוטי הסשן מהישן לחדש, כולל האחרון
  window: TargetWindow;
  grindStep: number;
  grinderName?: string;
  clampGrind: (v: number) => number; // אותה הצמדה לגבולות הסקאלה כמו במוח
}

export interface DialInDecision {
  targets: AiTargets;
  changeKind: AiAdvice['changeKind'];
  changeLabel: string;
  diagnosis: string;
  instruction: string;
  expectedResult: string;
  tone: AiAdvice['tone'];
  reminder: string;
  // מצב הכיול אחרי השוט הזה. הקורא שומר ממנו גם את ה-DialInSession —
  // מקור אחד למצב, ולא שני עותקים שיכולים להיפרד.
  state: DialInState;
}

export function dialInDecide(ctx: DialInContext): DialInDecision {
  const { session, lastShot: last, sessionShots, window, grindStep, clampGrind } = ctx;
  const kind: DialInKind = session.kind ?? 'full';
  const targetYield = session.targetYieldGrams ?? DIAL_IN_DEFAULT_YIELD;
  const lockedDose = session.lockedDoseGrams ?? last.doseGrams;
  const grinderSuffix = ctx.grinderName ? ` (${ctx.grinderName})` : '';
  const t = last.brewTimeSec;

  let phase: DialInPhase = session.phase ?? 'window';
  let sweetSpotBestShotId = session.sweetSpotBestShotId ?? null;

  // ה-Dose תמיד חוזר לערך הקפוא — גם אם המשתמש סטה ממנו בטעות
  const targets: AiTargets = {
    doseGrams: lockedDose,
    yieldGrams: last.yieldGrams,
    grindSetting: last.grindSetting,
    machineTemp: last.machineTemp,
  };

  let changeKind: AiAdvice['changeKind'] = 'none';
  let changeLabel = 'ללא שינוי';
  let diagnosis = '';
  let instruction = '';
  let expectedResult = '';
  let tone: AiAdvice['tone'] = 'info';
  let reminder = REMINDER_ONE_VAR;

  const grindTo = (delta: number, label: string): number => {
    const target = clampGrind(last.grindSetting + delta);
    changeKind = 'grind';
    changeLabel = label;
    return target;
  };
  const finer = () => {
    targets.grindSetting = grindTo(-grindStep, 'דרגת טחינה — דק יותר');
    return targets.grindSetting === last.grindSetting
      ? `הטחינה כבר בקצה הדק של הסקאלה (${last.grindSetting}${grinderSuffix}) — אי אפשר לרדת עוד.`
      : `טחן דק יותר: מדרגה ${last.grindSetting} לדרגה ${targets.grindSetting}${grinderSuffix}.`;
  };
  const coarser = () => {
    targets.grindSetting = grindTo(grindStep, 'דרגת טחינה — גס יותר');
    return targets.grindSetting === last.grindSetting
      ? `הטחינה כבר בקצה הגס של הסקאלה (${last.grindSetting}${grinderSuffix}) — אי אפשר לעלות עוד.`
      : `טחן גס יותר: מדרגה ${last.grindSetting} לדרגה ${targets.grindSetting}${grinderSuffix}.`;
  };
  const yieldBy = (delta: number) => {
    targets.yieldGrams = round1(Math.max(lockedDose, last.yieldGrams + delta));
    changeKind = 'yield';
    changeLabel = delta > 0 ? 'Yield — הגדלה' : 'Yield — הקטנה';
    return `${delta > 0 ? 'הגדל' : 'הקטן'} את ה-Yield ב-${Math.abs(delta)} גרם: יעד סופי ${targets.yieldGrams} גרם בכוס (במקום ${last.yieldGrams}). הטחינה לא זזה והמנה נשארת על ${lockedDose} גרם.`;
  };
  // שינוי טחינה בשלב הכוונון מחזיר את ה-Yield לנקודת האפס (הוראת המדריך)
  const grindWithReset = (dir: 'finer' | 'coarser') => {
    const text = dir === 'finer' ? finer() : coarser();
    targets.yieldGrams = targetYield;
    reminder = REMINDER_RESET;
    return `${text} ובמקביל החזר את ה-Yield ל-${targetYield} גרם — נקודת האפס שממנה מודדים את הטחינה החדשה.`;
  };

  // ---- שכבת הגנה: תיעול. עוצר את הכיול, לא מכייל על פאק שבור ----
  const complaint = dialInComplaint(last);
  const noise = prepNoise(sessionShots);
  if (complaint === 'conflict') {
    changeKind = 'prep';
    changeLabel = 'הכנת הפאק (לא הגדרות!)';
    diagnosis =
      'חמוץ ומר יחד — לפי המדריך זו לא בעיית כיול אלא חשד לתיעול (Channeling): ' +
      'חלק מהפאק חולץ יתר וחלק בחסר. הכיול עוצר כאן; שינוי הגדרות עכשיו רק יזייף את השלב הבא.';
    instruction =
      'בדוק את ההכנה לפי הסדר: WDT יסודי, פיזור אחיד, טמפינג ישר, סלסלה נקייה. ' +
      'חזור על אותם פרמטרים בדיוק. אם גם אז חמוץ+מר — נפתח את הטחינה מעט.';
    expectedResult = 'זרימה אחידה מה-Bottomless. אחריה הכיול ממשיך מאותה נקודה.';
    tone = 'warn';
    reminder = 'הכיול לא מתקדם על שוט מתועל. קודם פאק אחיד, אחר כך הגדרות.';
  }
  // ---- שכבת הגנה: אותם פרמטרים, זמנים רחוקים = ההכנה רועדת ----
  else if (noise && noise.range >= PREP_NOISE_RANGE_SEC && complaint !== 'perfect') {
    changeKind = 'prep';
    changeLabel = 'ייצוב ההכנה (לא הגדרות!)';
    diagnosis =
      `${noise.count} השוטים האחרונים רצו על אותה טחינה ואותו Yield בדיוק, ובכל זאת יצאו ` +
      `${noise.min}–${noise.max} שניות (פער ${noise.range}). את הפער הזה לא גרם שום שינוי שעשינו — ` +
      'הוא בא מההכנה. כיול על רעש כזה לא ישוחזר מחר.';
    instruction =
      'חזור על אותם פרמטרים בדיוק, עם פיזור אחיד במחט, פילוס, טמפינג ישר ולחץ קבוע. ' +
      'כשהזמנים יתכנסו לפער של עד ~4 שניות — הכיול ממשיך.';
    expectedResult = 'זמני חליטה צמודים — בסיס אמין להמשך הכיול.';
    tone = 'warn';
    reminder = 'זו לא נסיגה בכיול. זו הנחת היסוד שלו.';
  }
  // ---- שלב 4: ציד ה-Sweet Spot ----
  else if (phase === 'sweet-spot') {
    const best = sessionShots.find((s) => s.id === sweetSpotBestShotId) ?? last;
    const improved = last.id === best.id || last.rating >= best.rating;
    const atCoarseEnd = clampGrind(last.grindSetting + grindStep) === last.grindSetting;

    if (improved && !atCoarseEnd) {
      sweetSpotBestShotId = last.id;
      instruction = `${coarser()} כל השאר נשאר.`;
      diagnosis =
        `${last.rating}/10 — לא נפלת מהשוט הטוב הקודם, אז יש עוד לאן לפתוח. ` +
        'לפי המדריך: הטחינה הגסה ביותר שעדיין נותנת שוט מאוזן היא הנקודה הנכונה, ' +
        'כי היא הסלחנית ביותר לשינויים קטנים בהכנה.';
      expectedResult = 'זרימה אחידה יותר ומתיקות גבוהה יותר — או ירידה, ואז נחזור צעד אחורה.';
      tone = 'good';
      reminder = 'בציד הזה ירידה היא לא כישלון — היא הסימן שעברנו את הנקודה ומצאנו אותה.';
    } else {
      // ירידה או קצה הסקאלה — הנקודה היא הצעד הקודם
      phase = 'confirm';
      targets.grindSetting = best.grindSetting;
      targets.yieldGrams = best.yieldGrams;
      targets.doseGrams = best.doseGrams;
      changeKind = 'recipe';
      changeLabel = 'חזרה לנקודת ה-Sweet Spot';
      diagnosis = atCoarseEnd
        ? `הגעת לקצה הגס של הסקאלה (${last.grindSetting}${grinderSuffix}). הנקודה הטובה ביותר שנמדדה היא ${best.rating}/10.`
        : `${last.rating}/10 מול ${best.rating}/10 בצעד הקודם — האיכות ירדה. עברנו את הנקודה, וחוזרים צעד אחורה. זה ה-Sweet Spot.`;
      instruction =
        `חזור למתכון: ${best.doseGrams} גרם ← ${best.yieldGrams} גרם, טחינה ${best.grindSetting}${grinderSuffix}. ` +
        'עשה אותו עוד פעם אחת לאימות — ואם הוא חוזר על עצמו, אשר אותו כמתכון של הפולים האלה.';
      expectedResult = `שחזור של ${best.rating}/10, והפעם כמתכון קבוע ולא כמקרה.`;
      tone = 'good';
      reminder = REMINDER_TASTE;
    }
  }
  // ---- אחרי אישור, אם ממשיכים לירות ----
  else if (phase === 'confirm') {
    const best = sessionShots.find((s) => s.id === sweetSpotBestShotId)
      ?? [...sessionShots].sort((a, b) => b.rating - a.rating)[0] ?? last;
    changeKind = 'none';
    changeLabel = 'ללא שינוי — הכיול הסתיים';
    diagnosis = `הכיול הגיע לנקודה שלו (${best.rating}/10). מכאן זו עקביות, לא כיול.`;
    instruction = `חזור על המתכון: ${best.doseGrams} גרם ← ${best.yieldGrams} גרם, טחינה ${best.grindSetting}${grinderSuffix}.`;
    expectedResult = 'אותו שוט, כל בוקר.';
    tone = 'good';
    reminder = 'לחץ "זה המתכון" כדי לסגור את הכיול ולשמור אותו כמתכון של הפולים האלה.';
    targets.grindSetting = best.grindSetting;
    targets.yieldGrams = best.yieldGrams;
  }
  // ---- שלב 1: כניסה לאזור העבודה. טחינה בלבד ----
  else if (phase === 'window' && t <= 0) {
    changeKind = 'none';
    changeLabel = 'חסר זמן חליטה';
    diagnosis = 'שלב 1 נשען כולו על זמן העצירה בפועל, והוא לא תועד בשוט הזה.';
    instruction = 'חזור על אותם פרמטרים ומדוד את הזמן מרגע ה-Start ועד ה-Stop.';
    expectedResult = 'נקודת פתיחה שאפשר לכייל ממנה.';
    tone = 'info';
  } else if (phase === 'window' && t < window.min) {
    instruction = `${finer()} אל תיגע ב-Yield — בשלב הזה הוא לא כלי.`;
    diagnosis =
      `${t} שניות מול חלון של ${window.min}–${window.max} — מהר מדי. ` +
      'בשלב 1 יש כלי אחד בלבד: טחינה. ה-Yield נכנס לתמונה רק אחרי שנהיה בחלון.';
    expectedResult = `זמן ארוך יותר, לכיוון ${window.min}–${window.max} שניות.`;
    tone = 'warn';
  } else if (phase === 'window' && t > window.max) {
    instruction = `${coarser()} אל תיגע ב-Yield — בשלב הזה הוא לא כלי.`;
    diagnosis =
      `${t} שניות מול חלון של ${window.min}–${window.max} — איטי מדי. ` +
      'בשלב 1 יש כלי אחד בלבד: טחינה.';
    expectedResult = `זמן קצר יותר, לכיוון ${window.min}–${window.max} שניות.`;
    tone = 'warn';
  }
  // ---- שלב 3: כוונון עדין לפי הטעם ----
  else {
    if (phase === 'window') phase = 'taste'; // נכנסנו לחלון — ממשיכים לטעם באותו שוט
    const tried = remediesTried(sessionShots, complaint);
    const yieldExhausted = tried.yieldSteps >= MAX_YIELD_STEPS;
    reminder = REMINDER_TASTE;

    switch (complaint) {
      case 'sour':
        if (yieldExhausted) {
          diagnosis = `עדיין חמוץ אחרי ${tried.yieldSteps} צעדי Yield — הכלי הזה מוצה. עוברים לטחינה.`;
          instruction = grindWithReset('finer');
          expectedResult = 'חילוץ עמוק יותר שימיס את החמיצות במתיקות.';
        } else {
          diagnosis =
            `חמיצות בזמן תקין (${t} שניות) — החילוץ נעצר בשלב החומצי. ` +
            'לפי המדריך: קודם Yield, ורק אם הוא מוצה — טחינה.';
          instruction = yieldBy(YIELD_STEP);
          expectedResult = 'המים הנוספים ימשכו את המתיקות שמאזנת את החמיצות.';
        }
        tone = 'warn';
        break;

      case 'bitter':
        if (yieldExhausted) {
          diagnosis = `עדיין מר אחרי ${tried.yieldSteps} צעדי Yield — הכלי הזה מוצה. פותחים את הטחינה.`;
          instruction = grindWithReset('coarser');
          expectedResult = 'חילוץ מתון יותר שיעצור לפני התרכובות המרות.';
        } else {
          diagnosis = `מרירות בזמן תקין (${t} שניות) — החילוץ נמשך אל השלב המר. לפי הסדר: קודם Yield.`;
          instruction = yieldBy(-YIELD_STEP);
          expectedResult = 'עצירה מוקדמת שתשאיר את המרירות מחוץ לכוס.';
        }
        tone = 'warn';
        break;

      case 'dry':
        // עפיצות = חילוץ יתר של טאנינים. הקטנת Yield עוצרת לפניהם.
        if (tried.yieldSteps >= 1) {
          diagnosis = 'עדיין יבש למרות הקטנת ה-Yield — פותחים את הטחינה להפחתת העפיצות.';
          instruction = grindWithReset('coarser');
          expectedResult = 'פחות טאנינים בכוס — סיום נקי יותר.';
        } else {
          diagnosis = `יובש/עפיצות בזמן תקין (${t} שניות) — חילוץ שנמשך אל הטאנינים.`;
          instruction = yieldBy(-YIELD_STEP);
          expectedResult = 'סיום רך יותר, בלי התחושה המחוספסת בפה.';
        }
        tone = 'warn';
        break;

      case 'watery':
      case 'thin':
        // "חסר גוף" ו"דליל" — אותו תיקון. Dose קפוא, ולכן Yield בלבד.
        diagnosis =
          complaint === 'thin'
            ? 'הגוף תויג כחלש — המשקה דליל מדי לריכוז שרצינו.'
            : `טעם מימי (${t} שניות) — המשקה דליל.`;
        instruction = `${yieldBy(-YIELD_STEP)} המנה קפואה עד סוף הכיול, ולכן הריכוז מגיע מה-Yield ולא מהגדלת מנה.`;
        expectedResult = 'משקה מרוכז יותר עם גוף מורגש.';
        tone = 'warn';
        break;

      case 'flat': {
        const withBitter = last.tasteTags.includes('bitter');
        if (withBitter) {
          diagnosis =
            'חסרה מתיקות ויש גם מעט מרירות — סימן שהחילוץ עבר במעט את נקודת המתיקות. ' +
            'המדריך קורא לצעד קטן, לא לצעד מלא.';
          instruction = yieldBy(-YIELD_STEP_FINE);
          expectedResult = 'עצירה גרם אחד מוקדם יותר — בדיוק לפני שהמרירות מכסה על המתיקות.';
        } else {
          diagnosis =
            'חסרה מתיקות בלי מרירות — לא חילוץ יתר. לפי המדריך, טחינה דקה מדי אינה בהכרח טובה יותר: ' +
            'דווקא טחינה מעט גסה נותנת זרימה אחידה ומתיקות גבוהה יותר.';
          instruction = `${coarser()} ה-Yield נשאר ${last.yieldGrams} גרם.`;
          expectedResult = 'זרימה אחידה יותר ומתיקות שמגיעה מעצמה.';
        }
        tone = 'warn';
        break;
      }

      case 'perfect':
        phase = 'sweet-spot';
        sweetSpotBestShotId = last.id;
        diagnosis =
          `${last.rating}/10, מתוק ומאוזן — הגעת לשוט טוב. ` +
          'עכשיו מתחיל שלב 4: לא מסתפקים בטוב הראשון אלא בודקים אם יש טוב יותר גס ממנו.';
        instruction = `${coarser()} כל השאר נשאר בדיוק כפי שהיה.`;
        expectedResult = 'אם ישתפר — נפתח עוד צעד. אם יירד — נחזור לכאן, וזו הנקודה.';
        tone = 'good';
        reminder =
          'אפשר גם לעצור כאן: לחץ "זה המתכון" אם אתה מרוצה. ' +
          'הציד הוא כדי למצוא נקודה סלחנית יותר, לא כדי לרדוף אחרי מושלם.';
        break;

      case 'good':
        diagnosis =
          `הטעם חיובי אבל הדירוג ${last.rating}/10 — קרוב, עדיין לא שם. ` +
          'לפני שנוגעים בכלום: חזור על אותו שוט בדיוק.';
        instruction = 'אותם פרמטרים בדיוק. אם הוא חוזר על עצמו — נדע שזו ההגדרה ולא מקרה.';
        expectedResult = 'אימות שהמספרים האלה יציבים, ואז נחדד מכאן.';
        tone = 'info';
        break;

      case 'untagged':
        diagnosis = 'לא תויג טעם, ושלב הכוונון כולו נשען על הטעם. הדירוג לבדו לא מספיק להחלטה.';
        instruction =
          'חזור על אותם פרמטרים, והפעם תייג: חמוץ · מר · יבש · מימי · חסר מתיקות · מתוק · מאוזן. ' +
          'סמן גם את הגוף — "חסר גוף" הוא אבחנה בפני עצמה.';
        expectedResult = 'אבחון אמין, ואיתו הצעד הבא.';
        tone = 'info';
        break;
    }
  }

  // סטיית Dose: היעד כבר מתוקן חזרה לערך הקפוא, אבל תיקון שקט הוא תיקון
  // שלא ילמד ממנו כלום. אומרים אותו במפורש, וגם למה זה משנה.
  if (changeKind !== 'prep' && Math.abs(last.doseGrams - lockedDose) >= 0.3) {
    instruction +=
      ` שים לב: המנה בשוט הזה הייתה ${last.doseGrams} גרם במקום ${lockedDose}. ` +
      `חזור ל-${lockedDose} — כל מה שנמדד עד כה נמדד מולה, ומנה נודדת הופכת את כל הכיול לניחוש.`;
  }

  const best = [...sessionShots].sort((a, b) => b.rating - a.rating)[0] ?? null;
  const readyToConfirm = phase === 'confirm' || (best?.rating ?? 0) >= 8;

  return {
    targets,
    changeKind,
    changeLabel,
    diagnosis,
    instruction,
    expectedResult,
    tone,
    reminder,
    state: {
      kind,
      phase,
      phaseStep: PHASE_STEP[phase],
      phaseLabel: PHASE_LABEL[phase],
      shotIndex: sessionShots.length,
      readyToConfirm,
      targetYieldGrams: targetYield,
      lockedDoseGrams: lockedDose,
      sweetSpotBestShotId,
    },
  };
}
