import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { shotRepo } from '../db/repositories';
import { aiRecommend } from '../services/aiEngine';
import {
  shotRatio, shotFlowRate,
  type AiAdvice, type FlavorNote, type Grinder, type MachineTempSetting,
  type QualityLevel, type Shot, type TasteTag,
} from '../domain/types';
import { Chips, EmptyState, Field, RatingPicker } from './components';
import { FLAVOR_LABELS, QUALITY_LABELS, TASTE_LABELS, TEMP_LABELS, formatDateTime, ratingClass, shotWeights } from './labels';
import { BrainIcon, EditIcon, JournalIcon, SaveIcon, SearchIcon, StarIcon, TrashIcon, UndoIcon } from './icons';

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

  // ביטול מחיקה: השוט האחרון שנמחק נשמר בצד 6 שניות עם אפשרות שחזור
  const [deletedShot, setDeletedShot] = useState<Shot | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  async function deleteWithUndo(s: Shot) {
    await shotRepo.remove(s.id);
    setDeletedShot(s);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setDeletedShot(null), 6000);
  }

  async function undoDelete() {
    if (!deletedShot) return;
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    await shotRepo.put(deletedShot); // אותו id — השוט חוזר למקומו
    setDeletedShot(null);
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
        <h2><SearchIcon size={18} /> חיפוש ביומן</h2>
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

      <div className="card">
        <h2><JournalIcon size={18} /> היומן ({filtered.length} שוטים)</h2>
        {filtered.length === 0 && (
          <EmptyState icon="📭" text="אין שוטים תואמים" hint="נסה לשנות את הסינון או להכין שוט חדש." />
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
                <span style={{ display: 'block' }}>{s.favorite && '⭐ '}{beanMap.get(s.beanId)?.name ?? 'פולים שנמחקו'}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  {shotWeights(s)} · {s.brewTimeSec} שניות · טחינה {s.grindSetting}
                </span>
                <span className="muted small" style={{ display: 'block' }}>{formatDateTime(s.createdAt)}</span>
              </span>
              <span className="muted" aria-hidden="true">{expanded === s.id ? '▲' : '▼'}</span>
            </button>
            {expanded === s.id && (
              <div style={{ padding: '4px 8px 12px' }}>
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
                    {s.favorite ? <><StarIcon size={15} filled /> הסר מתכון</> : <><StarIcon size={15} /> שמור כמתכון</>}
                  </button>
                  <button className="btn small secondary" onClick={() => setEditing(s)}><EditIcon size={15} /> עריכה</button>
                  <button
                    className="btn small danger"
                    onClick={() => deleteWithUndo(s)}
                  >
                    <TrashIcon size={15} /> מחיקה
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* טוסט ביטול מחיקה — לא גונב פוקוס, מוכרז לקורא מסך */}
      {deletedShot && (
        <div className="undo-toast" role="status">
          <span>השוט נמחק</span>
          <button className="btn small" onClick={undoDelete}><UndoIcon size={15} /> ביטול</button>
        </div>
      )}
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
  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '9px 12px', margin: '6px 0' }}>
      <div className="coach-label" style={{ marginBottom: 4 }}>
        <BrainIcon size={13} /> ההמלצה שקיבלת על השוט הזה{stored ? '' : ' (שחזור)'}
      </div>
      <p className="small" style={{ margin: '3px 0' }}>{advice.diagnosis}</p>
      <p className="small" style={{ margin: '3px 0', fontWeight: 600 }}>
        {advice.changeKind === 'none' ? '✓ ' : '← '}{advice.instruction}
      </p>
      <p className="muted small" style={{ margin: '3px 0' }}>רמת ביטחון: {advice.confidencePct}%</p>
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
      <h2><EditIcon size={18} /> עריכת שוט — {formatDateTime(shot.createdAt)}</h2>
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
          <SaveIcon size={16} /> שמירה
        </button>
      </div>
    </div>
  );
}
