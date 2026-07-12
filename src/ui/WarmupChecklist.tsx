import { useState } from 'react';

// שגרת חימום מודרכת למכונת Single Boiler (DeLonghi EC685).
// צ'ק-ליסט לכל ביקור במסך — לא נשמר ב-DB, רק מלווה את ההכנה.
const STEPS = [
  {
    key: 'power',
    text: 'הדלק את המכונה עם הפורטפילטר (ריק) נעול בראש',
    hint: 'המתן 15–20 דקות. הנורית נדלקת מוקדם — הבוילר הקטן צריך יותר זמן, וגם הפורטפילטר מתחמם ככה.',
  },
  {
    key: 'cup',
    text: 'חמם את הכוס — מלא אותה במים חמים מהראש',
    hint: null,
  },
  {
    key: 'flush',
    text: 'הרץ מים דרך הראש כ-20 שניות (Flush)',
    hint: 'מחמם את הראש ואת הסלסלה בדרך.',
  },
  {
    key: 'cooling',
    text: 'הקצפת חלב לפני השוט? בצע Cooling Flush',
    hint: 'אחרי קיטור הבוילר חם מדי לאספרסו — הרץ מים עד שהזרם מפסיק להתיז ומתייצב.',
  },
  {
    key: 'dry',
    text: 'רוקן את הכוס וייבש את הסלסלה לפני הטחינה',
    hint: 'סלסלה רטובה = תעלות מים בפאק.',
  },
];

export function WarmupChecklist({ machineName }: { machineName: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  if (!open) {
    return (
      <button className="btn secondary block" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>
        🔥 שגרת חימום ({machineName})
      </button>
    );
  }

  const toggle = (k: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="card" style={{ background: 'var(--bg-elevated)' }}>
      <h3 style={{ marginTop: 0 }}>🔥 שגרת חימום — {machineName}</h3>
      {STEPS.map((s, i) => (
        <label key={s.key} className="warmup-step">
          <input type="checkbox" checked={done.has(s.key)} onChange={() => toggle(s.key)} />
          <span>
            <span className={done.has(s.key) ? 'warmup-done' : ''}>{i + 1}. {s.text}</span>
            {s.hint && <span className="muted small" style={{ display: 'block' }}>{s.hint}</span>}
          </span>
        </label>
      ))}
      <p className="muted small" style={{ margin: '8px 0 10px' }} role="status">
        {done.size === STEPS.length ? '✓ המכונה מוכנה — קדימה לשוט!' : `${done.size}/${STEPS.length} הושלמו`}
      </p>
      <button className="btn small secondary" onClick={() => setOpen(false)}>סגור</button>
    </div>
  );
}
