import { useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(false);

  useEffect(() => {
    if (reduced()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const ms = mountedRef.current ? UPDATE_MS : duration;
    mountedRef.current = true;
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
  }, [value, duration]);
  return <>{prefix}{display.toFixed(dec)}{suffix}</>;
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
