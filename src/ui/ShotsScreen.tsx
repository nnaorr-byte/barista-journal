import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { shotRepo } from '../db/repositories';
import { shotRatio, shotFlowRate, type Shot, type TasteTag } from '../domain/types';
import { EmptyState, Field, RatingPicker } from './components';
import { FLAVOR_LABELS, TASTE_LABELS, formatDateTime, ratingClass } from './labels';

export function ShotsScreen() {
  const data = useLiveQuery(async () => {
    const [shots, beans] = await Promise.all([
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.beans.toArray(),
    ]);
    return { shots, beans };
  });

  const [query, setQuery] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [tasteFilter, setTasteFilter] = useState<TasteTag | ''>('');
  const [editing, setEditing] = useState<Shot | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        <h2>🔍 חיפוש ביומן</h2>
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
        <h2>📖 היומן ({filtered.length} שוטים)</h2>
        {filtered.length === 0 && (
          <EmptyState icon="📭" text="אין שוטים תואמים" hint="נסה לשנות את הסינון או להכין שוט חדש." />
        )}
        {filtered.map((s) => (
          <div key={s.id}>
            <div className="shot-item" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <div className={`shot-rating ${ratingClass(s.rating)}`}>{s.rating}</div>
              <div style={{ flex: 1 }}>
                <div>{s.favorite && '⭐ '}{beanMap.get(s.beanId)?.name ?? 'פולים שנמחקו'}</div>
                <div className="muted small">
                  {s.doseGrams}←{s.yieldGrams} גרם · {s.brewTimeSec} שניות · טחינה {s.grindSetting}
                </div>
                <div className="muted small">{formatDateTime(s.createdAt)}</div>
              </div>
              <span className="muted">{expanded === s.id ? '▲' : '▼'}</span>
            </div>
            {expanded === s.id && (
              <div style={{ padding: '4px 8px 12px' }}>
                <p className="small" style={{ margin: '4px 0' }}>
                  יחס 1:{shotRatio(s).toFixed(1)} · זרימה {shotFlowRate(s).toFixed(1)} גרם/שנייה ·{' '}
                  {s.basketType} · {s.portafilterType}
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
                    {s.favorite ? '⭐ הסר מתכון' : '☆ שמור כמתכון'}
                  </button>
                  <button className="btn small secondary" onClick={() => setEditing(s)}>✏️ עריכה</button>
                  <button
                    className="btn small danger"
                    onClick={async () => {
                      if (confirm('למחוק את השוט הזה לצמיתות?')) await shotRepo.remove(s.id);
                    }}
                  >
                    🗑️ מחיקה
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EditShotForm({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const [dose, setDose] = useState(String(shot.doseGrams));
  const [yieldG, setYieldG] = useState(String(shot.yieldGrams));
  const [time, setTime] = useState(String(shot.brewTimeSec));
  const [grind, setGrind] = useState(String(shot.grindSetting));
  const [notes, setNotes] = useState(shot.notes);
  const [rating, setRating] = useState(shot.rating);

  return (
    <div className="card">
      <h2>✏️ עריכת שוט</h2>
      <div className="field-row thirds">
        <Field label="גרם נכנס"><input type="number" step="0.1" value={dose} onChange={(e) => setDose(e.target.value)} /></Field>
        <Field label="גרם יצא"><input type="number" step="0.1" value={yieldG} onChange={(e) => setYieldG(e.target.value)} /></Field>
        <Field label="זמן (שניות)"><input type="number" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <Field label="דרגת טחינה"><input type="number" step="0.5" value={grind} onChange={(e) => setGrind(e.target.value)} /></Field>
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
              yieldGrams: parseFloat(yieldG) || shot.yieldGrams,
              brewTimeSec: parseInt(time) || shot.brewTimeSec,
              grindSetting: parseFloat(grind) || shot.grindSetting,
              notes,
              rating,
            });
            onClose();
          }}
        >
          💾 שמירה
        </button>
      </div>
    </div>
  );
}
