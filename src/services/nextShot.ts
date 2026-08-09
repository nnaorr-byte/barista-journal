import type {
  AiAdvice, Bag, Bean, DialInSession, Grinder, Shot, ShotRecommendation, UserProfile,
} from '../domain/types';
import { aiRecommend } from './aiEngine';
import { computeAgingSlope, computeRepeatability } from './aging';
import { daysSince, recommendShot } from './recommendation';
import { computeTargetWindow } from './targetWindow';

// ============================================================
// "ההמלצה לשוט הבא" — מקור אחד
// ============================================================
// שלושה מסכים שואלים את אותה שאלה: מסך הבית, שלב ההכנה בשוט חדש, וה"מה
// עכשיו" של השוט האחרון ביומן. עד עכשיו כל אחד הרכיב אותה בעצמו, וזה
// נשבר בכל פעם מחדש: מסך אחד קרא המלצה שמורה בזמן שאחר חישב חי, ומסך
// השוט קרא ל-recommendShot בלי הקשר הכיול — ולכן נתן טחינה 9 בזמן ששני
// המסכים האחרים אמרו "הקטן Yield ב-1 גרם".
//
// כאן ההרכבה נעשית פעם אחת: המלצת הבסיס הסטטיסטית, ומעליה — כשיש כיול
// פעיל לשקית הזו — יעדי הכיול, שגוברים על הממוצע. שני מקורות מספרים על
// אותו מסך זו סתירה; שני מסכים עם מספרים שונים זה באג.

export interface NextShot {
  recommendation: ShotRecommendation;
  // ההמלצה המלאה של המוח בתוך כיול פעיל. null כשאין כיול על השקית הזו.
  dialInAdvice: AiAdvice | null;
  session: DialInSession | null;
  sessionShots: Shot[]; // מהישן לחדש
}

export function nextShotRecommendation(p: {
  user: UserProfile;
  bean: Bean;
  bag: Bag;
  shots: Shot[]; // כל השוטים, מהחדש לישן
  grinders: Grinder[];
  sessions: DialInSession[];
  grinderId?: string;
  doseGrams?: number;
  // שורת הסבר שנדחפת לראש הנימוקים (למשל "עברת לשקית חדשה")
  leadReason?: string | null;
}): NextShot {
  const { user, bean, bag, shots, grinders, sessions } = p;
  const lastShot = shots[0];
  const defaultGrinder = grinders.find((g) => g.isDefault) ?? grinders[0];
  const gId = p.grinderId ?? lastShot?.grinderId ?? defaultGrinder?.id;

  const base = recommendShot({
    user,
    bean,
    bag,
    beanShots: shots.filter((s) => s.beanId === bean.id),
    grinderShots: shots.filter((s) => s.beanId === bean.id && s.grinderId === gId),
    doseGrams: p.doseGrams,
    grinder: grinders.find((g) => g.id === gId),
    lastGrinderShot: shots.find((s) => s.grinderId === gId),
  });

  // הכיול שייך לשקית, לא למשתמש: סשן פעיל של שקית אחרת לא אמור לשנות
  // את המספרים של זו שמכינים ממנה עכשיו.
  const session = sessions.find((s) => s.status === 'active' && s.bagId === bag.id) ?? null;
  const sessionShots = session
    ? shots
        .filter((s) => s.dialInSessionId === session.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  const sessionLast = sessionShots[sessionShots.length - 1] ?? null;

  // מחושב חי ולא נקרא מ-aiAdvice שנשמר: המלצה שמורה היא צילום רגע, והיא
  // לא יודעת ששוט סומן כלא-מייצג מאז, שתועדה חניקה או שהמנוע התעדכן.
  let dialInAdvice: AiAdvice | null = null;
  if (session && sessionLast) {
    const sgId = sessionLast.grinderId;
    const beanHistory = shots
      .filter((s) => s.beanId === bean.id && s.grinderId === sgId)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const roastAge = daysSince(bag.roastDate);
    const bagShots = shots.filter((s) => s.bagId === bag.id);
    try {
      dialInAdvice = aiRecommend({
        lastShot: sessionLast,
        beanShots: beanHistory,
        grinder: grinders.find((g) => g.id === sgId),
        roastAgeDays: roastAge,
        targetWindow: computeTargetWindow({
          roastLevel: bean.roastLevel,
          roastAgeDays: roastAge,
          beanShots: beanHistory,
        }),
        dialIn: { session, sessionShots },
        prepSpread: computeRepeatability(bagShots, [bag], computeAgingSlope(bagShots, [bag])),
      });
    } catch {
      dialInAdvice = sessionLast.aiAdvice ?? null; // מוטב המלצה ישנה מכרטיס ריק
    }
  }

  const withLead = p.leadReason
    ? { ...base, reasons: [p.leadReason, ...base.reasons] }
    : base;

  const state = dialInAdvice?.dialIn ?? null;
  if (!state || !dialInAdvice) {
    return { recommendation: withLead, dialInAdvice: null, session, sessionShots };
  }

  // יעדי הכיול גוברים על הממוצע. הטפטוף שנמדד נשמר — רק היעד שהוא
  // נגזר ממנו מתחלף.
  const t = dialInAdvice.targets;
  const drip = withLead.stopAtGrams !== null ? withLead.yieldGrams - withLead.stopAtGrams : null;
  return {
    recommendation: {
      ...withLead,
      doseGrams: t.doseGrams,
      yieldGrams: t.yieldGrams,
      grindSetting: t.grindSetting,
      stopAtGrams: drip !== null ? Math.round((t.yieldGrams - drip) * 10) / 10 : null,
      // מעוגל כמו ב-recommendShot — אחרת מסך אחד הציג 1:1.9 והשני 1:1.8625
      ratio: t.doseGrams > 0
        ? Math.round((t.yieldGrams / t.doseGrams) * 10) / 10
        : withLead.ratio,
      machineTemp: t.machineTemp ?? withLead.machineTemp,
      // שורת "🧠 מוח ה-AI" של הבסיס מוסרת: recommendShot מריץ את המוח
      // בעץ ההחלטה היומיומי, בלי הקשר הכיול, ולכן היא אמרה "טחן גס יותר
      // 8.5 ← 9" בדיוק מתחת להוראת הכיול שאמרה "הקטן Yield". שתי הוראות
      // סותרות באותה מגירה. בכיול, קול הכיול הוא הקול היחיד.
      reasons: [
        `${state.phaseLabel}: המספרים כאן הם יעד הכיול, לא ממוצע ההיסטוריה. ${dialInAdvice.instruction}`,
        // גם האזהרות מוחלפות: אלה של הבסיס נולדו מאותו ניתוח חסר-הקשר.
        // ושורת הטפטוף של הבסיס יורדת כי היא חושבה מול ה-Yield של הבסיס
        // ("עצור ב-27.1") בזמן שיעד הכיול הוא אחר ("עצור ב-26.1") —
        // ההוראה של הכיול ממילא כוללת את נקודת העצירה הנכונה.
        ...withLead.reasons.filter(
          (r) => !r.startsWith('🧠') && !r.startsWith('⚠️') && !r.startsWith('הטפטוף הממוצע'),
        ),
        ...dialInAdvice.warnings.map((w) => `⚠️ ${w}`),
      ],
    },
    dialInAdvice,
    session,
    sessionShots,
  };
}
