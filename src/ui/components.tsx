import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Shot } from '../domain/types';
import { dialInStepLine } from './labels';

// מסלול הכיול — כיול הוא רצף, ומסך שמראה פריים אחד ממנו מסתיר את ההיגיון.
// כל שורה: מה הוזן, ולאן המוח שלח אחריו. השורה האחרונה מודגשת.
// limit חותך לשורות האחרונות (מסך הבית צר) ומכריז כמה הושמטו.
export function DialInLadder({ shots, limit }: { shots: Shot[]; limit?: number }) {
  if (shots.length === 0) return null;
  const hidden = limit && shots.length > limit ? shots.length - limit : 0;
  const rows = hidden ? shots.slice(-limit!) : shots;
  return (
    <>
      {hidden > 0 && (
        <p className="muted small dial-in-ladder-more">
          {hidden === 1 ? 'שוט קודם אחד' : `${hidden} שוטים קודמים`} לפני אלה
        </p>
      )}
      <ol className="dial-in-ladder">
        {rows.map((s, i) => {
          const line = dialInStepLine(s);
          const n = (hidden || 0) + i + 1;
          const isLast = i === rows.length - 1;
          // שוט שהוצא מהחישוב עדיין חלק מהרצף — הוא באמת קרה — אבל אסור
          // שייראה כמו מדידה שהכיול נשען עליה. עמום ומסומן.
          const skipped = !!s.excluded || !!s.choked;
          return (
            <li
              key={s.id}
              className={`${isLast ? 'now' : ''}${skipped ? ' skipped' : ''}`.trim() || undefined}
              aria-current={isLast ? 'step' : undefined}
            >
              <span className="ladder-n">{n}</span>
              <span className="ladder-in">
                {line.input}
                {skipped && <span className="badge">{s.choked ? 'נחנק' : 'לא בחישוב'}</span>}
              </span>
              <span className="ladder-next" aria-label={`ההמלצה שניתנה: ${line.next}`}>
                <span aria-hidden="true">← </span>{line.next}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// השוואה לשוט הקודם. הדירוג המוחלט דחוס בקצה העליון — 9 אחד לא נבדל
// מ-9 אחר — וההשוואה תופסת את ההפרש שהמספר מחמיץ. אופציונלי בכוונה:
// שדה חובה נוסף בטופס היה מאט את התיעוד.
const VS_OPTIONS = [
  { value: 'worse' as const, label: 'פחות טוב' },
  { value: 'same' as const, label: 'זהה' },
  { value: 'better' as const, label: 'טוב יותר' },
];

export function VsPreviousPicker({ value, onChange }: {
  value: 'better' | 'same' | 'worse' | null;
  onChange: (v: 'better' | 'same' | 'worse' | null) => void;
}) {
  return (
    <div className="vs-prev">
      <span className="vs-prev-label">לעומת השוט הקודם</span>
      <div className="chips" role="group" aria-label="השוואה לשוט הקודם">
        {VS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`chip ${value === o.value ? 'selected' : ''}`}
            aria-pressed={value === o.value}
            // לחיצה חוזרת מבטלת — השדה אופציונלי ואי אפשר להיתקע עם בחירה
            onClick={() => onChange(value === o.value ? null : o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat-tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Chips<T extends string>({
  options, selected, onToggle, multi = true, groupLabel,
}: {
  options: { value: T; label: string; emoji?: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  multi?: boolean;
  // תווית הקבוצה לקורא מסך — למשל "טעם" במקום "בחירה מרובה" הגנרי
  groupLabel?: string;
}) {
  return (
    <div className="chips" role="group" aria-label={groupLabel ?? (multi ? 'בחירה מרובה' : 'בחירה יחידה')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip ${selected.includes(o.value) ? 'selected' : ''}`}
          aria-pressed={selected.includes(o.value)}
          onClick={() => onToggle(o.value)}
        >
          {/* האימוג'י דקורטיבי — מוסתר מקורא-מסך כדי שיוקרא רק שם התו */}
          {o.emoji && <span aria-hidden="true">{o.emoji} </span>}{o.label}
        </button>
      ))}
    </div>
  );
}

export function RatingPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  // ניווט חצים כמו radio אמיתי: המיקוד נודד עם הבחירה (roving tabindex).
  // בפריסה RTL — חץ שמאלה מתקדם (ערך גבוה יותר), חץ ימינה חוזר.
  const move = (delta: number) => {
    const next = Math.min(10, Math.max(1, (value || 1) + delta));
    onChange(next);
    setTimeout(() => {
      rowRef.current?.querySelector<HTMLButtonElement>(`button[data-n="${next}"]`)?.focus();
    }, 0);
  };
  return (
    <div
      ref={rowRef}
      className="rating-row"
      role="radiogroup"
      aria-label="דירוג אישי מ-1 עד 10"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          data-n={n}
          aria-checked={value === n}
          aria-label={`${n} מתוך 10`}
          tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
          // גוון הבחירה לפי הערך: דירוג גבוה חוגג (זוהר ענבר), נמוך/בינוני
          // נשאר רגוע — כדי שרגע הדירוג הנמוך לא יורגש כחגיגה
          className={value === n ? `selected ${n <= 4 ? 'rate-low' : n <= 6 ? 'rate-mid' : 'rate-high'}` : ''}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ icon, text, hint }: { icon: ReactNode; text: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="big" aria-hidden="true">{icon}</div>
      <div>{text}</div>
      {hint && <div className="small" style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

// מספר שנספר אל הערך החדש. בכניסה למסך — מאפס (~0.6 שניות, ease-out-quart);
// אחר כך **מהערך שהוצג עד עכשיו**, ב-260ms. הגרסה הקודמת התחילה תמיד מאפס,
// ולכן שוט חדש שהזיז ממוצע מ-8.4 ל-8.6 הפיל את המספר ל-0.0 והטיס אותו חזרה —
// זה נקרא "הנתונים נטענים מחדש", לא "הערך השתנה".
// מכבד "הפחתת תנועה" — במצב כזה מציג את הערך הסופי מיד.
const UPDATE_MS = 260; // שינוי ערך חי — טווח ה-150–250ms של שינויי מצב

export function CountUp({ value, decimals, prefix = '', suffix = '', duration = 600 }: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const dec = decimals ?? (Number.isInteger(value) ? 0 : 1);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [display, setDisplay] = useState(() => (reduced() ? value : 0));
  // המספר שמוצג ברגע זה. אנימציה שנקטעת באמצע ממשיכה מכאן ולא קופצת.
  const fromRef = useRef(reduced() ? value : 0);
  // האם הריצה הקודמת הייתה כשהמספר היה נראה. המעבר "לא נראה"→"נראה" הוא
  // כניסה (מאפס, איטי), ושינוי ערך בזמן שהוא נראה הוא עדכון (מהערך הנוכחי, מהיר).
  const wasVisible = useRef(false);
  // אותה חשיפה-בגלילה של הגרפים: כל כניסה מחדש לתצוגה מריצה את הספירה שוב
  const { ref, revealed } = useRevealOnView<HTMLSpanElement>({ repeat: true });

  useEffect(() => {
    if (reduced()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    // מחוץ לתצוגה — מתאפס ומחכה. האיפוס קורה כשאף אחד לא מסתכל, ולכן
    // מה שנראה בכניסה הבאה הוא ספירה מלאה ולא קפיצה מהערך הישן.
    if (!revealed) {
      wasVisible.current = false;
      fromRef.current = 0;
      setDisplay(0);
      return;
    }
    const from = fromRef.current;
    const ms = wasVisible.current ? UPDATE_MS : duration;
    wasVisible.current = true;
    if (from === value) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, revealed]);

  // span ולא fragment: צריך אלמנט אמיתי כדי לדעת מתי הוא נכנס לתצוגה
  return <span ref={ref}>{prefix}{display.toFixed(dec)}{suffix}</span>;
}

// ---- חשיפה בגלילה ----
// גרף שיושב מתחת לקו הקיפול סיים להנפיש את עצמו לפני שהעין הגיעה אליו.
// ההנפשה כאן היא חשיפת נתונים ולא קישוט, ולכן היא צריכה לרוץ ברגע שהגרף
// נכנס לתצוגה — לא ברגע שהוא נכנס ל-DOM.
//
// המצב "מחכה" נכתב ל-DOM ב-useLayoutEffect (לפני הציור הראשון, בלי הבהוב)
// **ורק** כשיש IntersectionObserver והמשתמש לא ביקש פחות תנועה — כלומר
// אותו קוד שמסתיר מתחייב גם לחשוף. בלעדיו האלמנט פשוט מוצג במלואו.
// כמה מרווח נסלח על כל קצה לפני שנחשיב אלמנט כ"לא שלם במסך". בלי זה
// גרף שהקצה התחתון שלו חורג בפיקסל אחד לא היה מתחיל לעולם.
const REVEAL_SLACK_PX = 6;

// האם האלמנט **כולו** בתוך המסך. אלמנט גבוה מהמסך לא יכול להיכנס כולו,
// ולכן עבורו התנאי המקביל הוא שהוא ממלא את המסך מקצה לקצה — אחרת הוא
// לא היה מונפש לעולם.
function fullyInView(rect: DOMRect | DOMRectReadOnly, top: number, bottom: number): boolean {
  if (rect.height > bottom - top) return rect.top <= top && rect.bottom >= bottom;
  return rect.top >= top - REVEAL_SLACK_PX && rect.bottom <= bottom + REVEAL_SLACK_PX;
}

// ה-viewport אינו השטח הנראה. הכותרת דביקה למעלה וסרגל הניווט קבוע למטה,
// ושניהם מכסים תוכן שנמצא "בתוך המסך" מבחינת הדפדפן. בלי הקיזוז הזה גרף
// שהקצה התחתון שלו יושב מאחורי סרגל הניווט נחשב נראה במלואו, ההנפשה רצה,
// והמשתמש ראה רק את החלק העליון שלו — בדיוק התחושה של "מתחיל מוקדם מדי".
// נמדד מה-DOM ולא מקבוע: הגבהים תלויים ב-safe-area של המכשיר.
function visibleBand() {
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const bar = document.querySelector('.topbar');
  const nav = document.querySelector('.bottom-nav');
  return {
    top: bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0,
    bottom: nav ? Math.min(vh, nav.getBoundingClientRect().top) : vh,
  };
}

// repeat=false — פעם אחת ודי (מד הטריות: הנסיעה מספרת סיפור שנאמר כבר).
// repeat=true  — הנפשה בכל כניסה לתצוגה (הגרפים במסך הנתונים).
//
// היסטרזיס: **נחשף** רק כשהאלמנט כולו בתוך המסך, אבל **מתאפס** רק כשהוא
// יצא ממנו לגמרי. קודם הסף לכניסה היה רבע מהאלמנט, ובפועל הגרף רץ ברגע
// שהכותרת שמעליו נכנסה — הציור הסתיים כשעדיין רק החלק העליון שלו נראה.
// שני ספים רחוקים גם מונעים הבהוב מתזוזת גלילה קטנה על גבול המסך,
// ומוודאים שהאיפוס תמיד קורה מחוץ לשדה הראייה ולא מול העיניים.
export function useRevealOnView<T extends HTMLElement>({ repeat = false } = {}) {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }
    const show = () => {
      if (el.dataset.reveal === 'in') return; // כתיבה חוזרת לא מריצה מחדש
      el.dataset.reveal = 'in';
      setRevealed(true);
    };
    const hide = () => {
      if (el.dataset.reveal === 'pending') return;
      el.dataset.reveal = 'pending';
      setRevealed(false);
    };

    let io: IntersectionObserver | null = null;

    // ה-rootMargin מכווץ את שטח הבדיקה לרצועה שבאמת נראית, ובלעדיו היחס
    // מגיע ל-1 כבר מאחורי סרגל הניווט ואינו משתנה יותר — כלומר אין נקודת
    // מדידה נוספת בהמשך הגלילה. הוא נקבע ברגע יצירת ה-observer, ולכן
    // נבנה מחדש בשינוי גודל או סיבוב מסך.
    const setup = () => {
      io?.disconnect();
      const band = visibleBand();

      // כבר כולו ברצועה הנראית ברגע הרכיבה? מנפישים מיד, בלי לחכות למסירה
      // הראשונה של ה-observer. זה גם מה שמגן על התוכן שמעל הקיפול:
      // IntersectionObserver לא מוסר קריאות כשהדף אינו מצויר (טאב מוסתר,
      // headless), והבדיקה הסינכרונית כאן לא תלויה בזה.
      const visibleNow = fullyInView(el.getBoundingClientRect(), band.top, band.bottom);
      if (visibleNow) show();
      else hide();
      if (visibleNow && !repeat) return; // אין מה לצפות יותר

      const vh = window.innerHeight || document.documentElement.clientHeight;
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            // rootBounds כבר מכווץ לפי ה-rootMargin. חסר בחלק מהדפדפנים,
            // ואז נופלים לרצועה שחושבה בזמן ההתקנה.
            const top = e.rootBounds?.top ?? band.top;
            const bottom = e.rootBounds?.bottom ?? band.bottom;
            if (fullyInView(e.boundingClientRect, top, bottom)) {
              show();
              if (!repeat) io?.unobserve(el);
            } else if (repeat && !e.isIntersecting) {
              hide();
            }
          }
        },
        {
          rootMargin: `-${Math.round(band.top)}px 0px -${Math.round(vh - band.bottom)}px 0px`,
          // מדרגות ביניים אינן הסף עצמו — הן רק נקודות דגימה, כדי שהבדיקה
          // הגאומטרית תיבחן גם באלמנט גבוה שלא מגיע ליחס 1 לעולם.
          threshold: [0, 0.25, 0.5, 0.75, 0.95, 1],
        },
      );
      io.observe(el);
    };

    setup();
    window.addEventListener('resize', setup);
    window.addEventListener('orientationchange', setup);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', setup);
      window.removeEventListener('orientationchange', setup);
    };
  }, [repeat]);

  return { ref, revealed };
}

// ---- שלד טעינה ----
// useLiveQuery מחזיר undefined בפריים הראשון. בלי שלד המסך ריק ואז קופץ
// לתוכן מלא — בטלפון עם DB אמיתי זה הבהוב. השלד שומר את הצורה של מה שבא.
export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number | string;
  width?: number | string;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ height, width, borderRadius: radius }}
    />
  );
}

// שלד של כרטיס: כותרת + כמה שורות. rows=0 לכרטיס כותרת בלבד.
export function SkeletonCard({ rows = 3, tiles = 0 }: { rows?: number; tiles?: number }) {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <Skeleton height={20} width="42%" />
      {tiles > 0 && (
        <div className="stat-grid" style={{ marginTop: 12 }}>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="stat-tile">
              <Skeleton height={26} width="60%" />
              <Skeleton height={11} width="80%" />
            </div>
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={13} width={i === rows - 1 ? '58%' : '100%'} />
      ))}
    </div>
  );
}

// מסך בטעינה: כותרת + N כרטיסים. `aria-busy` כדי שקורא מסך לא יקריא שלד.
export function ScreenSkeleton({ cards = 2, tiles = 4 }: { cards?: number; tiles?: number }) {
  return (
    <div aria-busy="true" role="status" aria-label="טוען נתונים">
      <SkeletonCard rows={1} tiles={tiles} />
      {Array.from({ length: Math.max(0, cards - 1) }, (_, i) => (
        <SkeletonCard key={i} rows={3} />
      ))}
    </div>
  );
}

// כפתור אישור דו-שלבי — תחליף עקבי ל-confirm() הנטיבי של הדפדפן.
// לחיצה ראשונה "דורכת" את הכפתור ומציגה את שאלת האישור;
// בלי לחיצה שנייה תוך 5 שניות הוא חוזר למצב הרגיל.
export function ConfirmButton({
  label, confirmLabel, onConfirm, className = 'btn danger',
}: {
  label: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      aria-live="polite"
      onClick={() => {
        if (armed) { setArmed(false); onConfirm(); } else { setArmed(true); }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
