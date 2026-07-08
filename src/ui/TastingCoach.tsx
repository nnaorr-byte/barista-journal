import { useState } from 'react';
import type { QualityLevel, TasteTag } from '../domain/types';

// אימון טעימה מודרך: שלוש לגימות, שלוש שאלות — והתוצאה ממלאת
// אוטומטית את שדות הטעם, הגוף וה-Aftertaste בטופס.

export interface TastingResult {
  tags: TasteTag[];
  body: QualityLevel | null;
  aftertaste: QualityLevel | null;
  summary: string;
}

interface StepOption {
  label: string;
  tags?: TasteTag[];
  body?: QualityLevel;
  aftertaste?: QualityLevel;
  flag: 'good' | 'under' | 'over' | 'neutral';
}

interface Step {
  title: string;
  guidance: string;
  options: StepOption[];
}

const STEPS: Step[] = [
  {
    title: 'לגימה ראשונה — חמיצות',
    guidance:
      'קח לגימה קטנה ותן לה להתפשט על קצה הלשון. חמיצות טובה מרגישה כמו פרי בשל — חיה ונעימה. חמיצות של תת-מיצוי מרגישה כמו לימון חד שמכווץ את הלסת.',
    options: [
      { label: '🍑 בהירה ונעימה, כמו פרי', flag: 'good' },
      { label: '🍋 חדה וחומצית מדי', tags: ['sour'], flag: 'under' },
      { label: '😐 כמעט אין חמיצות', flag: 'neutral' },
    ],
  },
  {
    title: 'אמצע הלגימה — מתיקות וגוף',
    guidance:
      'לגימה שנייה, הפעם שים לב למרקם ולאמצע הטעם. שוט טוב מרגיש עגול וסירופי, עם מתיקות טבעית של קרמל או שוקולד. שוט חלש מרגיש כמו קפה מדולל במים.',
    options: [
      { label: '🍯 מתוק, מלא וסירופי', tags: ['sweet'], body: 'good', flag: 'good' },
      { label: '😐 בינוני, לא בולט', body: 'ok', flag: 'neutral' },
      { label: '💧 דל, דליל ומימי', tags: ['watery'], body: 'poor', flag: 'under' },
    ],
  },
  {
    title: 'הסיום — מרירות וטעם נשאר',
    guidance:
      'בלע ושים לב מה נשאר בפה אחרי 5 שניות. סיום טוב הוא נקי ומתקתק שמזמין עוד לגימה. מיצוי-יתר משאיר מרירות שורפת בגרון או יובש עפיץ על הלשון.',
    options: [
      { label: '✨ נקי, מתקתק ונעים', aftertaste: 'good', flag: 'good' },
      { label: '🔥 מרירות שורפת', tags: ['bitter'], aftertaste: 'poor', flag: 'over' },
      { label: '🏜️ יובש ועפיצות', tags: ['dry'], aftertaste: 'poor', flag: 'over' },
    ],
  },
];

export function TastingCoach({ onComplete, onCancel }: {
  onComplete: (result: TastingResult) => void;
  onCancel: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [picks, setPicks] = useState<StepOption[]>([]);

  const step = STEPS[stepIdx];

  function pick(option: StepOption) {
    const newPicks = [...picks, option];
    if (stepIdx < STEPS.length - 1) {
      setPicks(newPicks);
      setStepIdx(stepIdx + 1);
      return;
    }
    // סיכום
    const tags = [...new Set(newPicks.flatMap((p) => p.tags ?? []))];
    const body = newPicks.find((p) => p.body)?.body ?? null;
    const aftertaste = newPicks.find((p) => p.aftertaste)?.aftertaste ?? null;
    const flags = newPicks.map((p) => p.flag);
    const under = flags.filter((f) => f === 'under').length;
    const over = flags.filter((f) => f === 'over').length;
    const good = flags.filter((f) => f === 'good').length;

    let summary: string;
    if (good === 3) {
      tags.push('balanced');
      summary = 'שלוש תשובות חיוביות — זה שוט מאוזן! סימנתי "מאוזן" עבורך. שים לב מה עשית היום וחזור על זה במדויק.';
    } else if (under > over) {
      summary = 'החמיצות/מימיות שזיהית מכוונות לתת-מיצוי. ה-AI Coach ינתח את זה יחד עם המספרים אחרי השמירה.';
    } else if (over > under) {
      summary = 'המרירות/יובש שזיהית מכוונים למיצוי-יתר. ה-AI Coach ינתח את זה יחד עם המספרים אחרי השמירה.';
    } else if (under > 0 && over > 0) {
      summary = 'זיהית גם סימני תת-מיצוי וגם מיצוי-יתר — דפוס קלאסי של תיעול (Channeling). שים לב להכנת הפאק בשוט הבא.';
    } else {
      summary = 'טעימה מאוזנת יחסית עם מקום לשיפור. הדירוג שתיתן יעזור ל-Coach לדייק.';
    }

    onComplete({ tags, body, aftertaste, summary });
  }

  return (
    <div className="card accent" style={{ marginTop: 10 }}>
      <h2>👅 אימון טעימה — שלב {stepIdx + 1} מתוך 3</h2>
      <h3 style={{ marginTop: 4 }}>{step.title}</h3>
      <p className="small" style={{ color: 'var(--crema)' }}>{step.guidance}</p>
      <div className="btn-row" style={{ flexDirection: 'column' }}>
        {step.options.map((o) => (
          <button key={o.label} className="btn secondary block" onClick={() => pick(o)}>
            {o.label}
          </button>
        ))}
      </div>
      <button className="btn small secondary" style={{ marginTop: 10 }} onClick={onCancel}>
        ביטול
      </button>
    </div>
  );
}
