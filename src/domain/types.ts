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
  | 'other';

// גלגל טעמים בהשראת SCA — שכבה נוספת מעל תגיות הטעם הבסיסיות
export type FlavorNote =
  | 'fruity' // פירותי
  | 'citrus' // הדרים
  | 'berries' // פירות יער
  | 'floral' // פרחוני
  | 'chocolate' // שוקולד
  | 'caramel' // קרמל
  | 'nutty' // אגוזי
  | 'honey' // דבש
  | 'vanilla' // וניל
  | 'spices' // תבלינים
  | 'earthy' // אדמתי
  | 'smoky' // מעושן
  | 'winey' // ייני
  | 'buttery'; // חמאתי

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
  flavorNotes?: FlavorNote[]; // גלגל טעמים — אופציונלי (שוטים ישנים בלעדיו)
  body: QualityLevel | null;
  crema: QualityLevel | null;
  aftertaste: QualityLevel | null;
  notes: string;
  rating: number; // 1-10
  favorite?: boolean; // ⭐ מסומן כמתכון שמור
}

// ערכים נגזרים (מחושבים, לא נשמרים)
export function shotRatio(s: Pick<Shot, 'doseGrams' | 'yieldGrams'>): number {
  return s.doseGrams > 0 ? s.yieldGrams / s.doseGrams : 0;
}
export function shotFlowRate(s: Pick<Shot, 'yieldGrams' | 'brewTimeSec'>): number {
  return s.brewTimeSec > 0 ? s.yieldGrams / s.brewTimeSec : 0;
}

// --- Dial-In Session ---

export type DialInStatus = 'active' | 'dialed-in' | 'abandoned';

export interface DialInSession {
  id: ID;
  userId: ID;
  bagId: ID;
  status: DialInStatus;
  startedAt: string;
  completedAt: string | null;
  bestShotId: ID | null;
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
  yieldGrams: number;
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
