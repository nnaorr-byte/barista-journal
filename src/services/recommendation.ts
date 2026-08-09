import {
  shotRatio, type Bag, type Bean, type Grinder, type MachineTempSetting, type RoastLevel,
  type Shot, type ShotRecommendation, type UserProfile,
} from '../domain/types';
import { learningConfidence } from './learning';
import { aiRecommend } from './aiEngine';
import { daysSince } from './dates';
import { AGED_DEADLINE_DAYS, AGED_OPTIMAL_DAYS, resolveRoastType } from './freshness';
import { analyzable } from './shotFilter';
import { ROAST_DEFAULTS, bestShotsForCalibration, computeTargetWindow } from './targetWindow';

// מנוע ההמלצות: שרשרת של שלושה מודולים —
// 1. חוקים כלליים של אספרסו לפי רמת קלייה
// 2. התאמות לפי טריות הפולים (Degassing/Aging)
// 3. למידה אישית מההיסטוריה (גוברת על הכללים ככל שיש יותר נתונים)
//
// חלון זמן החליטה נגזר כולו מ-services/targetWindow.ts — מקור האמת היחיד
// שממנו ניזונים גם מוח ה-AI וגם מדד "הדופק שלך".

// מיוצא מחדש כדי שכל הקוראים הקיימים ימשיכו לעבוד; ההגדרה חיה ב-dates.ts
export { daysSince };

export function recommendShot(params: {
  user: UserProfile;
  bean: Bean;
  bag: Bag;
  beanShots: Shot[]; // כל השוטים ההיסטוריים של סוג הפולים הזה
  grinderShots: Shot[]; // שוטים של הפולים האלה על המטחנה הנוכחית
  doseGrams?: number; // אם המשתמש כבר בחר מנה
  grinder?: Grinder; // המטחנה הנוכחית — לחישובי מוח ה-AI
  lastGrinderShot?: Shot; // השוט האחרון על המטחנה הנוכחית, מכל סוג פולים
}): ShotRecommendation {
  const { user, bean, bag, grinder, lastGrinderShot } = params;
  // רשימות גולמיות נשמרות בצד: מוח ה-AI צריך אותן כדי לקרוא מהן את קיר
  // החניקה. כל השאר כאן לומד רק משוטים מדידים.
  const rawGrinderShots = params.grinderShots;
  const beanShots = analyzable(params.beanShots);
  const grinderShots = analyzable(params.grinderShots);
  const reasons: string[] = [];
  const beanNotes: string[] = [];
  const defaults = ROAST_DEFAULTS[bean.roastLevel];
  let recommendedTemp: MachineTempSetting = 'medium';

  const dose = params.doseGrams ?? user.defaultDoseGrams;

  // שלב 1: חוקים כלליים
  let ratio = defaults.ratio;
  reasons.push(`נקודת פתיחה לקליית ${roastLabel(bean.roastLevel)}: יחס 1:${ratio.toFixed(1)}, ${defaults.timeMin}–${defaults.timeMax} שניות.`);

  // שלב 2: התאמת טריות — לפי השעון שהפולים האלה נמדדים בו
  const roastAge = daysSince(bag.roastDate);
  const openAge = daysSince(bag.openDate);
  const roastType = resolveRoastType(bean.roastType, bag.roastDate, bag.openDate);

  if (roastType === 'aged') {
    // קלייה ישנה: הגזים יצאו לפני חודשים, ולכן "עברו 95 ימים מהקלייה —
    // הפולים מאבדים גזים" הוא לא רק לא רלוונטי אלא מטעה. הוא היה מופיע
    // לצד תווית "שימוש מיטבי · יום 2 מהפתיחה" וסותר אותה באותו מסך.
    if (openAge !== null) {
      if (openAge <= AGED_OPTIMAL_DAYS) {
        beanNotes.push(`השקית נפתחה לפני ${openAge} ימים — בתוך חלון השימוש המיטבי (עד ${AGED_OPTIMAL_DAYS} יום מהפתיחה).`);
      } else if (openAge < AGED_DEADLINE_DAYS) {
        beanNotes.push(`${openAge} ימים מהפתיחה — הטעם מתחיל לרדת. הדד-ליין ביום ${AGED_DEADLINE_DAYS}.`);
      } else {
        beanNotes.push(`עברו ${openAge} ימים מהפתיחה — מעבר לדד-ליין. הארומטים כבר דהו.`);
      }
    }
    if (roastAge !== null) {
      beanNotes.push(`הקלייה בת ${roastAge} ימים, אבל הפולים סומנו כקלייה ישנה: הגזים יצאו מזמן, והזמן שנמדד הוא מהפתיחה.`);
    }
  } else {
    if (roastAge !== null) {
      if (roastAge < 5) {
        beanNotes.push(`הפולים בני ${roastAge} ימים בלבד — עדיין משחררים CO₂. צפה לקרמה תוססת ולזרימה לא יציבה; אם השוט רץ מהר, אל תמהר להאשים את הטחינה.`);
      } else if (roastAge > 30) {
        beanNotes.push(`עברו ${roastAge} ימים מהקלייה — הפולים מאבדים גזים וטעם. סביר שתצטרך טחינה עדינה בדרגה אחת מהרגיל כדי לשמור על זמן החליטה.`);
      } else {
        beanNotes.push(`הפולים בני ${roastAge} ימים — בחלון הטריות האידיאלי לאספרסו (5–30 יום).`);
      }
    }
    if (openAge !== null && openAge > 21) {
      beanNotes.push(`השקית פתוחה כבר ${openAge} ימים — חמצון מואץ. שקול לסיים אותה בקרוב.`);
    }
  }

  // ---- חלון זמן היעד: מקור האמת (כללים לפי קלייה → טריות → כיול אישי) ----
  // אותו חלון עובר גם למוח ה-AI וגם למדד "הדופק שלך", כדי שהאפליקציה לא
  // תסתור את עצמה: שוט שעמד ביעד שהיא נתנה נחשב הצלחה בכל המסכים.
  const targetWindow = computeTargetWindow({
    roastLevel: bean.roastLevel,
    roastAgeDays: roastAge,
    beanShots,
  });
  let timeMin = targetWindow.min;
  let timeMax = targetWindow.max;

  // שלב 3: למידה אישית מהפולים האלה — כיול היחס
  // (חלון הזמן כבר מכויל אישית בתוך computeTargetWindow)
  const confidence = learningConfidence(beanShots.length);
  const best = bestShotsForCalibration(beanShots);

  if (best.length > 0) {
    const avg = (pick: (s: Shot) => number) => best.reduce((a, s) => a + pick(s), 0) / best.length;
    ratio = avg((s) => shotRatio(s));
    reasons.push(`מכויל לפי ${best.length} השוטים הטובים ביותר שלך עם ${bean.name} (דירוג ממוצע ${avg((s) => s.rating).toFixed(1)}), יעד זמן ${timeMin}–${timeMax} שניות.`);
  } else if (beanShots.length > 0) {
    reasons.push(`יש ${beanShots.length} שוטים קודמים עם הפולים האלה אך אף אחד לא דורג 6+, לכן ההמלצה נשארת על הכללים הכלליים.`);
  }

  // דרגת טחינה: רק מהמטחנה הנוכחית (סקאלות שונות בין מטחנות)
  let grindSetting: number | null = null;
  const goodGrinderShots = grinderShots.filter((s) => s.rating >= 6);
  if (goodGrinderShots.length > 0) {
    const best = [...goodGrinderShots].sort((a, b) => b.rating - a.rating)[0];
    grindSetting = best.grindSetting;
    reasons.push(`דרגת טחינה ${grindSetting} — מהשוט הכי מוצלח שלך עם הפולים האלה על המטחנה הנוכחית.`);
  } else if (lastGrinderShot) {
    // אין היסטוריה לפולים האלה על המטחנה — ממשיכים מהדרגה האחרונה שהוזנה עליה
    grindSetting = lastGrinderShot.grindSetting;
    reasons.push(`דרגת טחינה ${grindSetting} — הדרגה האחרונה שציינת על ${grinder?.name ?? 'המטחנה הזו'} (בפולים אחרים). נקודת פתיחה — עדן ממנה לפי זמן החליטה.`);
  } else {
    reasons.push('אין עדיין היסטוריית טחינה על המטחנה הנוכחית — התחל מאמצע הסקאלה ועדן לפי זמן החליטה.');
  }

  // ---- מוח ה-AI: השוט האחרון קובע את הצעד הבא (docs/Espresso_AI_Engine_Guide.md) ----
  // הניתוח מתבסס אך ורק על שוטים מהמטחנה הנוכחית — דרגות טחינה אינן
  // ברות-השוואה בין מטחנות. החלפת מטחנה = הניתוח מתחיל מחדש.
  if (grinderShots.length > 0) {
    // ההיסטוריה שנשלחת למוח היא הגולמית: הוא מסנן אותה בעצמו, אבל צריך
    // לראות בה את השוטים שנחנקו כדי לדעת איפה הקצה הדק
    const history = [...rawGrinderShots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = [...grinderShots].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-1)[0];
    // פער הימים מאז השוט האחרון — להתראת הזדקנות של המוח
    const gapDays = Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 86400000);
    const ai = aiRecommend({
      lastShot: last, beanShots: history, grinder,
      agingGapDays: gapDays, roastAgeDays: roastAge,
      targetWindow,
    });

    // Yield: יעד המוח, מותאם פרופורציונלית אם המשתמש בחר מנה שונה
    ratio = ai.targets.doseGrams > 0 ? ai.targets.yieldGrams / ai.targets.doseGrams : ratio;

    // דרגת הטחינה של המוח מעוגנת תמיד לדרגה האחרונה שהוזנה על המטחנה הזו
    // (שינוי של צעד אחד לכל היותר, או אותה דרגה אם אין צורך בשינוי) —
    // והיא מחליפה את שורת ההסבר הישנה כדי שלא יהיו שני מספרים סותרים.
    grindSetting = ai.targets.grindSetting;
    recommendedTemp = ai.targets.machineTemp ?? last.machineTemp;
    const oldGrindReason = reasons.findIndex((r) => r.startsWith('דרגת טחינה'));
    if (oldGrindReason !== -1) reasons.splice(oldGrindReason, 1);

    // זמן יעד: אם המוח אומר "לא לשנות" — מכוונים לזמן של השוט המוצלח
    if (ai.changeKind === 'none' && last.brewTimeSec > 0) {
      timeMin = Math.max(15, last.brewTimeSec - 2);
      timeMax = last.brewTimeSec + 2;
    }

    reasons.unshift(
      `🧠 מוח ה-AI (ביטחון ${ai.confidencePct}%): ${ai.changeKind === 'none'
        ? 'השוט האחרון היה במקום הנכון — חוזרים עליו במדויק.'
        : ai.instruction}`,
    );
    // התראות המוח (הזדקנות, זמן קיצוני וכו') — מוצגות גם בשלב התכנון
    for (const w of ai.warnings) reasons.push(`⚠️ ${w}`);
  } else if (beanShots.length > 0) {
    reasons.unshift(
      `🧠 מוח ה-AI: ${grinder ? `המטחנה "${grinder.name}"` : 'המטחנה הנוכחית'} עדיין בלי שוטים של הפולים האלה — הניתוח יתחיל מהשוט הראשון עליה. דרגות טחינה מהמטחנה הקודמת אינן תקפות כאן.`,
    );
  }

  // נקודת עצירה בפועל: לפי הטפטוף הנמדד שלך (אם תועד), אחרת ~3.5 גרם משוער
  const drips = beanShots
    .filter((s) => s.yieldStopGrams && s.yieldGrams > (s.yieldStopGrams ?? 0))
    .map((s) => s.yieldGrams - (s.yieldStopGrams ?? 0));
  const dripMeasured = drips.length >= 2;
  const avgDrip = dripMeasured ? drips.reduce((a, b) => a + b, 0) / drips.length : 3.5;
  const stopAtGrams = round1(Math.max(dose, dose * ratio - avgDrip));
  if (dripMeasured) {
    reasons.push(`הטפטוף הממוצע שלך אחרי עצירה הוא ~${round1(avgDrip)} גרם — עצור בערך ב-${stopAtGrams} גרם כדי לנחות על היעד הסופי.`);
  }

  // הערות היסטוריות חופשיות אחרונות
  const notedShots = beanShots.filter((s) => s.notes.trim().length > 0).slice(0, 2);
  for (const s of notedShots) {
    beanNotes.push(`מהיומן שלך (${new Date(s.createdAt).toLocaleDateString('he-IL')}): "${s.notes}"`);
  }

  return {
    doseGrams: round1(dose),
    yieldGrams: round1(dose * ratio),
    stopAtGrams,
    brewTimeSecMin: timeMin,
    brewTimeSecMax: timeMax,
    ratio: Math.round(ratio * 10) / 10,
    grindSetting,
    machineTemp: recommendedTemp,
    confidence,
    basedOnShots: beanShots.length,
    reasons,
    beanNotes,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function roastLabel(r: RoastLevel): string {
  const map: Record<RoastLevel, string> = {
    'light': 'בהירה',
    'light-medium': 'בהירה-בינונית',
    'medium': 'בינונית',
    'medium-dark': 'בינונית-כהה',
    'dark': 'כהה',
  };
  return map[r];
}

export function confidenceLabel(c: ShotRecommendation['confidence'], n: number): string {
  switch (c) {
    case 'rules': return 'מבוסס על כללים מקצועיים בלבד — אין עדיין היסטוריה לפולים האלה';
    case 'low': return `ביטחון נמוך — מבוסס על ${n} שוטים בלבד`;
    case 'medium': return `ביטחון בינוני — מבוסס על ${n} שוטים`;
    case 'high': return `ביטחון גבוה — מבוסס על ${n} שוטים מההיסטוריה שלך`;
  }
}
