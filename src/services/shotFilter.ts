import type { Shot } from '../domain/types';

// ============================================================
// אמינות הרשומה — מסנן אחד לכל המנועים
// ============================================================
// המוח, חלון היעד, מדידת ההזדקנות וביקורת ההמלצות כולם קוראים את אותו
// יומן. עד עכשיו לא הייתה שום דרך לומר להם ששורה מסוימת אינה מדידה:
// שוט ראשון אחרי מעבר פולים נושא שאריות של הקודמים במטחנה, ושוט שנחנק
// אין לו זמן חליטה במובן הרגיל. שורה אחת כזו מזיזה את חלון היעד האישי
// ואת ההמלצה שנגזרת ממנו, ואי אפשר לתקן את זה בלי לזרוק את השוט מהיומן.
//
// כאן מוגדר מה נחשב "מדיד". היומן ממשיך להראות הכול; החישובים לא.

export function isAnalyzable(s: Shot): boolean {
  return !s.excluded && !s.choked;
}

export function analyzable<T extends Shot>(shots: T[]): T[] {
  return shots.filter(isAnalyzable);
}

// ---- הקיר הדק ----
// דרגת הטחינה הגסה ביותר שבה המכונה נחנקה בפולים האלה. מתחתיה (וכולל
// אותה) אין טעם לשלוח — זה לא כיול, זו חניקה נוספת. מחושב מהרשימה הגולמית
// דווקא: שוט חנוק אינו מדיד לזמן, אבל דרגת הטחינה שלו היא המידע עצמו.
export function chokeFloor(rawShots: Shot[]): number | null {
  const choked = rawShots.filter((s) => s.choked && s.grindSetting > 0);
  if (choked.length === 0) return null;
  return Math.max(...choked.map((s) => s.grindSetting));
}

// הדרגה הדקה ביותר שמותר להמליץ עליה: צעד אחד גס מהקיר.
export function fineLimit(floor: number | null, grindStep: number): number | null {
  return floor === null ? null : Math.round((floor + grindStep) * 10) / 10;
}
