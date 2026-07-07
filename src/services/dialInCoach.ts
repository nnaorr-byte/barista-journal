import {
  shotFlowRate, shotRatio, type CoachAdvice, type ExtractionVerdict, type Shot,
} from '../domain/types';

// ה-AI Coach: מאבחן כל שוט לפי טעם + מספרים, מחליט אם מדובר
// ב-Under/Over Extraction או Channeling, ובוחר משתנה אחד בלבד לשינוי.
// סדר עדיפויות מקצועי: טחינה ← מנה/יחס ← טמפרטורה. משנים קודם את
// המשתנה בעל ההשפעה הגדולה ביותר, ותמיד אחד בכל פעם.

const ONE_VAR = 'זכור: משנים משתנה אחד בלבד בכל ניסיון. רק כך אפשר לדעת מה באמת השפיע.';

export function analyzeShot(shot: Shot): CoachAdvice {
  const ratio = shotRatio(shot);
  const flow = shotFlowRate(shot);
  const tags = new Set(shot.tasteTags);

  const sour = tags.has('sour');
  const bitter = tags.has('bitter');
  const watery = tags.has('watery');
  const dry = tags.has('dry');
  const balanced = tags.has('balanced') || tags.has('sweet');

  const fast = shot.brewTimeSec > 0 && shot.brewTimeSec < 22;
  const slow = shot.brewTimeSec > 34;
  const fastFlow = flow > 2.2; // גרם/שנייה — זרימה מהירה מדי
  const longRatio = ratio > 2.6;
  const shortRatio = ratio > 0 && ratio < 1.6;

  let verdict: ExtractionVerdict;

  // Channeling: סימנים סותרים — גם חמוץ וגם מר, או זרימה מהירה עם מרירות.
  // בפורטפילטר Bottomless זה בדרך כלל נראה כהתזות (spritzers).
  if ((sour && bitter) || (fastFlow && bitter)) {
    verdict = 'channeling';
  } else if (sour || watery || (fast && !bitter)) {
    verdict = 'under';
  } else if (bitter || dry || (slow && !sour)) {
    verdict = 'over';
  } else if (balanced && shot.rating >= 7) {
    verdict = 'balanced';
  } else {
    verdict = 'unclear';
  }

  switch (verdict) {
    case 'under':
      return {
        verdict,
        verdictLabel: 'תת-מיצוי (Under Extraction)',
        explanation: buildUnderExplanation(shot, fast, watery, longRatio),
        changeVariable: 'דרגת טחינה',
        changeInstruction: 'טחן עדין יותר בצעד אחד (או שניים אם השוט רץ מתחת ל-20 שניות). כל שאר הפרמטרים נשארים זהים.',
        whyThisVariable: 'טחינה היא המשתנה בעל ההשפעה הגדולה ביותר על קצב המיצוי. טחינה עדינה יותר מאטה את הזרימה, מגדילה את שטח המגע בין המים לקפה, ומעלה את המיצוי — בדיוק מה שחסר בשוט חמוץ/מימי.',
        doNotChange: ['מנת הקפה (Dose)', 'ה-Yield', 'טמפרטורת המכונה', 'סוג הסלסלה'],
        nextShotPreview: `הניסיון הבא: אותה מנה (${shot.doseGrams} גרם), אותו יעד Yield (~${shot.yieldGrams} גרם), טחינה עדינה יותר בצעד. צפה לזמן חליטה ארוך ב-3–5 שניות ולפחות חמיצות.`,
        oneVariableReminder: ONE_VAR,
      };

    case 'over':
      return {
        verdict,
        verdictLabel: 'מיצוי-יתר (Over Extraction)',
        explanation: buildOverExplanation(shot, slow, dry, shortRatio),
        changeVariable: 'דרגת טחינה',
        changeInstruction: 'טחן גס יותר בצעד אחד. כל שאר הפרמטרים נשארים זהים.',
        whyThisVariable: 'מרירות ויובש נובעים ממיצוי מוגזם — המים שוהים יותר מדי זמן במגע עם חלקיקים דקים מדי. הגסה של הטחינה מקצרת את זמן המגע ועוצרת את המיצוי לפני התרכובות המרות.',
        doNotChange: ['מנת הקפה (Dose)', 'ה-Yield', 'טמפרטורת המכונה'],
        nextShotPreview: `הניסיון הבא: אותה מנה (${shot.doseGrams} גרם), אותו יעד Yield, טחינה גסה יותר בצעד. צפה לזמן קצר ב-3–5 שניות ולפחות מרירות.`,
        oneVariableReminder: ONE_VAR,
      };

    case 'channeling':
      return {
        verdict,
        verdictLabel: 'חשד לתיעול (Channeling)',
        explanation: `השוט מציג סימנים סותרים — ${sour && bitter ? 'גם חמיצות וגם מרירות בו-זמנית' : 'זרימה מהירה יחד עם מרירות'}. זה כמעט תמיד תיעול: המים מוצאים נתיב קל דרך הפאק, ממצים יתר על המידה חלק אחד ומזניחים אחר. בפורטפילטר Bottomless תראה את זה כהתזות או זרימה לא אחידה מהתחתית.`,
        changeVariable: 'הכנת הפאק (לא הגדרה!)',
        changeInstruction: 'אל תשנה אף הגדרה. שפר את ההכנה: WDT יסודי יותר (עומק מלא, תנועות איטיות), פיזור אחיד לפני הטמפינג, טמפינג ישר ומאוזן, ו-Puck Screen מונח ישר.',
        whyThisVariable: 'שינוי טחינה או מנה כשיש תיעול רק מוסיף רעש — האבחון של השוט הבא יהיה שגוי. קודם מוודאים פאק אחיד, ורק אז מכיילים הגדרות.',
        doNotChange: ['דרגת טחינה', 'מנת הקפה', 'ה-Yield', 'טמפרטורה'],
        nextShotPreview: 'הניסיון הבא: אותן הגדרות בדיוק, עם דגש על הכנת פאק מוקפדת. צפה בזרימה מה-Bottomless — היא צריכה להתאחד לזרם אחד מרכזי בצבע דבש.',
        oneVariableReminder: ONE_VAR,
      };

    case 'balanced':
      return {
        verdict,
        verdictLabel: 'שוט מאוזן — כל הכבוד! ☕',
        explanation: `דירוג ${shot.rating}/10 עם טעם מאוזן, יחס 1:${ratio.toFixed(1)} ו-${shot.brewTimeSec} שניות. ההגדרות האלה נשמרו וישמשו כבסיס להמלצות הבאות עבור הפולים האלה.`,
        changeVariable: 'שום דבר',
        changeInstruction: shot.rating >= 9
          ? 'מצאת את המתכון. תעד אותו והישאר עליו כל עוד הפולים באותו חלון טריות.'
          : 'השוט טוב אך יש עוד לאן לשאוף. אם תרצה לחדד — נסה שינוי זעיר ב-Yield (±2 גרם) בשוט הבא ובדוק אם המתיקות עולה.',
        whyThisVariable: 'כשהשוט מאוזן, כל שינוי גדול הוא סיכון. שיפור מכאן נעשה בצעדים זעירים של משתנה אחד.',
        doNotChange: ['דרגת טחינה', 'מנת הקפה', 'טמפרטורה'],
        nextShotPreview: 'הניסיון הבא: חזרה מדויקת על אותו מתכון. עקביות היא ההוכחה שהמתכון אמיתי ולא מזל.',
        oneVariableReminder: ONE_VAR,
      };

    case 'unclear':
      return {
        verdict,
        verdictLabel: 'תמונה לא חד-משמעית',
        explanation: `הנתונים לא מציירים תמונה ברורה של תת-מיצוי או מיצוי-יתר (יחס 1:${ratio.toFixed(1)}, ${shot.brewTimeSec} שניות, דירוג ${shot.rating}/10). ייתכן שהבעיה בעדינות הטעם — נסה לזהות בשוט הבא: החמיצות מרגישה חדה (תת-מיצוי) או שהמרירות שורפת בסוף (מיצוי-יתר)?`,
        changeVariable: 'שום דבר עדיין',
        changeInstruction: 'חזור על אותן הגדרות בדיוק והתמקד בטעימה: לגימה ראשונה (חמיצות), אמצע (גוף ומתיקות), סיום (מרירות ו-Aftertaste).',
        whyThisVariable: 'שינוי בלי אבחנה ברורה הוא ניחוש. שוט חוזר עם טעימה ממוקדת ייתן לנו אבחנה אמינה.',
        doNotChange: ['הכול — חזור על אותו מתכון'],
        nextShotPreview: 'הניסיון הבא: אותן הגדרות, טעימה מובנית, ותיוג טעם מדויק יותר.',
        oneVariableReminder: ONE_VAR,
      };
  }
}

function buildUnderExplanation(shot: Shot, fast: boolean, watery: boolean, longRatio: boolean): string {
  const parts: string[] = ['השוט מציג סימני תת-מיצוי: המים לא הספיקו למצות מהקפה את הסוכרים והתרכובות המאוזנות.'];
  if (shot.tasteTags.includes('sour')) parts.push('חמיצות חדה היא הסימן הקלאסי — חומצות הפרי מתמצות ראשונות, והמתיקות שמאזנת אותן עוד לא הגיעה.');
  if (fast) parts.push(`זמן חליטה של ${shot.brewTimeSec} שניות קצר מדי — המים עברו מהר מדי דרך הפאק.`);
  if (watery) parts.push('תחושה מימית מעידה על מיצוי חלש וגוף דל.');
  if (longRatio) parts.push(`יחס של 1:${shotRatio(shot).toFixed(1)} ארוך — המים המאוחרים דיללו את המשקה.`);
  return parts.join(' ');
}

function buildOverExplanation(shot: Shot, slow: boolean, dry: boolean, shortRatio: boolean): string {
  const parts: string[] = ['השוט מציג סימני מיצוי-יתר: המים מיצו מהקפה גם את התרכובות המרות והעפיצות שמגיעות בסוף המיצוי.'];
  if (shot.tasteTags.includes('bitter')) parts.push('מרירות שורפת בסוף הלגימה היא הסימן המובהק.');
  if (dry) parts.push('תחושת יובש (עפיצות) בפה נגרמת מטאנינים שמתמצים במיצוי ממושך.');
  if (slow) parts.push(`זמן חליטה של ${shot.brewTimeSec} שניות ארוך מדי — המים שהו יותר מדי במגע עם הקפה.`);
  if (shortRatio) parts.push(`יחס של 1:${shotRatio(shot).toFixed(1)} קצר מאוד — ריכוז גבוה שמעצים את המרירות.`);
  return parts.join(' ');
}
