// ===== ישויות הליבה של יומן הבריסטה =====
// כל ישות מקושרת ל-userId/machineId/grinderId כדי לאפשר בעתיד
// ריבוי משתמשים, מכונות ומטחנות בלי שינוי סכמה.

export type ID = string;

export interface UserProfile {
  id: ID;
  name: string;
  defaultDoseGrams: number; // ברירת מחדל 16
  doseRangeMin: number; // 15.8
  doseRangeMax: number; // 16.5
  createdAt: string; // ISO
}

export type MachineTempSetting = 'low' | 'medium' | 'high';

export interface Machine {
  id: ID;
  userId: ID;
  name: string; // "DeLonghi EC685"
  brand: string;
  model: string;
  defaultTemp: MachineTempSetting;
  portafilterTypes: string[]; // ["Bottomless", "Standard"]
  accessories: string[]; // ["WDT", "Tamper", "Puck Screen"]
  isDefault: boolean;
}

export type GrinderType = 'manual' | 'electric';

export interface Grinder {
  id: ID;
  userId: ID;
  name: string;
  type: GrinderType;
  scaleMin: number;
  scaleMax: number;
  scaleStep: number;
  isDefault: boolean;
}

export type RoastLevel = 'light' | 'light-medium' | 'medium' | 'medium-dark' | 'dark';

export interface Bean {
  id: ID;
  userId: ID;
  name: string;
  roastery: string; // בית קלייה
  originCountry: string;
  variety: string; // זן
  process: string; // Washed / Natural / Honey...
  roastLevel: RoastLevel;
  notes: string;
  createdAt: string;
  archived: boolean;
}

export interface Bag {
  id: ID;
  beanId: ID;
  roastDate: string | null; // ISO date
  openDate: string | null;
  price: number | null; // ₪
  weightGrams: number; // משקל השקית
  finished: boolean;
  createdAt: string;
}

// --- שוט ---

export type TasteTag =
  | 'sour' // חמוץ
  | 'bitter' // מר
  | 'balanced' // מאוזן
  | 'sweet' // מתוק
  | 'dry' // יבש
  | 'watery' // מימי
  | 'flat' // חסר מתיקות — שטוח, בלי המתיקות שמאזנת (DIAL IN v2.0)
  | 'other';

// גלגל טעמים בהשראת SCA — שכבה נוספת מעל תגיות הטעם הבסיסיות

export type QualityLevel = 'poor' | 'ok' | 'good' | 'excellent';

export interface Shot {
  id: ID;
  userId: ID;
  machineId: ID;
  grinderId: ID;
  beanId: ID;
  bagId: ID;
  dialInSessionId: ID | null;
  createdAt: string; // ISO datetime

  doseGrams: number; // גרם נכנס
  yieldStopGrams?: number | null; // גרם בעצירה בפועל (לפני הטפטוף)
  yieldGrams: number; // גרם סופי בכוס, אחרי הטפטוף — הבסיס לכל החישובים
  brewTimeSec: number; // זמן חליטה
  grindSetting: number; // דרגת טחינה (ביחס למטחנה)
  machineTemp: MachineTempSetting;
  basketType: string; // סוג סלסלה
  portafilterType: string; // סוג פורטפילטר

  tasteTags: TasteTag[]; // רב-בחירה
  tasteOther: string;
  body: QualityLevel | null;
  crema: QualityLevel | null;
  aftertaste: QualityLevel | null;
  notes: string;
  rating: number; // 1-10
  favorite?: boolean; // ⭐ מסומן כמתכון שמור
  aiAdvice?: AiAdvice | null; // ההמלצה שהמוח נתן על השוט הזה, כפי שנשמרה בזמן אמת
}

// ערכים נגזרים (מחושבים, לא נשמרים)
export function shotRatio(s: Pick<Shot, 'doseGrams' | 'yieldGrams'>): number {
  return s.doseGrams > 0 ? s.yieldGrams / s.doseGrams : 0;
}
export function shotFlowRate(s: Pick<Shot, 'yieldGrams' | 'brewTimeSec'>): number {
  return s.brewTimeSec > 0 ? s.yieldGrams / s.brewTimeSec : 0;
}

// --- המלצת מוח ה-AI (נשמרת עם כל שוט) ---

export interface AiTargets {
  doseGrams: number;
  yieldGrams: number;
  grindSetting: number;
  machineTemp?: MachineTempSetting; // יעד טמפרטורה (כשהמוח ממליץ לשנות אותה)
}

export interface AiAdvice {
  tone: 'good' | 'warn' | 'bad' | 'info';
  lastShotSummary: string; // 1. סיכום השוט האחרון
  diagnosis: string; // 2. אבחון
  changeKind: 'none' | 'grind' | 'yield' | 'dose' | 'temp' | 'prep' | 'recipe';
  changeLabel: string; // 3. השינוי היחיד
  instruction: string;
  targets: AiTargets; // הפרמטרים המומלצים לשוט הבא
  expectedResult: string; // 4. תוצאה צפויה
  confidencePct: number; // 5. רמת ביטחון 0–100
  confidenceReasons: string[];
  warnings: string[];
  recipeNote: string | null;
  reminder: string; // 6. תזכורת
  dialIn?: DialInState | null; // מלא רק כשההמלצה ניתנה בתוך תהליך כיול
}

// --- Dial-In Session ---

export type DialInStatus = 'active' | 'dialed-in' | 'abandoned';

// full    — פולים שלא הכרנו: התהליך המלא של DIAL IN v2.0.
// recheck — שקית נוספת של פולים שכבר כוילו: אותם שלבים, אבל נזרעים
//           מהמתכון השמור. רק תאריך הקלייה השתנה, לא הפולים.
export type DialInKind = 'full' | 'recheck';

// שלבי המדריך. שלב 2 ("הערכת הטעם") הוא פעולה של המשתמש ולא של המנוע,
// ולכן אינו מצב במכונה — הוא מה שקורה בין 'window' ל-'taste'.
export type DialInPhase =
  | 'window' // שלב 1 — טחינה בלבד עד כניסה לחלון הזמן
  | 'taste' // שלב 3 — כוונון עדין, בעיקר Yield
  | 'sweet-spot' // שלב 4 — פתיחת טחינה עד שהאיכות יורדת
  | 'confirm'; // ממתין לאישור המתכון

export interface DialInSession {
  id: ID;
  userId: ID;
  bagId: ID;
  status: DialInStatus;
  startedAt: string;
  completedAt: string | null;
  bestShotId: ID | null;
  // שדות הכיול המונחה. אופציונליים בכוונה: סשנים שנוצרו לפני DIAL IN v2.0
  // כבר יושבים ב-IndexedDB בלי השדות האלה, ונופלים לברירות המחדל.
  kind?: DialInKind;
  phase?: DialInPhase;
  targetYieldGrams?: number; // ה-Yield שאליו חוזרים כשמשנים טחינה
  lockedDoseGrams?: number; // Dose קפוא עד סוף הכיול (עיקרון הזהב 3)
  sweetSpotBestShotId?: ID | null; // הטוב ביותר עד כה בשלב הציד
}

// מצב הכיול אחרי השוט הזה. נשמר בתוך ההמלצה של כל שוט, ומשמש גם
// כמקור לעדכון ה-DialInSession — כך אין שני מקומות שמחזיקים את אותו מצב.
export interface DialInState {
  kind: DialInKind;
  phase: DialInPhase;
  phaseStep: 1 | 3 | 4; // מספר השלב במדריך (2 הוא פעולת המשתמש)
  phaseLabel: string;
  shotIndex: number; // כמה שוטים נעשו בסשן הזה, כולל הנוכחי
  readyToConfirm: boolean; // יש שוט טוב מספיק — אפשר לאשר את המתכון
  targetYieldGrams: number;
  lockedDoseGrams: number;
  sweetSpotBestShotId: ID | null;
}

// --- תמונות מצב אוטומטיות ---
// עותק מלא של כל הטבלאות, נשמר בתוך ה-IndexedDB עצמו. מגן מפני מחיקה
// בטעות, שחזור כושל או באג — לא מפני "נקה נתוני אתר" או איפוס מכשיר.
// להגנה מהאלה יש רק גיבוי חיצוני, ולכן שתי השכבות חיות זו לצד זו.
export interface DataSnapshot {
  id: ID;
  createdAt: string;
  shotCount: number;
  sizeBytes: number;
  payload: string; // JSON של קובץ הגיבוי — מחרוזת, לא אובייקט מקונן
}

// --- תחזוקה ---

export type MaintenanceKind = 'machine-backflush' | 'machine-descale' | 'grinder-clean';

export interface MaintenanceEvent {
  id: ID;
  userId: ID;
  kind: MaintenanceKind;
  equipmentId: ID; // machineId או grinderId
  performedAt: string; // ISO date
  notes: string;
}

export interface MaintenanceRule {
  kind: MaintenanceKind;
  label: string;
  intervalDays: number;
}

// --- המלצות ---

export interface ShotRecommendation {
  doseGrams: number;
  yieldGrams: number; // יעד סופי בכוס (אחרי טפטוף)
  stopAtGrams: number | null; // איפה לעצור בפועל — לפי הטפטוף הנמדד/משוער
  brewTimeSecMin: number;
  brewTimeSecMax: number;
  ratio: number;
  grindSetting: number | null; // null אם אין היסטוריה למטחנה
  machineTemp: MachineTempSetting;
  confidence: 'rules' | 'low' | 'medium' | 'high'; // כללי / 1-4 שוטים / 5-14 / 15+
  basedOnShots: number;
  reasons: string[]; // הסברים בעברית
  beanNotes: string[]; // הערות מהיסטוריה של הפולים האלה
}

export type ExtractionVerdict = 'under' | 'over' | 'balanced' | 'channeling' | 'unclear';

export interface CoachAdvice {
  verdict: ExtractionVerdict;
  verdictLabel: string;
  explanation: string; // למה הגענו למסקנה
  changeVariable: string; // המשתנה היחיד לשינוי
  changeInstruction: string; // מה בדיוק לעשות
  whyThisVariable: string;
  doNotChange: string[]; // מה לא לגעת בו
  nextShotPreview: string; // איך ייראה הניסיון הבא
  oneVariableReminder: string;
}
