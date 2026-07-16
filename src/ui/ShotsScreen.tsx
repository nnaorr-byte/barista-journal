import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { shotRepo } from '../db/repositories';
import { aiRecommend } from '../services/aiEngine';
import { adviceOutcomeForShot } from '../services/adviceAudit';
import {
  shotRatio, shotFlowRate,
  type AiAdvice, type FlavorNote, type Grinder, type MachineTempSetting,
  type QualityLevel, type Shot, type TasteTag,
} from '../domain/types';
import { Chips, EmptyState, Field, RatingPicker } from './components';
import { FLAVOR_LABELS, QUALITY_LABELS, TASTE_LABELS, TEMP_LABELS, formatDateTime, ratingClass, shotWeights } from './labels';
import { BrainIcon, ChevronDownIcon, EditIcon, JournalIcon, SaveIcon, ScaleIcon, SearchIcon, StarIcon, TrashIcon, TrophyIcon, UndoIcon } from './icons';

const TASTE_OPTIONS = (Object.entries(TASTE_LABELS) as [TasteTag, string][]).map(([value, label]) => ({ value, label }));
const FLAVOR_OPTIONS = (Object.entries(FLAVOR_LABELS) as [FlavorNote, string][]).map(([value, label]) => ({ value, label }));
const QUALITY_OPTIONS = (Object.entries(QUALITY_LABELS) as [QualityLevel, string][]).map(([value, label]) => ({ value, label }));

export function ShotsScreen() {
  const data = useLiveQuery(async () => {
    const [shots, beans, grinders] = await Promise.all([
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.beans.toArray(),
      db.grinders.toArray(),
    ]);
    return { shots, beans, grinders };
  });

  const [query, setQuery] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [tasteFilter, setTasteFilter] = useState<TasteTag | ''>('');
  const [editing, setEditing] = useState<Shot | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // השוואת שוטים: עד שני שוטים נבחרים — טבלת "מה שונה" מעל היומן
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const toggleCompare = (id: string) =>
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)));

  // ביטול מחיקה: השוט האחרון שנמחק נשמר בצד 6 שניות עם אפשרות שחזור.
  // הטוסט יוצא באנימציה קצרה לפני שהוא מוסר (closing).
  const [deletedShot, setDeletedShot] = useState<Shot | null>(null);
  const [toastClosing, setToastClosing] = useState(false);
  const undoTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  async function deleteWithUndo(s: Shot) {
    await shotRepo.remove(s.id);
    setDeletedShot(s);
    setToastClosing(false);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setToastClosing(true); // אנימציית יציאה, ואז הסרה בפועל
      undoTimerRef.current = window.setTimeout(() => {
        setDeletedShot(null);
        setToastClosing(false);
      }, 190);
    }, 6000);
  }

  async function undoDelete() {
    if (!deletedShot) return;
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    await shotRepo.put(deletedShot); // אותו id — השוט חוזר למקומו
    setDeletedShot(null);
    setToastClosing(false);
  }

  const beanMap = useMemo(
    () => new Map((data?.beans ?? []).map((b) => [b.id, b])),
    [data?.beans],
  );

  if (!data) return null;

  const filtered = data.shots.filter((s) => {
    if (minRating > 0 && s.rating < minRating) return false;
    if (tasteFilter && !s.tasteTags.includes(tasteFilter)) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const bean = beanMap.get(s.beanId);
      const haystack = [
        bean?.name ?? '', bean?.roastery ?? '', s.notes, s.tasteOther,
        new Date(s.createdAt).toLocaleDateString('he-IL'),
        String(s.rating), String(s.brewTimeSec), String(s.yieldGrams), String(s.grindSetting),
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (editing) {
    return <EditShotForm shot={editing} onClose={() => setEditing(null)} />;
  }

  return (
    <div>
      <div className="card">
        <h2><SearchIcon size={20} /> חיפוש ביומן</h2>
        <Field label="חיפוש חופשי (פולים, הערות, תאריך, דירוג…)">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="למשל: אתיופיה, מר, 8…" />
        </Field>
        <div className="field-row">
          <Field label="דירוג מינימלי">
            <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value={0}>הכול</option>
              {[5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </Field>
          <Field label="טעם">
            <select value={tasteFilter} onChange={(e) => setTasteFilter(e.target.value as TasteTag | '')}>
              <option value="">הכול</option>
              {(Object.entries(TASTE_LABELS) as [TasteTag, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {compareIds.length === 2 && (() => {
        const a = data.shots.find((s) => s.id === compareIds[0]);
        const b = data.shots.find((s) => s.id === compareIds[1]);
        if (!a || !b) return null;
        return (
          <ShotCompare
            a={a} b={b}
            beanName={(id: string) => beanMap.get(id)?.name ?? 'פולים שנמחקו'}
            grinderName={(id: string) => data.grinders.find((g) => g.id === id)?.name ?? '—'}
            onClose={() => setCompareIds([])}
          />
        );
      })()}

      <div className="card">
        <h2><JournalIcon size={20} /> היומן ({filtered.length} שוטים)</h2>
        {compareIds.length === 1 && (
          <p className="muted small" style={{ marginTop: 0 }}>
            נבחר שוט אחד להשוואה — פתח שוט נוסף ולחץ "השווה".
          </p>
        )}
        {filtered.length === 0 && (
          <EmptyState icon={<SearchIcon size={40} />} text="אין שוטים תואמים" hint="נסה לשנות את הסינון או להכין שוט חדש." />
        )}
        {filtered.map((s) => (
          <div key={s.id}>
            <button
              type="button"
              className="shot-item"
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              aria-expanded={expanded === s.id}
            >
              <span className={`shot-rating ${ratingClass(s.rating)}`}>{s.rating}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {s.favorite && <span style={{ color: 'var(--accent-strong)', display: 'inline-flex' }} title="מתכון שמור"><StarIcon size={15} filled /></span>}
                  {beanMap.get(s.beanId)?.name ?? 'פולים שנמחקו'}
                </span>
                <span className="muted small" style={{ display: 'block' }}>
                  {shotWeights(s)} · {s.brewTimeSec} שניות · טחינה {s.grindSetting}
                </span>
                <span className="muted small" style={{ display: 'block' }}>{formatDateTime(s.createdAt)}</span>
              </span>
              <span
                className="muted" aria-hidden="true"
                style={{ display: 'flex', transform: expanded === s.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s var(--spring)' }}
              >
                <ChevronDownIcon size={18} />
              </span>
            </button>
            {expanded === s.id && (
              <div className="shot-detail-in" style={{ padding: '4px 8px 12px' }}>
                <p className="small" style={{ margin: '4px 0' }}>
                  יחס 1:{shotRatio(s).toFixed(1)} · זרימה {shotFlowRate(s).toFixed(1)} גרם/שנייה
                  {s.yieldStopGrams && s.yieldGrams > s.yieldStopGrams
                    ? ` · טפטוף ${(s.yieldGrams - s.yieldStopGrams).toFixed(1)} גרם`
                    : ''}
                  {' · '}{s.basketType} · {s.portafilterType}
                </p>
                {s.tasteTags.length > 0 && (
                  <p className="small" style={{ margin: '4px 0' }}>
                    טעמים: {s.tasteTags.map((t) => TASTE_LABELS[t]).join(', ')}
                    {s.tasteOther && ` (${s.tasteOther})`}
                  </p>
                )}
                {(s.flavorNotes?.length ?? 0) > 0 && (
                  <p className="small" style={{ margin: '4px 0' }}>
                    תווי טעם: {s.flavorNotes!.map((f) => FLAVOR_LABELS[f]).join(' · ')}
                  </p>
                )}
                {s.notes && <p className="small muted" style={{ margin: '4px 0' }}>"{s.notes}"</p>}
                <ShotAdviceBlock shot={s} shots={data.shots} grinders={data.grinders} />
                <div className="btn-row">
                  <button
                    className="btn small secondary"
                    onClick={async () => {
                      if (s.favorite) {
                        await shotRepo.put({ ...s, favorite: false });
                      } else {
                        // מתכון אחד לכל פולים — מסירים סימון קודם
                        const prev = data.shots.filter((x) => x.beanId === s.beanId && x.favorite);
                        for (const p of prev) await shotRepo.put({ ...p, favorite: false });
                        await shotRepo.put({ ...s, favorite: true });
                      }
                    }}
                  >
                    {s.favorite ? <><StarIcon size={17} filled /> הסר מתכון</> : <><StarIcon size={17} /> שמור כמתכון</>}
                  </button>
                  <button className="btn small secondary" onClick={() => setEditing(s)}><EditIcon size={17} /> עריכה</button>
                  <button className="btn small secondary" onClick={() => toggleCompare(s.id)}>
                    <ScaleIcon size={17} /> {compareIds.includes(s.id) ? 'הסר מהשוואה' : 'השווה'}
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => deleteWithUndo(s)}
                  >
                    <TrashIcon size={17} /> מחיקה
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* טוסט ביטול מחיקה — לא גונב פוקוס, מוכרז לקורא מסך */}
      {deletedShot && (
        <div className={`undo-toast ${toastClosing ? 'closing' : ''}`} role="status">
          <span>השוט נמחק</span>
          <button className="btn small" onClick={undoDelete}><UndoIcon size={17} /> ביטול</button>
        </div>
      )}
    </div>
  );
}

// ===== השוואת שני שוטים: טבלת "מה שונה" =====
// הבדלים מודגשים — כך רואים מיד איזה משתנה עשה את ההבדל בין שוט טוב לפחות טוב.
function ShotCompare({
  a, b, beanName, grinderName, onClose,
}: {
  a: Shot;
  b: Shot;
  beanName: (beanId: string) => string;
  grinderName: (grinderId: string) => string;
  onClose: () => void;
}) {
  const rows: { label: string; va: string; vb: string }[] = [
    { label: 'פולים', va: beanName(a.beanId), vb: beanName(b.beanId) },
    { label: 'תאריך', va: formatDateTime(a.createdAt), vb: formatDateTime(b.createdAt) },
    { label: 'דירוג', va: `${a.rating}/10`, vb: `${b.rating}/10` },
    { label: 'מנה (גרם)', va: String(a.doseGrams), vb: String(b.doseGrams) },
    { label: 'סופי בכוס (גרם)', va: String(a.yieldGrams), vb: String(b.yieldGrams) },
    { label: 'יחס', va: `1:${shotRatio(a).toFixed(1)}`, vb: `1:${shotRatio(b).toFixed(1)}` },
    { label: 'זמן (שניות)', va: String(a.brewTimeSec), vb: String(b.brewTimeSec) },
    { label: 'זרימה (גרם/שנ׳)', va: shotFlowRate(a).toFixed(1), vb: shotFlowRate(b).toFixed(1) },
    { label: 'טחינה', va: `${a.grindSetting} (${grinderName(a.grinderId)})`, vb: `${b.grindSetting} (${grinderName(b.grinderId)})` },
    { label: 'טמפרטורה', va: TEMP_LABELS[a.machineTemp], vb: TEMP_LABELS[b.machineTemp] },
    { label: 'סלסלה', va: a.basketType, vb: b.basketType },
    { label: 'טעמים', va: a.tasteTags.map((t) => TASTE_LABELS[t]).join(', ') || '—', vb: b.tasteTags.map((t) => TASTE_LABELS[t]).join(', ') || '—' },
  ];
  const better = a.rating === b.rating ? null : a.rating > b.rating ? 'a' : 'b';
  const diffStyle = { color: 'var(--accent-strong)', fontWeight: 700 } as const;

  return (
    <div className="card accent">
      <h2><ScaleIcon size={20} /> השוואת שוטים</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>שוט א׳{better === 'a' && <> <TrophyIcon size={15} /></>}</th>
              <th>שוט ב׳{better === 'b' && <> <TrophyIcon size={15} /></>}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.va !== r.vb;
              return (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  <td style={diff ? diffStyle : undefined}>{r.va}</td>
                  <td style={diff ? diffStyle : undefined}>{r.vb}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        ערכים מודגשים = שונים בין השוטים. שם מסתתרת התשובה למה שוט אחד עבד יותר טוב.
      </p>
      <button className="btn small secondary" onClick={onClose}>סגור השוואה</button>
    </div>
  );
}

// ההמלצה שמוח ה-AI נתן על השוט: מהתיעוד שנשמר איתו, או שחזור
// מהנתונים ההיסטוריים עבור שוטים שנשמרו לפני שהמוח נוסף.
function reconstructAdvice(shot: Shot, shots: Shot[], grinders: Grinder[]): AiAdvice | null {
  try {
    const history = shots
      .filter((x) => x.beanId === shot.beanId && x.grinderId === shot.grinderId && x.createdAt <= shot.createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!history.some((x) => x.id === shot.id)) history.push(shot);
    const prevBeanShot = shots
      .filter((x) => x.beanId === shot.beanId && x.createdAt < shot.createdAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return aiRecommend({
      lastShot: shot,
      beanShots: history,
      grinder: grinders.find((g) => g.id === shot.grinderId),
      grinderChanged: !!prevBeanShot && prevBeanShot.grinderId !== shot.grinderId,
    });
  } catch {
    return null;
  }
}

function ShotAdviceBlock({ shot, shots, grinders }: { shot: Shot; shots: Shot[]; grinders: Grinder[] }) {
  const stored = shot.aiAdvice ?? null;
  const advice = stored ?? reconstructAdvice(shot, shots, grinders);
  if (!advice) return null;

  // מה קרה להמלצה בשוט הבא — המוח בודק את עצמו
  const outcome = adviceOutcomeForShot(shot, advice, shots);
  let outcomeLine: { text: string; color: string } | null = null;
  if (outcome) {
    const delta = `${outcome.ratingFrom}→${outcome.ratingTo}`;
    if (!outcome.followed) {
      outcomeLine = { text: `ההמלצה לא יושמה בשוט הבא (דירוג ${delta}).`, color: 'var(--text-muted)' };
    } else if (outcome.improved) {
      outcomeLine = {
        text: outcome.ratingTo > outcome.ratingFrom
          ? `✓ יישמת את ההמלצה — הדירוג עלה ${delta}.`
          : `✓ יישמת את ההמלצה — הרמה נשמרה (${delta}).`,
        color: 'var(--good)',
      };
    } else {
      outcomeLine = { text: `יישמת את ההמלצה אך הדירוג לא עלה (${delta}).`, color: 'var(--warn)' };
    }
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '9px 12px', margin: '6px 0' }}>
      <div className="coach-label" style={{ marginBottom: 4 }}>
        <BrainIcon size={15} /> ההמלצה שקיבלת על השוט הזה{stored ? '' : ' (שחזור)'}
      </div>
      <p className="small" style={{ margin: '3px 0' }}>{advice.diagnosis}</p>
      <p className="small" style={{ margin: '3px 0', fontWeight: 600 }}>
        {advice.changeKind === 'none' ? '✓ ' : '← '}{advice.instruction}
      </p>
      <p className="muted small" style={{ margin: '3px 0' }}>רמת ביטחון: {advice.confidencePct}%</p>
      {outcomeLine && (
        <p className="small" style={{ margin: '3px 0', color: outcomeLine.color, fontWeight: 600 }}>
          {outcomeLine.text}
        </p>
      )}
    </div>
  );
}

function EditShotForm({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const [dose, setDose] = useState(String(shot.doseGrams));
  const [yieldStop, setYieldStop] = useState(shot.yieldStopGrams ? String(shot.yieldStopGrams) : '');
  const [yieldG, setYieldG] = useState(String(shot.yieldGrams));
  const [time, setTime] = useState(String(shot.brewTimeSec));
  const [grind, setGrind] = useState(String(shot.grindSetting));
  const [temp, setTemp] = useState<MachineTempSetting>(shot.machineTemp);
  const [basketType, setBasketType] = useState(shot.basketType);
  const [portafilterType, setPortafilterType] = useState(shot.portafilterType);
  const [tasteTags, setTasteTags] = useState<TasteTag[]>(shot.tasteTags);
  const [tasteOther, setTasteOther] = useState(shot.tasteOther);
  const [flavorNotes, setFlavorNotes] = useState<FlavorNote[]>(shot.flavorNotes ?? []);
  const [body, setBody] = useState<QualityLevel | null>(shot.body);
  const [crema, setCrema] = useState<QualityLevel | null>(shot.crema);
  const [aftertaste, setAftertaste] = useState<QualityLevel | null>(shot.aftertaste);
  const [notes, setNotes] = useState(shot.notes);
  const [rating, setRating] = useState(shot.rating);

  return (
    <div className="card">
      <h2><EditIcon size={20} /> עריכת שוט — {formatDateTime(shot.createdAt)}</h2>
      <div className="field-row thirds">
        <Field label="גרם נכנס"><input type="number" step="0.1" value={dose} onChange={(e) => setDose(e.target.value)} /></Field>
        <Field label="עצירה בפועל (גרם)"><input type="number" step="0.1" placeholder="לא תועד" value={yieldStop} onChange={(e) => setYieldStop(e.target.value)} /></Field>
        <Field label="סופי אחרי טפטוף"><input type="number" step="0.1" value={yieldG} onChange={(e) => setYieldG(e.target.value)} /></Field>
      </div>
      <div className="field-row thirds">
        <Field label="זמן (שניות)"><input type="number" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="דרגת טחינה"><input type="number" step="0.5" value={grind} onChange={(e) => setGrind(e.target.value)} /></Field>
        <Field label="טמפרטורה">
          <select value={temp} onChange={(e) => setTemp(e.target.value as MachineTempSetting)}>
            {(Object.entries(TEMP_LABELS) as [MachineTempSetting, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="סוג סלסלה">
          <select value={basketType} onChange={(e) => setBasketType(e.target.value)}>
            {['סטנדרטית', 'Pressurized (מקורית)', 'IMS / מקצועית', shot.basketType]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="פורטפילטר">
          <select value={portafilterType} onChange={(e) => setPortafilterType(e.target.value)}>
            {['Bottomless', 'Standard', shot.portafilterType]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <h3>טעם</h3>
      <Chips
        options={TASTE_OPTIONS} selected={tasteTags}
        onToggle={(t) => setTasteTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
      />
      {tasteTags.includes('other') && (
        <div style={{ marginTop: 8 }}>
          <input placeholder="תאר את הטעם…" value={tasteOther} onChange={(e) => setTasteOther(e.target.value)} />
        </div>
      )}

      <h3>תווי טעם — גלגל הטעמים</h3>
      <Chips
        options={FLAVOR_OPTIONS} selected={flavorNotes}
        onToggle={(f) => setFlavorNotes((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))}
      />

      <h3>Body</h3>
      <Chips options={QUALITY_OPTIONS} selected={body ? [body] : []} onToggle={(v) => setBody(body === v ? null : v)} />
      <h3>Crema</h3>
      <Chips options={QUALITY_OPTIONS} selected={crema ? [crema] : []} onToggle={(v) => setCrema(crema === v ? null : v)} />
      <h3>Aftertaste</h3>
      <Chips options={QUALITY_OPTIONS} selected={aftertaste ? [aftertaste] : []} onToggle={(v) => setAftertaste(aftertaste === v ? null : v)} />

      <Field label="הערות"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <h3>דירוג</h3>
      <RatingPicker value={rating} onChange={setRating} />
      <div className="btn-row">
        <button className="btn secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn" style={{ flex: 1 }}
          onClick={async () => {
            await shotRepo.put({
              ...shot,
              doseGrams: parseFloat(dose) || shot.doseGrams,
              yieldStopGrams: yieldStop ? parseFloat(yieldStop) : null,
              yieldGrams: parseFloat(yieldG) || shot.yieldGrams,
              brewTimeSec: parseInt(time) || shot.brewTimeSec,
              grindSetting: parseFloat(grind) || shot.grindSetting,
              machineTemp: temp,
              basketType,
              portafilterType,
              tasteTags,
              tasteOther: tasteTags.includes('other') ? tasteOther : '',
              flavorNotes,
              body,
              crema,
              aftertaste,
              notes,
              rating,
            });
            onClose();
          }}
        >
          <SaveIcon size={18} /> שמירה
        </button>
      </div>
    </div>
  );
}
