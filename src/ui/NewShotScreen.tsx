import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { bagRepo, dialInRepo, shotRepo } from '../db/repositories';
import { recommendShot, confidenceLabel } from '../services/recommendation';
import { aiRecommend, type AiAdvice } from '../services/aiEngine';
import { DIAL_IN_DEFAULT_YIELD } from '../services/dialInEngine';
import { computeAgingSlope, computeRepeatability } from '../services/aging';
import { computeTargetWindow } from '../services/targetWindow';
import { analyzable } from '../services/shotFilter';
import type {
  Bag, DialInSession, MachineTempSetting, QualityLevel, Shot, ShotRecommendation, TasteTag,
} from '../domain/types';
import { Chips, DialInLadder, Field, RatingPicker, StatTile, VsPreviousPicker } from './components';
import { QUALITY_LABELS, TASTE_LABELS, TEMP_LABELS } from './labels';
import { BoltIcon, BrainIcon, BulbIcon, CheckIcon, ChevronDownIcon, ClipboardIcon, CupIcon, PlusIcon, SaveIcon, StarIcon, TargetIcon, TimerIcon, TrophyIcon, WarnIcon } from './icons';
import { Celebration } from './Celebration';
import type { Screen } from '../App';

type Step = 'setup' | 'brew' | 'results' | 'coach';

// טיוטה אוטומטית של הטופס — מגנה מאיבוד נתונים אם iOS הורג את האפליקציה
const DRAFT_KEY = 'shot-draft-v1';
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 שעות

// ---- צליל התראה לטיימר (Web Audio) ----
// באייפון אין רטט בדפדפן — צפצוף קצר הוא המשוב כשנכנסים/חורגים מחלון היעד.
let audioCtx: AudioContext | null = null;

// חייב להיקרא מתוך מחוות משתמש (לחיצת ההפעלה) — דרישת iOS לאודיו
function ensureAudio() {
  if (typeof AudioContext === 'undefined') return;
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
}

function beep(times: number, freq: number) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  for (let i = 0; i < times; i++) {
    const t = audioCtx.currentTime + i * 0.2;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.start(t);
    osc.stop(t + 0.16);
  }
}

const TASTE_OPTIONS = (Object.entries(TASTE_LABELS) as [TasteTag, string][]).map(
  ([value, label]) => ({ value, label }),
);
const QUALITY_OPTIONS = (Object.entries(QUALITY_LABELS) as [QualityLevel, string][]).map(
  ([value, label]) => ({ value, label }),
);

export function NewShotScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const data = useLiveQuery(async () => {
    const [user, beans, bags, shots, machines, grinders] = await Promise.all([
      db.users.toArray().then((u) => u[0]),
      db.beans.filter((b) => !b.archived).toArray(),
      db.bags.filter((b) => !b.finished).toArray(),
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.machines.toArray(),
      db.grinders.toArray(),
    ]);
    return { user, beans, bags, shots, machines, grinders };
  });

  const [step, setStep] = useState<Step>('setup');
  const stepRef = useRef(step);
  stepRef.current = step;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [beanId, setBeanId] = useState('');
  const [bagId, setBagId] = useState('');
  const [grinderId, setGrinderId] = useState('');
  const [dose, setDose] = useState('16');
  const [recommendation, setRecommendation] = useState<ShotRecommendation | null>(null);

  // תוצאות
  const [yieldStop, setYieldStop] = useState(''); // גרם בעצירה בפועל
  const [yieldGrams, setYieldGrams] = useState(''); // גרם סופי אחרי טפטוף
  const [brewTime, setBrewTime] = useState('');
  const [quick, setQuick] = useState(false); // מצב "שוט מהיר"
  // המכונה נחנקה: אין זמן, אין טעם, אין Yield אמיתי. השוט נשמר בכל זאת
  // כי דרגת הטחינה שלו היא המידע — הקצה הדק של הפולים האלה.
  const [choked, setChoked] = useState(false);
  const [grindSetting, setGrindSetting] = useState('');
  const [temp, setTemp] = useState<MachineTempSetting>('medium');
  // ברירת המחדל של נאור: סלסלת IMS מקצועית
  const [basketType, setBasketType] = useState('IMS/מקצועית');
  const [portafilterType, setPortafilterType] = useState('Bottomless');
  const [tasteTags, setTasteTags] = useState<TasteTag[]>([]);
  const [tasteOther, setTasteOther] = useState('');
  const [body, setBody] = useState<QualityLevel | null>(null);
  const [crema, setCrema] = useState<QualityLevel | null>(null);
  const [aftertaste, setAftertaste] = useState<QualityLevel | null>(null);
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(0);
  // הדירוג המוחלט דחוס בקצה העליון; ההשוואה לקודם תופסת הפרשים שהוא מחמיץ
  const [vsPrevious, setVsPrevious] = useState<'better' | 'same' | 'worse' | null>(null);
  // מגירת פירוט טעם — משאירה את שלב התוצאות רזה כברירת מחדל.
  // נפתחת אוטומטית אם כבר יש נתוני עומק (טיוטה משוחזרת), וניתנת לסגירה חופשית.
  const [showTasteDetail, setShowTasteDetail] = useState(false);
  const tasteDetailCount = (body ? 1 : 0) + (crema ? 1 : 0) + (aftertaste ? 1 : 0);
  // תווית "הסתר פירוט טעם" — מקור אחד לשני הכפתורים (המתג העליון + הכפתור במגירה)
  const hideTasteLabel = `הסתר פירוט טעם${tasteDetailCount > 0 ? ` (${tasteDetailCount} נבחרו — נשמרים)` : ''}`;
  // מתג המגירה — עוגן פוקוס קבוע לפתיחה ולסגירה
  const tasteToggleRef = useRef<HTMLButtonElement>(null);
  // מגירת ציוד — סלסלה + פורטפילטר כמעט לא משתנים שוט-לשוט, לכן מקופלים
  // כברירת מחדל. נפתחת אוטומטית אם הערך שונה מברירת המחדל (טיוטה משוחזרת).
  const DEFAULT_BASKET = 'IMS/מקצועית';
  const DEFAULT_PORTAFILTER = 'Bottomless';
  const [showEquipment, setShowEquipment] = useState(false);
  const equipmentToggleRef = useRef<HTMLButtonElement>(null);

  // כיוון המעבר האחרון בין שלבים — קובע את כיוון אנימציית הכניסה (RTL)
  const stepDirRef = useRef<'fwd' | 'back'>('fwd');

  // אינטגרציית כפתור Back בתוך הזרימה: כל שלב נרשם ב-history,
  // Back חוזר שלב אחורה; מ-Coach (אחרי שמירה) — הביתה, לא בחזרה לטופס.
  useEffect(() => {
    history.replaceState({ screen: 'new-shot', step: 'setup' }, '');
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { screen?: string; step?: Step } | null;
      if (st?.screen !== 'new-shot' || !st.step) return; // מעבר מסך — מטופל ב-App
      if (stepRef.current === 'coach') {
        navigateRef.current('home');
        return;
      }
      if (st.step === 'setup') setQuick(false);
      stepDirRef.current = 'back';
      setStep(st.step);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // מעבר שלב קדימה — נרשם בהיסטוריה
  function goStep(s: Step) {
    stepDirRef.current = 'fwd';
    history.pushState({ screen: 'new-shot', step: s }, '');
    setStep(s);
  }

  const [advice, setAdvice] = useState<AiAdvice | null>(null);
  const [multiVarWarning, setMultiVarWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // כשל שמירה (מכסת אחסון, מצב פרטי) — לעולם לא שקט: הטיוטה נשמרת ומוצגת שגיאה
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedShotId, setSavedShotId] = useState<string | null>(null);
  const [markedFavorite, setMarkedFavorite] = useState(false);
  // סשן הכיול הפעיל של השוט שנשמר — נסגר רק בלחיצה של המשתמש
  const [dialInSession, setDialInSession] = useState<DialInSession | null>(null);
  const [dialInClosed, setDialInClosed] = useState<'done' | 'stopped' | null>(null);
  // שוטי הסשן מהישן לחדש — מזינים את מסלול הכיול בכרטיס ההמלצה
  const [dialInShots, setDialInShots] = useState<Shot[]>([]);
  // רגעי delight ב-Coach: הבזק "חשיבה", חגיגת שוט מושלם, שיא אישי לפולים
  const [thinking, setThinking] = useState(false);
  const [analyzed, setAnalyzed] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [beanRecord, setBeanRecord] = useState<{ prevBest: number } | null>(null);
  const stopCelebrate = useCallback(() => setCelebrate(false), []);

  // ===== טיוטה אוטומטית =====
  // iOS עלול להרוג את האפליקציה באמצע תיעוד — הטופס נשמר מקומית
  // בכל שינוי ומשוחזר בכניסה הבאה (עד 12 שעות אחורה).
  const [draftRestored, setDraftRestored] = useState(false);
  // הפניית טיוטה שהתיישנה (פולים אורכבו / שקית נגמרה בזמן שהטיוטה חיכתה)
  const [restoreWarning, setRestoreWarning] = useState<string | null>(null);
  const draftReadyRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.savedAt && Date.now() - d.savedAt < DRAFT_MAX_AGE_MS && d.beanId) {
          setBeanId(d.beanId); setBagId(d.bagId ?? ''); setGrinderId(d.grinderId ?? '');
          setDose(d.dose ?? '16'); setRecommendation(d.recommendation ?? null);
          setYieldStop(d.yieldStop ?? ''); setYieldGrams(d.yieldGrams ?? ''); setBrewTime(d.brewTime ?? '');
          setQuick(!!d.quick); setChoked(!!d.choked);
          setGrindSetting(d.grindSetting ?? ''); setTemp(d.temp ?? 'medium');
          setBasketType(d.basketType ?? 'IMS/מקצועית'); setPortafilterType(d.portafilterType ?? 'Bottomless');
          setTasteTags(d.tasteTags ?? []); setTasteOther(d.tasteOther ?? '');
          setBody(d.body ?? null); setCrema(d.crema ?? null);
          setAftertaste(d.aftertaste ?? null); setNotes(d.notes ?? ''); setRating(d.rating ?? 0);
          setVsPrevious(d.vsPrevious ?? null);
          // טיוטה עם נתוני עומק — פותחים את מגירת הפירוט כדי שלא "ייעלמו"
          if (d.body || d.crema || d.aftertaste) setShowTasteDetail(true);
          // ציוד ששונה מברירת המחדל — פותחים את מגירת הציוד כדי שהשינוי לא "ייעלם"
          if ((d.basketType && d.basketType !== DEFAULT_BASKET) ||
              (d.portafilterType && d.portafilterType !== DEFAULT_PORTAFILTER)) setShowEquipment(true);
          // חזרה לשלב שבו עצרנו — עם רשומת היסטוריה כדי ש-Back יעבוד
          if ((d.step === 'results' || (d.step === 'brew' && d.recommendation))) {
            setStep(d.step);
            history.pushState({ screen: 'new-shot', step: d.step }, '');
          }
          setDraftRestored(true);
        }
      }
    } catch { /* טיוטה פגומה — מתעלמים */ }
    draftReadyRef.current = true;
  }, []);

  // שמירה שקטה בכל שינוי (אחרי שהשחזור הסתיים)
  useEffect(() => {
    if (!draftReadyRef.current) return;
    if (step === 'coach' || !beanId) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: Date.now(), step, beanId, bagId, grinderId, dose, recommendation,
      yieldStop, yieldGrams, brewTime, quick, choked, grindSetting, temp, basketType,
      portafilterType, tasteTags, tasteOther, body, crema, aftertaste, notes, rating, vsPrevious,
    }));
  });

  // הבזק ה"חשיבה" של ה-AI נמשך רגע קצר ואז נחשפת ההמלצה
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => setThinking(false), 850);
    return () => clearTimeout(t);
  }, [thinking]);

  // אימות טיוטה משוחזרת מול הנתונים החיים: אם הפולים אורכבו או השקית נגמרה
  // בזמן שהטיוטה חיכתה, ההפניה מתה — מנקים אותה ומבקשים לבחור מחדש,
  // כדי שהשמירה לא תיכשל בשקט (guard על selectedBean/selectedBag).
  useEffect(() => {
    if (!draftRestored || !data) return;
    if (beanId && !data.beans.some((b) => b.id === beanId)) {
      setBeanId(''); setBagId('');
      setRestoreWarning('הפולים מהטיוטה כבר לא זמינים (אורכבו או נמחקו). בחר פולים מחדש כדי לשמור.');
    } else if (bagId && !data.bags.some((b) => b.id === bagId)) {
      setBagId('');
      setRestoreWarning('השקית מהטיוטה נגמרה או הוסרה. בחר שקית מחדש כדי לשמור.');
    }
  }, [draftRestored, data, beanId, bagId]);

  // ניהול פוקוס במעברי שלב: מעבירים פוקוס לכותרת השלב החדש כדי שמשתמש
  // מקלדת/קורא-מסך לא יישאר על כפתור שנעלם, והשלב יוכרז. שלב ההתחלה
  // ו-coach (שמכריז בעצמו דרך role="status") פטורים. שלב brew מטפל בעצמו.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevStepRef = useRef<Step | null>(null);
  useEffect(() => {
    if (prevStepRef.current !== null && prevStepRef.current !== step && step !== 'coach') {
      headingRef.current?.focus();
    }
    prevStepRef.current = step;
  }, [step]);

  if (!data) return null;
  const { user, beans, bags, shots, machines, grinders } = data;
  const machine = machines.find((m) => m.isDefault) ?? machines[0];

  const beanBags = bags.filter((b) => b.beanId === beanId);
  const selectedBean = beans.find((b) => b.id === beanId);
  const selectedBag = bags.find((b) => b.id === bagId);
  const selectedGrinder = grinders.find((g) => g.id === grinderId);
  const lastShot = shots[0];

  // ---- כיול צפוי ----
  // הסשן עצמו נפתח בשמירת השוט הראשון, אבל ההודעה צריכה להגיע לפני:
  // שקית חדשה = תהליך, לא עוד שוט. אותה חוקיות בדיוק כמו בשמירה.
  const pendingDialIn = !!selectedBag && shots.every((s) => s.bagId !== selectedBag.id);
  const pendingDialInKind =
    pendingDialIn &&
    shots.some((s) => s.beanId === beanId && s.bagId !== bagId && (s.favorite || s.rating >= 8))
      ? 'recheck'
      : 'full';

  // המתכון השמור (⭐) העדכני ביותר עבור הפולים שנבחרו
  const recipeShot = beanId
    ? shots.find((s) => s.beanId === beanId && s.favorite) ?? null
    : null;

  function applyRecipe() {
    if (!recipeShot) return;
    setGrinderId(recipeShot.grinderId);
    setDose(String(recipeShot.doseGrams));
    setGrindSetting(String(recipeShot.grindSetting));
    setTemp(recipeShot.machineTemp);
    setBasketType(recipeShot.basketType);
    setPortafilterType(recipeShot.portafilterType);
    setYieldGrams(String(recipeShot.yieldGrams));
    setRecommendation({
      doseGrams: recipeShot.doseGrams,
      yieldGrams: recipeShot.yieldGrams,
      stopAtGrams: recipeShot.yieldStopGrams ?? Math.round((recipeShot.yieldGrams - 3.5) * 10) / 10,
      brewTimeSecMin: Math.max(1, recipeShot.brewTimeSec - 2),
      brewTimeSecMax: recipeShot.brewTimeSec + 2,
      ratio: Math.round((recipeShot.yieldGrams / recipeShot.doseGrams) * 10) / 10,
      grindSetting: recipeShot.grindSetting,
      machineTemp: recipeShot.machineTemp,
      confidence: 'high',
      basedOnShots: 1,
      reasons: [
        `⭐ המתכון השמור שלך מ-${new Date(recipeShot.createdAt).toLocaleDateString('he-IL')} (דירוג ${recipeShot.rating}/10). חזור עליו במדויק.`,
      ],
      beanNotes: recipeShot.notes ? [`מהמתכון: "${recipeShot.notes}"`] : [],
    });
    goStep('brew');
  }

  function applyLastShot() {
    if (!lastShot) return;
    setBeanId(lastShot.beanId);
    setBagId(lastShot.bagId);
    setGrinderId(lastShot.grinderId);
    setDose(String(lastShot.doseGrams));
    setGrindSetting(String(lastShot.grindSetting));
    setTemp(lastShot.machineTemp);
    setBasketType(lastShot.basketType);
    setPortafilterType(lastShot.portafilterType);
  }

  // שוט מהיר: כבר עשית dial-in והאספרסו זורם באותו טעם.
  // משכפלים הכול מהשוט האחרון (כולל הטעם המסומן), נכנסים לטיימר העגול,
  // ובתוצאות מזינים מחדש רק מה שנמדד בפועל: עצירה / סופי / זמן.
  function startQuickShot() {
    if (!lastShot) return;
    applyLastShot(); // פולים, שקית, מטחנה, מנה, טחינה, טמפרטורה, ציוד
    setYieldStop(lastShot.yieldStopGrams != null ? String(lastShot.yieldStopGrams) : '');
    setYieldGrams(String(lastShot.yieldGrams));
    setTasteTags(lastShot.tasteTags);
    setTasteOther(lastShot.tasteOther ?? '');
    setBody(lastShot.body ?? null);
    setCrema(lastShot.crema ?? null);
    setAftertaste(lastShot.aftertaste ?? null);
    setNotes(lastShot.notes ?? '');
    setRating(lastShot.rating);
    setBrewTime(''); // הזמן נקבע בטיימר (או בהזנה ידנית בתוצאות)
    // המלצה לתצוגה בעמוד הטיימר — חזרה מדויקת על השוט האחרון
    setRecommendation({
      doseGrams: lastShot.doseGrams,
      yieldGrams: lastShot.yieldGrams,
      stopAtGrams: lastShot.yieldStopGrams ?? Math.round((lastShot.yieldGrams - 3.5) * 10) / 10,
      brewTimeSecMin: Math.max(1, lastShot.brewTimeSec - 2),
      brewTimeSecMax: lastShot.brewTimeSec + 2,
      ratio: Math.round((lastShot.yieldGrams / lastShot.doseGrams) * 10) / 10,
      grindSetting: lastShot.grindSetting,
      machineTemp: lastShot.machineTemp,
      confidence: 'high',
      basedOnShots: 1,
      reasons: [
        `שוט מהיר — חזרה מדויקת על השוט האחרון (דירוג ${lastShot.rating}/10). תזמן והזן משקל בלבד; שנה טעם רק אם השתנה.`,
      ],
      beanNotes: [],
    });
    setQuick(true);
    goStep('brew');
  }

  function computeRecommendation() {
    if (!selectedBean || !selectedBag || !user) return;
    const gId = grinderId || (grinders.find((g) => g.isDefault) ?? grinders[0])?.id;
    const rec = recommendShot({
      user,
      bean: selectedBean,
      bag: selectedBag,
      beanShots: shots.filter((s) => s.beanId === selectedBean.id),
      grinderShots: shots.filter((s) => s.beanId === selectedBean.id && s.grinderId === gId),
      doseGrams: parseFloat(dose) || user.defaultDoseGrams,
      grinder: grinders.find((g) => g.id === gId),
      lastGrinderShot: shots.find((s) => s.grinderId === gId), // האחרון על המטחנה, מכל פולים
    });
    setRecommendation(rec);
    // דרגת הטחינה בשלב התוצאות: ברירת מחדל = הדרגה שהוזנה בפועל בשוט
    // הקודם על אותה מטחנה (מה שהמטחנה מכוונת אליו כרגע) — לא המלצת ה-AI.
    // אם דיאלת אחרת, פשוט משנים ידנית. נופלים להמלצה רק כשאין שוט קודם על המטחנה.
    if (grindSetting === '') {
      const lastOnGrinder = shots.find((s) => s.grinderId === gId);
      if (lastOnGrinder) setGrindSetting(String(lastOnGrinder.grindSetting));
      else if (rec.grindSetting !== null) setGrindSetting(String(rec.grindSetting));
    }
    if (yieldGrams === '') setYieldGrams(String(rec.yieldGrams));
    // כשהמוח ממליץ על טמפרטורה (או ממשיך את זו של השוט האחרון) — נטען מראש
    setTemp(rec.machineTemp);
    goStep('brew');
  }

  async function saveShot() {
    if (!selectedBean || !selectedBag || !user || saving) return;
    // ציוד עלול לחסר (DB רוקן / נמחק) — לא נותנים לגישה לזרוק שגיאת "אחסון" מטעה
    const gId = grinderId || grinders.find((g) => g.isDefault)?.id || grinders[0]?.id;
    if (!machine || !gId) {
      setSaveError('לא נמצא ציוד לשמירה (מכונה או מטחנה). הוסף מכונה ומטחנה בהגדרות ונסה שוב.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {

      // ---- תהליך ה-DIAL IN ----
      // שקית חדשה בלי שוטים פותחת סשן כיול. פולים שכבר כוילו בעבר מקבלים
      // "recheck": אותם שלבים, אבל נזרעים מהמתכון השמור — רק תאריך הקלייה
      // השתנה, לא הפולים. הסשן נסגר רק באישור המשתמש (ראו confirmDialIn).
      const bagShots = shots.filter((s) => s.bagId === selectedBag.id);
      let session = await dialInRepo.activeForBag(selectedBag.id);
      if (!session && bagShots.length === 0) {
        const priorBeanShots = shots.filter(
          (s) => s.beanId === selectedBean.id && s.bagId !== selectedBag.id,
        );
        const savedRecipe =
          priorBeanShots.find((s) => s.favorite) ??
          priorBeanShots.filter((s) => s.rating >= 8).sort((a, b) => b.rating - a.rating)[0] ??
          null;
        session = await dialInRepo.start(user.id, selectedBag.id, {
          kind: savedRecipe ? 'recheck' : 'full',
          targetYieldGrams: savedRecipe?.yieldGrams ?? DIAL_IN_DEFAULT_YIELD,
          // ה-Dose קפוא על מה שנמדד בפועל בשוט הראשון — זו נקודת הייחוס
          // || ולא ?? — parseFloat על שדה ריק מחזיר NaN, לא null
          lockedDoseGrams: savedRecipe?.doseGrams || parseFloat(dose) || user.defaultDoseGrams || 16,
        });
      }

      const shot = await shotRepo.create({
        userId: user.id,
        machineId: machine.id,
        grinderId: gId,
        beanId: selectedBean.id,
        bagId: selectedBag.id,
        dialInSessionId: session?.id ?? null,
        doseGrams: parseFloat(dose) || 0,
        yieldStopGrams: yieldStop ? parseFloat(yieldStop) : null,
        yieldGrams: parseFloat(yieldGrams) || 0,
        brewTimeSec: parseInt(brewTime) || 0,
        grindSetting: parseFloat(grindSetting) || 0,
        machineTemp: temp,
        choked: choked || undefined,
        basketType,
        portafilterType,
        tasteTags,
        tasteOther: tasteTags.includes('other') ? tasteOther : '',
        body,
        crema,
        aftertaste,
        notes,
        rating,
        vsPrevious,
      });
      setSavedShotId(shot.id);
      setMarkedFavorite(false);

      // בדיקת "משתנה אחד בלבד" מול השוט הקודם באותו סשן
      setMultiVarWarning(session ? await checkOneVariable(shot, session.id) : null);
      setDialInSession(session ?? null);
      const openSession = session;
      // שוטי הסשן מהישן לחדש, כולל זה שזה עתה נשמר
      const sessionShots = openSession
        ? [...shots.filter((s) => s.dialInSessionId === openSession.id), shot]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [];

      // מוח ה-AI: היסטוריית הפולים על המטחנה הנוכחית בלבד (דרגות טחינה
      // אינן ברות-השוואה בין מטחנות) + השוט שזה עתה נשמר
      const beanAll = shots.filter((s) => s.beanId === selectedBean.id); // מהחדש לישן
      const grinderChanged = beanAll.length > 0 && beanAll[0].grinderId !== gId;
      const beanHistory = beanAll
        .filter((s) => s.grinderId === gId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      beanHistory.push(shot);
      // נתוני הזדקנות: פער מהשוט הקודם על הפולים + גיל הקלייה בזמן השוט
      const prevShot = beanHistory.length >= 2 ? beanHistory[beanHistory.length - 2] : null;
      const agingGapDays = prevShot
        ? Math.floor((new Date(shot.createdAt).getTime() - new Date(prevShot.createdAt).getTime()) / 86400000)
        : null;
      // פיזור על הגדרות זהות בשקית הזו, מנוטרל שיפוע ההזדקנות שלה.
      // מחושב כאן ולא במנוע כי כאן יושבות השקיות — ואותו מספר מוצג
      // גם כמדד החזרתיות במסך הבית.
      const bagHistory = [...shots.filter((s) => s.bagId === selectedBag.id), shot];
      const bagAgeNow = selectedBag.roastDate
        ? Math.floor((new Date(shot.createdAt).getTime() - new Date(selectedBag.roastDate).getTime()) / 86400000)
        : null;
      const agingSlope = computeAgingSlope(bagHistory, [selectedBag], bagAgeNow);
      const prepSpread = computeRepeatability(bagHistory, [selectedBag], agingSlope);

      const roastAgeDays = selectedBag.roastDate
        ? Math.floor((new Date(shot.createdAt).getTime() - new Date(selectedBag.roastDate).getTime()) / 86400000)
        : null;
      const newAdvice = aiRecommend({
        lastShot: shot,
        beanShots: beanHistory,
        grinder: grinders.find((g) => g.id === gId),
        grinderChanged,
        agingGapDays,
        roastAgeDays,
        // אותו חלון יעד שההמלצה במסך הבית מציגה — כדי שהמוח לא יסתור אותה
        targetWindow: computeTargetWindow({
          roastLevel: selectedBean.roastLevel,
          roastAgeDays,
          beanShots: beanHistory,
        }),
        // עותק const: session הוא let שמתעדכן בהמשך, ו-TS לא מצמצם אותו בתוך callback
        dialIn: openSession ? { session: openSession, sessionShots } : undefined,
        prepSpread,
      });
      // ההמלצה נשמרת עם השוט — תופיע גם ביומן לצד פרטי השוט
      await shotRepo.put({ ...shot, aiAdvice: newAdvice });
      setAdvice(newAdvice);
      // המסלול מציג את ההמלצה שניתנה על כל שוט — כולל זו שזה עתה חושבה
      setDialInShots(sessionShots.map((s) => (s.id === shot.id ? { ...s, aiAdvice: newAdvice } : s)));

      // מצב הכיול מתקדם יחד עם ההמלצה — מקור אחד, בלי עותק שני שיכול להיפרד
      if (session && newAdvice.dialIn) {
        const d = newAdvice.dialIn;
        session = {
          ...session,
          kind: d.kind,
          phase: d.phase,
          targetYieldGrams: d.targetYieldGrams,
          lockedDoseGrams: d.lockedDoseGrams,
          sweetSpotBestShotId: d.sweetSpotBestShotId,
        };
        await dialInRepo.put(session);
        setDialInSession(session);
      }

      // שיא אישי לפולים האלה? (יש לפחות שוט קודם אחד, והדירוג עוקף את כולם)
      const prevBest = beanAll.reduce((m, s) => Math.max(m, s.rating), 0);
      setBeanRecord(beanAll.length >= 1 && rating > prevBest ? { prevBest } : null);

      // רגעי delight — מדולגים כשהמשתמש ביקש הפחתת תנועה
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setAnalyzed(beanHistory.length);
      setThinking(!reduceMotion); // הבזק "חשיבה" קצר לפני חשיפת ההמלצה
      if (rating >= 9 && !reduceMotion) setCelebrate(true); // חגיגת שוט מושלם

      stepDirRef.current = 'fwd';
      setStep('coach');
      // רשומת ה"תוצאות" מוחלפת ב"coach" — Back מכאן לא יחזיר לטופס שכבר נשמר
      history.replaceState({ screen: 'new-shot', step: 'coach' }, '');
    } catch {
      // הטופס נשאר מלא והטיוטה שמורה — שום נתון לא אבד
      setSaveError('השמירה נכשלה — הנתונים שלך עדיין כאן ושמורים גם בטיוטה. בדוק שיש מקום פנוי בדפדפן ונסה שוב.');
    } finally {
      setSaving(false);
    }
  }

  // ---- סגירת הכיול: החלטה של המשתמש, לא של המנוע ----
  // המתכון שנשמר הוא נקודת ה-Sweet Spot אם הציד רץ, אחרת השוט הטוב בסשן —
  // ולא בהכרח השוט האחרון שהוזן.
  async function confirmDialIn() {
    if (!dialInSession) return;
    const sessionShots = await shotRepo.forSession(dialInSession.id);
    // המתכון הוא השוט הטוב ביותר שנמדד בסשן, בשוויון המאוחר יותר — אותה
    // חוקיות בדיוק כמו במנוע. הסתמכות על sweetSpotBestShotId לבדו הייתה
    // שומרת נקודה שננעלה לפני ששוט מאוחר יותר היכה אותה.
    const chosen = analyzable(sessionShots).reduce<Shot | null>(
      (b, s) => (b === null || s.rating > b.rating
        || (s.rating === b.rating && s.createdAt > b.createdAt) ? s : b),
      null,
    );
    if (!chosen) return;
    // מתכון אחד לכל פולים — מסירים סימון קודם
    const prev = shots.filter((s) => s.beanId === chosen.beanId && s.favorite);
    for (const p of prev) await shotRepo.put({ ...p, favorite: false });
    await shotRepo.put({ ...chosen, favorite: true });
    await dialInRepo.complete(dialInSession, chosen.id);
    setDialInClosed('done');
    setMarkedFavorite(true);
  }

  async function stopDialIn() {
    if (!dialInSession) return;
    await dialInRepo.abandon(dialInSession);
    setDialInClosed('stopped');
  }

  // מחיקת טיוטה משוחזרת והתחלה מאפס
  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setBeanId(''); setBagId(''); setGrinderId(''); setDose('16'); setRecommendation(null);
    setYieldStop(''); setYieldGrams(''); setBrewTime(''); setQuick(false); setChoked(false);
    setGrindSetting(''); setTemp('medium'); setBasketType('IMS/מקצועית'); setPortafilterType('Bottomless');
    setTasteTags([]); setTasteOther(''); setBody(null); setCrema(null); setAftertaste(null);
    setNotes(''); setRating(0); setVsPrevious(null); setShowTasteDetail(false); setShowEquipment(false); setDraftRestored(false); setSaveError(null); setRestoreWarning(null);
    stepDirRef.current = 'back';
    setStep('setup');
    history.replaceState({ screen: 'new-shot', step: 'setup' }, '');
  }

  // כיוון אנימציית הכניסה של השלב הנוכחי (key מפעיל אותה מחדש בכל מעבר)
  const stepAnim = stepDirRef.current === 'back' ? 'step-back' : 'step-fwd';

  // --- שלב 1: הגדרה ---
  if (step === 'setup') {
    return (
      <div key="setup" className={stepAnim}>
        <div className="card">
          <h2 ref={headingRef} tabIndex={-1}><CupIcon size={20} /> שוט חדש — שלב 1: הכנה</h2>

          {restoreWarning && (
            <div className="one-var-banner" role="status" style={{ marginTop: 0, marginBottom: 12 }}>
              {restoreWarning}
            </div>
          )}

          {draftRestored && (
            <div className="one-var-banner" style={{ marginTop: 0, marginBottom: 12 }}>
              שוחזרה טיוטה שלא הושלמה מהפעם הקודמת — אפשר להמשיך מאיפה שעצרת.
              <div className="btn-row">
                <button className="btn small secondary" onClick={discardDraft}>התחל שוט נקי</button>
              </div>
            </div>
          )}

          {lastShot && (
            <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={applyLastShot}>
                <ClipboardIcon size={18} /> כמו הקודם
              </button>
              <button
                className="btn" style={{ flex: 1.4 }}
                onClick={startQuickShot}
              >
                <BoltIcon size={18} /> שוט מהיר
              </button>
            </div>
          )}

          <Field label="סוג פולים">
            <select value={beanId} onChange={(e) => { setBeanId(e.target.value); setBagId(''); }}>
              <option value="">בחר פולים…</option>
              {beans.map((b) => (
                <option key={b.id} value={b.id}>{b.name} — {b.roastery}</option>
              ))}
            </select>
          </Field>

          {beans.length === 0 && (
            <p className="muted small">
              אין פולים במערכת. <button className="btn small" onClick={() => navigate('beans')}>הוסף פולים</button>
            </p>
          )}

          {beanId && (
            <Field label="שקית (לצורך מעקב טריות ומלאי)">
              <select value={bagId} onChange={(e) => setBagId(e.target.value)}>
                <option value="">בחר שקית…</option>
                {beanBags.map((b) => (
                  <option key={b.id} value={b.id}>
                    נקלה: {b.roastDate ? new Date(b.roastDate).toLocaleDateString('he-IL') : 'לא ידוע'} · נפתחה:{' '}
                    {b.openDate ? new Date(b.openDate).toLocaleDateString('he-IL') : 'לא ידוע'} · {b.weightGrams} גרם
                  </option>
                ))}
              </select>
            </Field>
          )}

          {beanId && beanBags.length === 0 && (
            <QuickBagForm beanId={beanId} onCreated={(bag) => setBagId(bag.id)} />
          )}

          {pendingDialIn && (
            <div className="one-var-banner" style={{ marginBottom: 12 }} role="status">
              <b>שקית חדשה — נכנסים לכיול.</b>{' '}
              {pendingDialInKind === 'full'
                ? 'פולים שעוד לא כוילו. שלב 1 — טחינה בלבד עד שנכנסים לחלון הזמן. שלב 2 — אתה טועם ומתייג. שלב 3 — כוונון עדין ב-Yield לפי הטעם. שלב 4 — ציד ה-Sweet Spot.'
                : 'פולים מוכרים בשקית חדשה — בדיקה מחודשת. מתחילים מהמתכון השמור; רק תאריך הקלייה השתנה.'}
              <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
                השוט נשמר ביומן כרגיל. הכיול נפתח עם השוט הראשון ונסגר רק באישור שלך.
              </span>
            </div>
          )}

          <div className="field-row">
            <Field label="גרם קפה נכנס">
              <input
                type="number" step="0.1" min="5" max="25" inputMode="decimal"
                value={dose} onChange={(e) => setDose(e.target.value)}
              />
            </Field>
            <Field label="מטחנה">
              <select
                value={grinderId || (grinders.find((g) => g.isDefault) ?? grinders[0])?.id || ''}
                onChange={(e) => setGrinderId(e.target.value)}
              >
                {grinders.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {recipeShot && bagId && (
            <button className="btn block" style={{ marginBottom: 10 }} onClick={applyRecipe}>
              <StarIcon size={18} /> הכן לפי המתכון השמור ({recipeShot.doseGrams}←{recipeShot.yieldGrams} גרם
              {recipeShot.yieldStopGrams ? `, עצירה ב-${recipeShot.yieldStopGrams}` : ''} · טחינה {recipeShot.grindSetting} · דירוג {recipeShot.rating}/10)
            </button>
          )}

          <button
            className={`btn block ${recipeShot && bagId ? 'secondary' : ''}`}
            disabled={!beanId || !bagId || !dose}
            onClick={computeRecommendation}
          >
            הצג המלצה והתחל חליטה ←
          </button>
        </div>
      </div>
    );
  }

  // --- שלב 2: חליטה + טיימר ---
  if (step === 'brew' && recommendation) {
    return (
      <div key="brew" className={stepAnim}>
        <BrewStep
          recommendation={recommendation}
          beanName={selectedBean?.name ?? ''}
          onDone={(seconds) => {
            if (seconds > 0) setBrewTime(String(seconds));
            goStep('results');
          }}
          onBack={() => history.back()}
        />
      </div>
    );
  }

  // --- שלב 3: תוצאות ---
  if (step === 'results') {
    const ratioLine = dose && yieldGrams && (
      <p className="muted small">
        יחס חליטה: 1:{(parseFloat(yieldGrams) / parseFloat(dose)).toFixed(1)}
        {brewTime && parseInt(brewTime) > 0 &&
          ` · זרימה: ${(parseFloat(yieldGrams) / parseInt(brewTime)).toFixed(1)} גרם/שנייה`}
        {yieldStop && yieldGrams && parseFloat(yieldGrams) > parseFloat(yieldStop) &&
          ` · טפטוף: ${(parseFloat(yieldGrams) - parseFloat(yieldStop)).toFixed(1)} גרם`}
      </p>
    );

    const weightFields = (
      <div className="field-row thirds">
        <Field label="גרם נכנס">
          <input type="number" step="0.1" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
        </Field>
        <Field label="עצירה בפועל (גרם)">
          <input
            type="number" step="0.1" inputMode="decimal" placeholder="לא חובה"
            value={yieldStop} onChange={(e) => setYieldStop(e.target.value)}
          />
        </Field>
        <Field label="סופי אחרי טפטוף (גרם)">
          <input type="number" step="0.1" inputMode="decimal" value={yieldGrams} onChange={(e) => setYieldGrams(e.target.value)} />
        </Field>
      </div>
    );

    // מצב "שוט מהיר": טופס מינימלי — שאר הפרטים משוכפלים מהשוט הקודם
    if (quick) {
      return (
        <div key="results" className={stepAnim}>
          <div className="card accent">
            <h2><BoltIcon size={20} /> שוט מהיר</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              הכול שוכפל מהשוט הקודם — כולל הטעם. עדכן משקל, זמן וטעם רק אם השתנו.
            </p>
            {weightFields}
            {ratioLine}
            <Field label="זמן חליטה (שניות)">
              <input type="number" inputMode="numeric" value={brewTime} onChange={(e) => setBrewTime(e.target.value)} />
            </Field>
            <h3>טעם</h3>
            <Chips
              groupLabel="טעם"
              options={TASTE_OPTIONS}
              selected={tasteTags}
              onToggle={(t) =>
                setTasteTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
              }
            />
            {tasteTags.includes('other') && (
              <div style={{ marginTop: 8 }}>
                <input aria-label="תיאור הטעם" placeholder="תאר את הטעם…" value={tasteOther} onChange={(e) => setTasteOther(e.target.value)} />
              </div>
            )}
            <h3>דירוג אישי (1–10)</h3>
            <RatingPicker value={rating} onChange={setRating} />
            {rating > 0 && rating <= 4 && (
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                קורה לכולם — עכשיו נראה מה לכוונן בשוט הבא.
              </p>
            )}
            <VsPreviousPicker value={vsPrevious} onChange={setVsPrevious} />
            {saveError && (
              <div className="one-var-banner" role="alert" style={{ borderColor: 'var(--bad)', marginTop: 10 }}>
                {saveError}
              </div>
            )}
            <div className="btn-row">
              <button className="btn secondary" onClick={() => history.back()}>→ ביטול</button>
              <button
                className="btn" style={{ flex: 1 }}
                disabled={!dose || !yieldGrams || !brewTime || rating === 0 || saving}
                onClick={saveShot}
              >
                <SaveIcon size={18} /> {saveError ? 'נסה לשמור שוב' : 'שמור וקבל ניתוח'}
              </button>
            </div>
            <MissingFieldsHint dose={dose} yieldGrams={yieldGrams} brewTime={brewTime} rating={rating} />
          </div>
        </div>
      );
    }

    return (
      <div key="results" className={stepAnim}>
        <div className="card">
          <h2 ref={headingRef} tabIndex={-1}><ClipboardIcon size={20} /> שלב 3: תוצאות השוט</h2>

          {draftRestored && (
            <div className="one-var-banner" style={{ marginTop: 0, marginBottom: 12 }}>
              שוחזרה טיוטה שלא הושלמה — הנתונים שהזנת נשמרו.
              <div className="btn-row">
                <button className="btn small secondary" onClick={discardDraft}>התחל שוט נקי</button>
              </div>
            </div>
          )}

          {weightFields}
          {ratioLine}

          <div className="field-row thirds">
            <Field label="זמן (שניות)">
              <input type="number" inputMode="numeric" value={brewTime} onChange={(e) => setBrewTime(e.target.value)} />
            </Field>
            <Field label={`דרגת טחינה (${selectedGrinder?.name ?? 'מטחנה'})`}>
              <input type="number" step="0.5" inputMode="decimal" value={grindSetting} onChange={(e) => setGrindSetting(e.target.value)} />
            </Field>
            <Field label="טמפרטורת מכונה">
              <select value={temp} onChange={(e) => setTemp(e.target.value as MachineTempSetting)}>
                {(Object.entries(TEMP_LABELS) as [MachineTempSetting, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* חניקה — לא תקלה בתיעוד אלא מדידה בפני עצמה: הקצה הדק */}
          <label className="flag-toggle">
            <input type="checkbox" checked={choked} onChange={(e) => setChoked(e.target.checked)} />
            <span>המכונה נחנקה — הזרימה לא התחילה או ירדה לטפטוף</span>
          </label>
          {choked && (
            <p className="muted small" style={{ marginTop: 4 }}>
              השוט יישמר ביומן ולא ייכנס לאף חישוב — חוץ מדבר אחד: דרגת הטחינה הזו נרשמת
              כקצה הדק של הפולים האלה, והמוח לא ישלח אליה שוב. אין צורך למלא זמן, טעם או דירוג.
            </p>
          )}

          {/* ציוד — סלסלה + פורטפילטר מקופלים כברירת מחדל (כמעט לא משתנים).
              נפתחים אוטומטית כשהערך שונה מברירת המחדל, כמו מגירת הטעם. */}
          <button
            ref={equipmentToggleRef}
            type="button"
            className="btn secondary block"
            aria-expanded={showEquipment}
            onClick={() => setShowEquipment(!showEquipment)}
          >
            {showEquipment ? (
              <>
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }} aria-hidden="true">
                  <ChevronDownIcon size={17} />
                </span>{' '}
                הסתר ציוד
              </>
            ) : (
              <>
                <PlusIcon size={17} /> ציוד: {basketType} · {portafilterType}
              </>
            )}
          </button>
          <div className={`collapse ${showEquipment ? 'open' : ''}`}>
            <div className="collapse-inner">
              <div className="field-row">
                <Field label="סוג סלסלה">
                  <select value={basketType} onChange={(e) => setBasketType(e.target.value)}>
                    <option value="סטנדרטית">סטנדרטית</option>
                    <option value="Pressurized">Pressurized (מקורית)</option>
                    <option value="IMS/מקצועית">IMS / מקצועית</option>
                  </select>
                </Field>
                <Field label="פורטפילטר">
                  <select value={portafilterType} onChange={(e) => setPortafilterType(e.target.value)}>
                    {(machine?.portafilterTypes ?? ['Bottomless']).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="muted small" style={{ marginTop: -4, marginBottom: 0 }}>
                Bottomless = פורטפילטר פתוח מלמטה שמראה את הזרימה · Pressurized = סלסלת הלחץ המקורית, סלחנית לטחינה
              </p>
            </div>
          </div>

          <h3>טעם (אפשר לבחור כמה)</h3>
          <Chips
            groupLabel="טעם"
            options={TASTE_OPTIONS}
            selected={tasteTags}
            onToggle={(t) =>
              setTasteTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
            }
          />
          {tasteTags.includes('other') && (
            <div style={{ marginTop: 8 }}>
              <input aria-label="תיאור הטעם" placeholder="תאר את הטעם…" value={tasteOther} onChange={(e) => setTasteOther(e.target.value)} />
            </div>
          )}

          {/* פירוט טעם עמוק — מגירה מתקפלת שנפתחת ונסגרת בהחלקה.
              ערכים שנבחרו נשמרים גם כשהמגירה סגורה.
              המתג נשאר תמיד ב-DOM כדי שהפוקוס לא יאבד בפתיחה/סגירה. */}
          <button
            ref={tasteToggleRef}
            type="button"
            className="btn secondary block"
            style={{ marginTop: 10 }}
            aria-expanded={showTasteDetail}
            onClick={() => setShowTasteDetail(!showTasteDetail)}
          >
            {showTasteDetail ? (
              <>
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }} aria-hidden="true">
                  <ChevronDownIcon size={17} />
                </span>{' '}
                {hideTasteLabel}
              </>
            ) : (
              <>
                <PlusIcon size={17} />{' '}
                {tasteDetailCount > 0
                  ? `הצג פירוט טעם (${tasteDetailCount} נבחרו)`
                  : 'הוסף פירוט טעם — גוף, קרמה, אחרית חיך'}
              </>
            )}
          </button>
          <div className={`collapse ${showTasteDetail ? 'open' : ''}`}>
            <div className="collapse-inner">
              <h3>גוף (Body)</h3>
              <Chips groupLabel="גוף" multi={false} options={QUALITY_OPTIONS} selected={body ? [body] : []} onToggle={(v) => setBody(body === v ? null : v)} />
              <h3>קרמה (Crema)</h3>
              <Chips groupLabel="קרמה" multi={false} options={QUALITY_OPTIONS} selected={crema ? [crema] : []} onToggle={(v) => setCrema(crema === v ? null : v)} />
              <h3>אחרית חיך (Aftertaste)</h3>
              <Chips groupLabel="אחרית חיך" multi={false} options={QUALITY_OPTIONS} selected={aftertaste ? [aftertaste] : []} onToggle={(v) => setAftertaste(aftertaste === v ? null : v)} />

              <button
                type="button"
                className="btn secondary small block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setShowTasteDetail(false);
                  // הכפתור הזה נעלם עם המגירה — מחזירים את הפוקוס למתג הקבוע
                  tasteToggleRef.current?.focus();
                }}
              >
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }} aria-hidden="true">
                  <ChevronDownIcon size={16} />
                </span>{' '}
                {hideTasteLabel}
              </button>
            </div>
          </div>

          <h3>הערות חופשיות</h3>
          <textarea
            aria-label="הערות חופשיות"
            placeholder="ריח, מראה הזרימה מה-Bottomless, הרגשה כללית…"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />

          <h3>דירוג אישי (1–10)</h3>
          <RatingPicker value={rating} onChange={setRating} />
          {rating > 0 && rating <= 4 && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              קורה לכולם — עכשיו נראה מה לכוונן בשוט הבא.
            </p>
          )}
          <VsPreviousPicker value={vsPrevious} onChange={setVsPrevious} />

          {saveError && (
            <div className="one-var-banner" role="alert" style={{ borderColor: 'var(--bad)', marginTop: 10 }}>
              {saveError}
            </div>
          )}
          <div className="btn-row">
            <button className="btn secondary" onClick={() => history.back()}>→ חזרה</button>
            <button
              className="btn" style={{ flex: 1 }}
              // שוט חנוק לא נמדד, ולכן גם לא נדרש למלא את שדות המדידה
              disabled={choked
                ? (!dose || !grindSetting || saving)
                : (!dose || !yieldGrams || !brewTime || rating === 0 || saving)}
              onClick={saveShot}
            >
              <SaveIcon size={18} /> {saveError ? 'נסה לשמור שוב' : 'שמור וקבל ניתוח'}
            </button>
          </div>
          {!choked && (
            <MissingFieldsHint dose={dose} yieldGrams={yieldGrams} brewTime={brewTime} rating={rating} />
          )}
        </div>
      </div>
    );
  }

  // --- שלב 4: AI Coach ---
  if (step === 'coach' && advice) {
    const toneClass = { good: 'balanced', warn: 'under', bad: 'over', info: 'unclear' }[advice.tone];

    // הבזק "חשיבה" קצר לפני חשיפת ההמלצה (רגע delight — לא עיכוב אמיתי)
    if (thinking) {
      return (
        <div key="coach" className={stepAnim}>
          {celebrate && <Celebration onDone={stopCelebrate} />}
          <div className="card accent">
            <h2>
              <BrainIcon size={20} />
              {dialInSession ? ' כיול הפולים' : ' מוח ה-AI'}
            </h2>
            {/* אזור חי לקורא מסך — קיים בשני מצבי ה-coach, הטקסט מוכרז כשמשתנה */}
            <p className="sr-only" role="status">מנתח את השוט…</p>
            <div className="ai-thinking">
              <span className="ai-thinking-dots"><i /><i /><i /></span>
              <p>
                {analyzed > 1
                  ? `טוחן את ${analyzed} השוטים שלך על הפולים האלה…`
                  : 'מנתח את השוט הראשון שלך על הפולים האלה…'}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key="coach" className={stepAnim}>
        {celebrate && <Celebration onDone={stopCelebrate} />}
        <div className="card accent">
          <h2>
            <BrainIcon size={20} />
            {advice.dialIn ? ' כיול הפולים — ההמלצה לשוט הבא' : ' מוח ה-AI — ההמלצה לשוט הבא'}
          </h2>
          <p className="sr-only" role="status">
            הניתוח מוכן: {advice.changeKind === 'none' ? 'שמור על המתכון' : `השינוי הבא — ${advice.changeLabel}`}
          </p>
          {advice.dialIn && (
            <div className="dial-in-strip">
              <div className="dial-in-head">
                <TargetIcon size={17} />
                <span>{advice.dialIn.phaseLabel}</span>
                <span className="dial-in-count">
                  שוט {advice.dialIn.shotIndex}
                  {advice.dialIn.kind === 'recheck' ? ' · בדיקה חוזרת' : ''}
                </span>
              </div>
              <ol className="dial-in-track" aria-label={`שלב ${advice.dialIn.phaseStep} מתוך 4`}>
                {[1, 2, 3, 4].map((n) => (
                  <li
                    key={n}
                    className={
                      n < advice.dialIn!.phaseStep ? 'done'
                      : n === advice.dialIn!.phaseStep ? 'now'
                      : ''
                    }
                    aria-current={n === advice.dialIn!.phaseStep ? 'step' : undefined}
                  />
                ))}
              </ol>
              <DialInLadder shots={dialInShots} />
              <p className="muted small" style={{ margin: 0 }}>
                המנה קפואה על {advice.dialIn.lockedDoseGrams} גרם לכל אורך הכיול — זו נקודת
                הייחוס שכל שאר השינויים נמדדים מולה.
              </p>
            </div>
          )}
          {beanRecord && (
            <div className="record-banner">
              <TrophyIcon size={20} /> שיא אישי לפולים האלה! עברת את השיא הקודם ({beanRecord.prevBest}/10).
            </div>
          )}
          <div className={`coach-verdict ${toneClass}`} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {advice.changeKind === 'none'
              ? <><CheckIcon size={20} /> שמור על המתכון — אין מה לשנות</>
              : `השינוי הבא: ${advice.changeLabel}`}
          </div>

          {multiVarWarning && (
            <div className="one-var-banner" style={{ borderColor: 'var(--bad)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <WarnIcon size={18} /> <span>{multiVarWarning}</span>
            </div>
          )}
          {advice.warnings.map((w, i) => (
            <div key={i} className="one-var-banner" style={{ borderColor: 'var(--warn)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <WarnIcon size={18} /> <span>{w}</span>
            </div>
          ))}
          {advice.recipeNote && (
            <div className="one-var-banner" style={{ marginBottom: 10 }}>{advice.recipeNote}</div>
          )}

          <div className="coach-section">
            <div className="coach-label">1 · סיכום השוט האחרון</div>
            <p style={{ margin: '4px 0' }} className="muted small">{advice.lastShotSummary}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">2 · אבחון</div>
            <p style={{ margin: '4px 0' }}>{advice.diagnosis}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">3 · השינוי — אחד בלבד</div>
            <p style={{ margin: '4px 0', fontWeight: 600 }}>{advice.instruction}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">4 · תוצאה צפויה</div>
            <p style={{ margin: '4px 0' }}>{advice.expectedResult}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">5 · רמת ביטחון: {advice.confidencePct}%</div>
            <div className="conf-bar" dir="ltr" aria-hidden="true">
              <div className="conf-bar-fill" style={{ transform: `scaleX(${advice.confidencePct / 100})` }} />
            </div>
            {advice.confidenceReasons.map((r, i) => (
              <p key={i} className="muted small" style={{ margin: '3px 0' }}>• {r}</p>
            ))}
          </div>
          <div className="one-var-banner" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <BulbIcon size={18} /> <span>{advice.reminder}</span>
          </div>

          {/* סיום הכיול — רק בלחיצה שלך. המנוע ממליץ, לא סוגר. */}
          {advice.dialIn && dialInSession && !dialInClosed && (
            <div className="dial-in-close">
              <button
                className={`btn block ${advice.dialIn.readyToConfirm ? '' : 'secondary'}`}
                onClick={confirmDialIn}
              >
                <StarIcon size={18} /> זה המתכון — סיים את הכיול
              </button>
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                {advice.dialIn.readyToConfirm
                  ? 'יש בסשן שוט טוב מספיק. אישור ישמור אותו כמתכון של הפולים האלה ויסגור את הכיול.'
                  : 'אפשר לסגור בכל רגע — הכיול נועד לך, לא להפך. השוט הטוב ביותר בסשן יישמר כמתכון.'}
              </p>
              <button className="btn secondary block" style={{ marginTop: 8 }} onClick={stopDialIn}>
                עצור את הכיול בלי לשמור מתכון
              </button>
            </div>
          )}
          {dialInClosed && (
            <div className="one-var-banner" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <CheckIcon size={18} />
              <span>
                {dialInClosed === 'done'
                  ? 'הכיול נסגר והמתכון נשמר. מכאן המוח חוזר למצב היומיומי על הפולים האלה.'
                  : 'הכיול נעצר. השוטים נשמרו כרגיל, ולא נקבע מתכון.'}
              </span>
            </div>
          )}

          {savedShotId && !advice.dialIn && (
            <button
              className={`btn block ${markedFavorite ? 'secondary' : ''}`}
              style={{ marginTop: 12 }}
              disabled={markedFavorite}
              onClick={async () => {
                const shot = await shotRepo.get(savedShotId);
                if (!shot) return;
                // מתכון אחד לכל פולים — מסירים סימון קודם
                const prev = shots.filter((s) => s.beanId === shot.beanId && s.favorite);
                for (const p of prev) await shotRepo.put({ ...p, favorite: false });
                await shotRepo.put({ ...shot, favorite: true });
                setMarkedFavorite(true);
              }}
            >
              {markedFavorite ? <><CheckIcon size={18} /> נשמר כמתכון עבור הפולים האלה</> : <><StarIcon size={18} /> שמור כמתכון — זה השוט שאליו אחזור</>}
            </button>
          )}

          <div className="btn-row">
            <button className="btn" style={{ flex: 1 }} onClick={() => navigate('home')}>סיום — למסך הבית</button>
            <button
              className="btn secondary"
              onClick={() => {
                // שוט נוסף עם אותם פולים — איפוס תוצאות בלבד
                setYieldStop(''); setYieldGrams(''); setBrewTime(''); setTasteTags([]); setTasteOther('');
                setBody(null); setCrema(null); setAftertaste(null);
                setNotes(''); setRating(0); setVsPrevious(null); setQuick(false); setChoked(false); setShowTasteDetail(false); setShowEquipment(false);
                setAdvice(null); setMultiVarWarning(null); setSavedShotId(null); setMarkedFavorite(false);
                setBeanRecord(null); setThinking(false); setCelebrate(false);
                setDialInSession(null); setDialInClosed(null);
                computeRecommendation();
              }}
            >
              <CupIcon size={19} /> שוט נוסף
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// שורת עזרה מתחת לכפתור שמירה מנוטרל — אומרת בדיוק אילו שדות חסרים
function MissingFieldsHint({
  dose, yieldGrams, brewTime, rating,
}: {
  dose: string; yieldGrams: string; brewTime: string; rating: number;
}) {
  const missing = [
    !dose && 'גרם נכנס',
    !yieldGrams && 'גרם סופי בכוס',
    !brewTime && 'זמן חליטה',
    rating === 0 && 'דירוג אישי',
  ].filter(Boolean);
  if (missing.length === 0) return null;
  return (
    <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }} role="status">
      כדי לשמור נשאר להשלים: {missing.join(', ')}
    </p>
  );
}

async function checkOneVariable(shot: Shot, sessionId: string): Promise<string | null> {
  const sessionShots = await shotRepo.forSession(sessionId);
  const idx = sessionShots.findIndex((s) => s.id === shot.id);
  const prev = idx > 0 ? sessionShots[idx - 1] : null;
  if (!prev) return null;

  const changes: string[] = [];
  if (Math.abs(shot.grindSetting - prev.grindSetting) > 0.01) changes.push('דרגת טחינה');
  if (Math.abs(shot.doseGrams - prev.doseGrams) > 0.3) changes.push('מנת קפה');
  if (Math.abs(shot.yieldGrams - prev.yieldGrams) > 3) changes.push('Yield');
  if (shot.machineTemp !== prev.machineTemp) changes.push('טמפרטורה');
  if (shot.basketType !== prev.basketType) changes.push('סלסלה');

  if (changes.length > 1) {
    return `שינית ${changes.length} משתנים בבת אחת (${changes.join(', ')}). בסשן כיול קשה לדעת מה השפיע — בשוט הבא שנה משתנה אחד בלבד.`;
  }
  return null;
}

function BrewStep({
  recommendation, beanName, onDone, onBack,
}: {
  recommendation: ShotRecommendation;
  beanName: string;
  onDone: (seconds: number) => void;
  onBack: () => void;
}) {
  const [running, setRunning] = useState(false);
  // מעבר לשלב החליטה: פוקוס לכותרת כדי שהשלב יוכרז ומשתמש מקלדת לא יישאר על כפתור שנעלם
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  // elapsed נמדד ברציפות (כולל שברירי שנייה) כדי שהטבעת תזרום חלק,
  // לא בקפיצות של שנייה. הספרות מעוגלות רק בתצוגה.
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const vibratedRef = useRef({ enter: false, exceed: false });

  const targetMin = recommendation.brewTimeSecMin;
  const targetMax = recommendation.brewTimeSecMax;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const sec = (Date.now() - startRef.current) / 1000;
      setElapsed(sec);
      // רטט (אנדרואיד) + צפצוף (עובד גם באייפון, שם אין רטט בדפדפן)
      if (sec >= targetMin && !vibratedRef.current.enter) {
        vibratedRef.current.enter = true;
        navigator.vibrate?.(120);
        beep(1, 880); // צפצוף יחיד — נכנסת לחלון היעד
      }
      if (sec > targetMax && !vibratedRef.current.exceed) {
        vibratedRef.current.exceed = true;
        navigator.vibrate?.([90, 70, 90]);
        beep(2, 660); // צפצוף כפול נמוך — חלון היעד חלף
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, targetMin, targetMax]);

  // Wake Lock: המסך לא נכבה בזמן שהטיימר רץ (נתמך באייפון מ-iOS 16.4).
  // הנעילה משתחררת אוטומטית כשהטאב מוסתר — לכן נרכשת מחדש בחזרה אליו.
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const acquire = () => {
      if (lock && !lock.released) return;
      navigator.wakeLock.request('screen')
        .then((l) => {
          if (active) lock = l;
          else void l.release().catch(() => {});
        })
        .catch(() => { /* נדחה (חיסכון בסוללה וכו') — ממשיכים בלי */ });
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [running]);


  // טבעת התקדמות: הסקאלה עד יעד-מקסימום + מרווח קטן
  const ringMax = targetMax + 8;
  const R = 88;
  const CIRC = 2 * Math.PI * R;
  const progress = Math.min(elapsed / ringMax, 1);
  const zoneStart = (targetMin / ringMax) * CIRC;
  const zoneLen = ((targetMax - targetMin) / ringMax) * CIRC;
  const inZone = elapsed >= targetMin && elapsed <= targetMax;
  const overZone = elapsed > targetMax;
  const progressColor = overZone ? 'var(--bad)' : inZone ? 'var(--good)' : 'var(--accent)';
  // delight: הטבעת "מתרגשת" (זוהר פועם) בזמן שאתה בחלון היעד,
  // ופועמת פעם אחת ("בול!") אם עצרת בדיוק בתוכו.
  const zoneActive = running && inZone;
  const stoppedInZone = !running && elapsed >= targetMin && elapsed <= targetMax;

  // לחיצה על מרכז הטבעת: התחלה ← עצירה ← איפוס והתחלה מחדש
  function toggleTimer() {
    if (running) {
      setRunning(false);
      return;
    }
    ensureAudio(); // הפעלת אודיו מתוך מחוות המשתמש — דרישת iOS
    startRef.current = Date.now();
    setElapsed(0);
    vibratedRef.current = { enter: false, exceed: false };
    setRunning(true);
  }

  return (
    <div>
      {/* הטיימר למעלה */}
      <div className="card">
        <h2 ref={headingRef} tabIndex={-1}><TimerIcon size={20} /> טיימר חליטה — יעד {targetMin}–{targetMax} שניות</h2>
        <div
          className={`timer-ring-wrap ${zoneActive ? 'zone-active' : ''} ${stoppedInZone ? 'zone-hit' : ''}`}
          dir="ltr"
        >
          <svg viewBox="0 0 220 220" className="timer-ring">
            {/* מסילה */}
            <circle cx="110" cy="110" r={R} fill="none" stroke="var(--border-soft)" strokeWidth="10" />
            {/* אזור היעד */}
            <circle
              cx="110" cy="110" r={R} fill="none"
              stroke="var(--good)" strokeOpacity="0.25" strokeWidth="10"
              strokeDasharray={`${zoneLen} ${CIRC - zoneLen}`}
              strokeDashoffset={-zoneStart}
              transform="rotate(-90 110 110)"
            />
            {/* התקדמות */}
            <circle
              cx="110" cy="110" r={R} fill="none"
              stroke={progressColor} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${progress * CIRC} ${CIRC}`}
              transform="rotate(-90 110 110)"
              style={{ transition: 'stroke 0.3s' }}
            />
          </svg>
          {/* כפתור ההפעלה בתוך הטבעת */}
          <button
            className={`timer-center ${running ? 'running' : ''}`}
            onClick={toggleTimer}
            aria-label={running ? 'עצור טיימר' : 'התחל טיימר'}
          >
            {!running && elapsed === 0 ? (
              <>
                <svg className="timer-center-icon" viewBox="0 0 100 100" width="52" height="52" aria-hidden="true">
                  <polygon points="34,24 78,50 34,76" fill="currentColor" />
                </svg>
                <span className="timer-center-hint">התחל</span>
              </>
            ) : (
              <>
                <span
                  className={`timer-display in-ring ${running ? 'running' : ''}`}
                  style={overZone && running ? { color: 'var(--bad)' } : inZone && running ? { color: 'var(--good)' } : undefined}
                >
                  {elapsed.toFixed(1)}
                </span>
                <span className="timer-center-hint">{running ? 'לחץ לעצירה' : 'לחץ להתחלה מחדש'}</span>
              </>
            )}
          </button>
        </div>
        <p className="muted small" style={{ textAlign: 'center', margin: '4px 0 0' }}>
          {!running && elapsed === 0 && 'הטבעת הירוקה מסמנת את חלון היעד'}
          {running && !inZone && !overZone && 'בדרך לחלון היעד…'}
          {running && inZone && 'בתוך חלון היעד!'}
          {running && overZone && 'חלון היעד חלף — שקול לעצור'}
          {!running && elapsed > 0 && `נעצר על ${elapsed.toFixed(1)} שניות`}
        </p>
        <div className="btn-row">
          <button className="btn secondary" onClick={onBack}>→ חזרה</button>
          <button className="btn" style={{ flex: 1 }} onClick={() => onDone(Math.round(elapsed))}>
            השוט מוכן — לתוצאות ←
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          אפשר לדלג על הטיימר ולהזין את הזמן ידנית במסך הבא.
        </p>
      </div>

      {/* ההמלצה מתחת לטיימר */}
      <div className="card accent">
        <h2><TargetIcon size={20} /> ההמלצה עבור {beanName}</h2>
        <div className="stat-grid">
          <StatTile value={recommendation.doseGrams} label="גרם נכנס" />
          {recommendation.stopAtGrams !== null && (
            <StatTile value={recommendation.stopAtGrams} label="עצירה בפועל" />
          )}
          <StatTile value={recommendation.yieldGrams} label="יעד סופי בכוס" />
          <StatTile value={`${recommendation.brewTimeSecMin}–${recommendation.brewTimeSecMax}`} label="יעד שניות" />
          <StatTile value={`1:${recommendation.ratio}`} label="יחס" />
          {recommendation.grindSetting !== null && <StatTile value={recommendation.grindSetting} label="טחינה" />}
          {recommendation.machineTemp !== 'medium' && (
            <StatTile value={TEMP_LABELS[recommendation.machineTemp]} label="טמפרטורה" />
          )}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {confidenceLabel(recommendation.confidence, recommendation.basedOnShots)}
        </p>
        {recommendation.reasons.length > 0 && (
          <>
            {/* השורה הראשית (בד"כ שורת המוח 🧠) תמיד גלויה — השאר מתקפל */}
            <p className="muted small" style={{ margin: '4px 0' }}>• {recommendation.reasons[0]}</p>
            {recommendation.reasons.length > 1 && (
              <details className="why-details">
                <summary>למה ההמלצה הזו? ({recommendation.reasons.length - 1})</summary>
                {recommendation.reasons.slice(1).map((r, i) => (
                  <p key={i} className="muted small" style={{ margin: '4px 0' }}>• {r}</p>
                ))}
              </details>
            )}
          </>
        )}
        {recommendation.beanNotes.length > 0 && (
          <>
            <h3><ClipboardIcon size={17} /> הערות על הפולים</h3>
            {recommendation.beanNotes.map((n, i) => (
              <p key={i} className="small" style={{ margin: '4px 0', color: 'var(--crema)' }}>• {n}</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function QuickBagForm({ beanId, onCreated }: { beanId: string; onCreated: (bag: Bag) => void }) {
  const [roastDate, setRoastDate] = useState('');
  const [openDate, setOpenDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState('250');
  const [price, setPrice] = useState('');

  return (
    <div className="card" style={{ background: 'var(--bg-elevated)' }}>
      <h3 style={{ marginTop: 0 }}>שקית חדשה לפולים האלה</h3>
      <div className="field-row">
        <Field label="תאריך קלייה (אם ידוע)">
          <input type="date" value={roastDate} onChange={(e) => setRoastDate(e.target.value)} />
        </Field>
        <Field label="תאריך פתיחת השקית">
          <input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="משקל השקית (גרם)">
          <input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="מחיר (₪, לא חובה)">
          <input type="number" step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <button
        className="btn small"
        onClick={async () => {
          const bag = await bagRepo.create({
            beanId,
            roastDate: roastDate || null,
            openDate: openDate || null,
            price: price ? parseFloat(price) : null,
            weightGrams: parseInt(weight) || 250,
          });
          onCreated(bag);
        }}
      >
        <PlusIcon size={17} /> צור שקית
      </button>
    </div>
  );
}
