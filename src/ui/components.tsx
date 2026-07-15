import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat-tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Chips<T extends string>({
  options, selected, onToggle, multi = true,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  multi?: boolean;
}) {
  return (
    <div className="chips" role="group" aria-label={multi ? 'בחירה מרובה' : 'בחירה יחידה'}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip ${selected.includes(o.value) ? 'selected' : ''}`}
          aria-pressed={selected.includes(o.value)}
          onClick={() => onToggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RatingPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="rating-row" role="radiogroup" aria-label="דירוג אישי מ-1 עד 10">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} מתוך 10`}
          className={value === n ? 'selected' : ''}
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

// מספר שנספר למעלה בכניסה למסך (~0.6 שניות, ease-out).
// מכבד "הפחתת תנועה" — במצב כזה מציג את הערך הסופי מיד.
export function CountUp({ value, decimals, prefix = '', suffix = '', duration = 600 }: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const dec = decimals ?? (Number.isInteger(value) ? 0 : 1);
  const [display, setDisplay] = useState(() =>
    matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{prefix}{display.toFixed(dec)}{suffix}</>;
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
