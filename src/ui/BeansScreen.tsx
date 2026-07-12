import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { bagRepo, beanRepo } from '../db/repositories';
import { computeBagUsage } from '../services/stats';
import { computeFreshness, formatDeadline } from '../services/freshness';
import type { RoastLevel } from '../domain/types';
import { EmptyState, Field } from './components';
import { ROAST_LEVELS, formatDate, ratingClass } from './labels';

// אפשרויות כמות מוכנות לשקית קפה
const BAG_SIZES = [
  { grams: 250, label: '250 גרם' },
  { grams: 500, label: '500 גרם' },
  { grams: 1000, label: 'קילו (1000 גרם)' },
];

function bagSizeLabel(grams: number): string {
  return BAG_SIZES.find((s) => s.grams === grams)?.label ?? `${grams} גרם`;
}

// פס טריות: 0 עד 60 יום. הסמן זז לאורך הפס לפי גיל הקלייה.
function FreshnessBar({ ageDays }: { ageDays: number }) {
  const pct = Math.min(100, (ageDays / 60) * 100);
  return (
    <div style={{ margin: '6px 0' }} dir="ltr">
      <div style={{
        position: 'relative', height: 6, borderRadius: 999,
        background: 'linear-gradient(90deg, var(--warn) 0%, var(--good) 12% 50%, var(--warn) 75%, var(--bad) 100%)',
        opacity: 0.55,
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--crema)', border: '2px solid var(--bg-elevated)',
          transform: 'translate(-50%, -50%)', boxShadow: '0 0 6px rgba(0,0,0,0.4)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
        <span>קלייה</span><span>שיא ~14י'</span><span>דד-ליין 60י'</span>
      </div>
    </div>
  );
}

export function BeansScreen() {
  const data = useLiveQuery(async () => {
    const [beans, bags, shots] = await Promise.all([
      db.beans.toArray(),
      db.bags.toArray(),
      db.shots.toArray(),
    ]);
    return { beans, bags, shots };
  });

  const [showForm, setShowForm] = useState(false);
  const [addingBagFor, setAddingBagFor] = useState<string | null>(null);

  if (!data) return null;
  const { beans, bags, shots } = data;
  const activeBeans = beans.filter((b) => !b.archived);

  return (
    <div>
      <div className="card">
        <h2>🫘 ניהול פולים</h2>
        {!showForm && (
          <button className="btn block" onClick={() => setShowForm(true)}>➕ פולים חדשים</button>
        )}
        {showForm && <NewBeanForm onClose={() => setShowForm(false)} />}
      </div>

      {activeBeans.length === 0 && !showForm && (
        <div className="card">
          <EmptyState icon="🫘" text="אין פולים במערכת" hint="הוסף את הפולים הראשונים כדי להתחיל לתעד שוטים." />
        </div>
      )}

      {activeBeans.map((bean) => {
        const beanBags = bags.filter((b) => b.beanId === bean.id);
        const beanShots = shots.filter((s) => s.beanId === bean.id);
        const avgRating = beanShots.length
          ? beanShots.reduce((a, s) => a + s.rating, 0) / beanShots.length
          : null;

        return (
          <div key={bean.id} className="card">
            <h2>
              {bean.name}
              {avgRating !== null && (
                <span className={`shot-rating ${ratingClass(avgRating)}`} style={{ minWidth: 38, height: 32, fontSize: '0.9rem' }}>
                  {avgRating.toFixed(1)}
                </span>
              )}
            </h2>
            <p className="muted small" style={{ margin: '2px 0 8px' }}>
              {[bean.roastery, bean.originCountry, bean.variety, bean.process].filter(Boolean).join(' · ')}
              {' · קלייה '}
              {ROAST_LEVELS.find((r) => r.value === bean.roastLevel)?.label}
            </p>
            {bean.notes && <p className="small">{bean.notes}</p>}
            <p className="muted small">{beanShots.length} שוטים סה״כ מהפולים האלה</p>

            {beanBags.map((bag) => {
              const usage = computeBagUsage(bag, shots);
              const fresh = computeFreshness(bag.roastDate);
              return (
                <div key={bag.id} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <div className="small">
                    <strong>שקית {bagSizeLabel(bag.weightGrams)}</strong>
                    {bag.finished && <span className="badge" style={{ marginInlineStart: 6 }}>נגמרה</span>}
                    {!bag.finished && fresh.stage !== 'unknown' && (
                      <span className={`badge ${fresh.cls}`} style={{ marginInlineStart: 6 }}>{fresh.label}</span>
                    )}
                  </div>
                  <div className="muted small">
                    נקלתה: {formatDate(bag.roastDate)} · נפתחה: {formatDate(bag.openDate)}
                    {bag.price !== null && ` · ₪${bag.price}`}
                  </div>
                  {!bag.finished && fresh.deadlineDate && (
                    <div className="small" style={{ margin: '4px 0', color: fresh.stage === 'expired' ? 'var(--bad)' : 'var(--crema)' }}>
                      {fresh.stage === 'expired' ? '⚠️' : '📅'} דד-ליין טריות: {formatDeadline(fresh.deadlineDate)}
                      {fresh.daysToDeadline !== null && fresh.daysToDeadline > 0 && ` · עוד ${fresh.daysToDeadline} ימים`}
                    </div>
                  )}
                  {/* פס טריות ויזואלי — 0 עד 60 יום */}
                  {!bag.finished && fresh.ageDays !== null && (
                    <FreshnessBar ageDays={fresh.ageDays} />
                  )}
                  <div className="muted small">
                    {usage.shotsCount} שוטים · נצרכו {usage.gramsUsed.toFixed(0)} גרם · נשארו ~{usage.gramsLeft.toFixed(0)} גרם
                    {usage.costPerShot !== null && ` · ₪${usage.costPerShot.toFixed(1)} לשוט`}
                  </div>
                  {!bag.finished ? (
                    <button
                      className="btn small secondary" style={{ marginTop: 6 }}
                      onClick={() => bagRepo.put({ ...bag, finished: true })}
                    >
                      סמן כנגמרה
                    </button>
                  ) : (
                    <button
                      className="btn small secondary" style={{ marginTop: 6 }}
                      onClick={() => bagRepo.put({ ...bag, finished: false })}
                    >
                      ↩️ החזר שקית
                    </button>
                  )}
                </div>
              );
            })}

            {addingBagFor === bean.id ? (
              <NewBagForm beanId={bean.id} onClose={() => setAddingBagFor(null)} />
            ) : (
              <div className="btn-row">
                <button className="btn small secondary" onClick={() => setAddingBagFor(bean.id)}>
                  ➕ שקית חדשה
                </button>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    if (confirm(`למחוק את "${bean.name}" כולל כל השוטים והשקיות שלו? הפעולה בלתי הפיכה.`)) {
                      await beanRepo.remove(bean.id);
                    }
                  }}
                >
                  🗑️ מחיקת פולים
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NewBeanForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [roastery, setRoastery] = useState('');
  const [origin, setOrigin] = useState('');
  const [variety, setVariety] = useState('');
  const [process, setProcess] = useState('');
  const [roastLevel, setRoastLevel] = useState<RoastLevel>('medium');
  const [notes, setNotes] = useState('');

  return (
    <div style={{ marginTop: 10 }}>
      <Field label="שם הפולים *">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: Ethiopia Yirgacheffe" />
      </Field>
      <div className="field-row">
        <Field label="בית קלייה">
          <input value={roastery} onChange={(e) => setRoastery(e.target.value)} />
        </Field>
        <Field label="מדינת מקור">
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="זן">
          <input value={variety} onChange={(e) => setVariety(e.target.value)} placeholder="Heirloom, Bourbon…" />
        </Field>
        <Field label="Process">
          <input value={process} onChange={(e) => setProcess(e.target.value)} placeholder="Washed, Natural…" />
        </Field>
      </div>
      <Field label="רמת קלייה">
        <select value={roastLevel} onChange={(e) => setRoastLevel(e.target.value as RoastLevel)}>
          {ROAST_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="הערות">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="תווי טעם מהאריזה, רשמים…" />
      </Field>
      <div className="btn-row">
        <button className="btn secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn" style={{ flex: 1 }} disabled={!name.trim()}
          onClick={async () => {
            const user = (await db.users.toArray())[0];
            await beanRepo.create({
              userId: user.id, name: name.trim(), roastery, originCountry: origin,
              variety, process, roastLevel, notes,
            });
            onClose();
          }}
        >
          💾 שמירת פולים
        </button>
      </div>
    </div>
  );
}

function NewBagForm({ beanId, onClose }: { beanId: string; onClose: () => void }) {
  const [roastDate, setRoastDate] = useState('');
  const [openDate, setOpenDate] = useState('');
  const [weight, setWeight] = useState(250);
  const [customWeight, setCustomWeight] = useState('');
  const [price, setPrice] = useState('');

  const isCustom = !BAG_SIZES.some((s) => s.grams === weight);
  const effectiveWeight = isCustom ? parseInt(customWeight) || 0 : weight;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="field-row">
        <Field label="תאריך קלייה">
          <input type="date" value={roastDate} onChange={(e) => setRoastDate(e.target.value)} />
        </Field>
        <Field label="תאריך פתיחה">
          <input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
        </Field>
      </div>

      <Field label="כמות בשקית">
        <div className="chips">
          {BAG_SIZES.map((s) => (
            <button
              key={s.grams} type="button"
              className={`chip ${weight === s.grams ? 'selected' : ''}`}
              onClick={() => setWeight(s.grams)}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${isCustom ? 'selected' : ''}`}
            onClick={() => setWeight(-1)}
          >
            אחר
          </button>
        </div>
      </Field>
      {isCustom && (
        <Field label="משקל מותאם (גרם)">
          <input type="number" inputMode="numeric" value={customWeight} onChange={(e) => setCustomWeight(e.target.value)} placeholder="למשל: 340" />
        </Field>
      )}

      <Field label="מחיר (₪)">
        <input type="number" step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="מחיר השקית" />
      </Field>
      {price && effectiveWeight > 0 && (
        <p className="muted small" style={{ marginTop: -4 }}>
          ₪{(parseFloat(price) / effectiveWeight * 100).toFixed(1)} ל-100 גרם
        </p>
      )}

      <div className="btn-row">
        <button className="btn small secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn small" disabled={effectiveWeight <= 0}
          onClick={async () => {
            await bagRepo.create({
              beanId,
              roastDate: roastDate || null,
              openDate: openDate || null,
              price: price ? parseFloat(price) : null,
              weightGrams: effectiveWeight,
            });
            onClose();
          }}
        >
          ➕ הוספת שקית
        </button>
      </div>
    </div>
  );
}
