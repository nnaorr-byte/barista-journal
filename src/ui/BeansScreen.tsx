import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { bagRepo, beanRepo } from '../db/repositories';
import { computeBagUsage } from '../services/stats';
import { daysSince } from '../services/recommendation';
import type { RoastLevel } from '../domain/types';
import { EmptyState, Field } from './components';
import { ROAST_LEVELS, formatDate, ratingClass } from './labels';

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
              const roastAge = daysSince(bag.roastDate);
              return (
                <div key={bag.id} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <div className="small">
                    <strong>שקית {bag.weightGrams} גרם</strong>
                    {bag.finished && <span className="badge">נגמרה</span>}
                    {!bag.finished && roastAge !== null && roastAge > 30 && (
                      <span className="badge warn">{roastAge} ימים מקלייה</span>
                    )}
                  </div>
                  <div className="muted small">
                    נקלתה: {formatDate(bag.roastDate)} · נפתחה: {formatDate(bag.openDate)}
                    {bag.price !== null && ` · ₪${bag.price}`}
                  </div>
                  <div className="muted small">
                    {usage.shotsCount} שוטים · נצרכו {usage.gramsUsed.toFixed(0)} גרם · נשארו ~{usage.gramsLeft.toFixed(0)} גרם
                    {usage.costPerShot !== null && ` · ₪${usage.costPerShot.toFixed(1)} לשוט`}
                  </div>
                  {!bag.finished && (
                    <button
                      className="btn small secondary" style={{ marginTop: 6 }}
                      onClick={() => bagRepo.put({ ...bag, finished: true })}
                    >
                      סמן כנגמרה
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
  const [weight, setWeight] = useState('250');
  const [price, setPrice] = useState('');

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
      <div className="field-row">
        <Field label="משקל (גרם)">
          <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="מחיר (₪)">
          <input type="number" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <div className="btn-row">
        <button className="btn small secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn small"
          onClick={async () => {
            await bagRepo.create({
              beanId,
              roastDate: roastDate || null,
              openDate: openDate || null,
              price: price ? parseFloat(price) : null,
              weightGrams: parseInt(weight) || 250,
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
