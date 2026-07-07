import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { bagRepo, dialInRepo, shotRepo } from '../db/repositories';
import { recommendShot, confidenceLabel } from '../services/recommendation';
import { analyzeShot } from '../services/dialInCoach';
import type {
  Bag, CoachAdvice, MachineTempSetting, QualityLevel, Shot, ShotRecommendation, TasteTag,
} from '../domain/types';
import { Chips, Field, RatingPicker, StatTile } from './components';
import { QUALITY_LABELS, TASTE_LABELS, TEMP_LABELS } from './labels';
import type { Screen } from '../App';

type Step = 'setup' | 'brew' | 'results' | 'coach';

const TASTE_OPTIONS = (Object.entries(TASTE_LABELS) as [TasteTag, string][]).map(
  ([value, label]) => ({ value, label }),
);
const QUALITY_OPTIONS = (Object.entries(QUALITY_LABELS) as [QualityLevel, string][]).map(
  ([value, label]) => ({ value, label }),
);

export function NewShotScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const data = useLiveQuery(async () => {
    const [user, beans, bags, shots, machines, grinders] = await Promise.all([
      db.users.toArray().then((u) => u[0]),
      db.beans.filter((b) => !b.archived).toArray(),
      db.bags.filter((b) => !b.finished).toArray(),
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.machines.toArray(),
      db.grinders.toArray(),
    ]);
    return { user, beans, bags, shots, machines, grinders };
  });

  const [step, setStep] = useState<Step>('setup');
  const [beanId, setBeanId] = useState('');
  const [bagId, setBagId] = useState('');
  const [grinderId, setGrinderId] = useState('');
  const [dose, setDose] = useState('16');
  const [recommendation, setRecommendation] = useState<ShotRecommendation | null>(null);

  // תוצאות
  const [yieldGrams, setYieldGrams] = useState('');
  const [brewTime, setBrewTime] = useState('');
  const [grindSetting, setGrindSetting] = useState('');
  const [temp, setTemp] = useState<MachineTempSetting>('medium');
  const [basketType, setBasketType] = useState('סטנדרטית');
  const [portafilterType, setPortafilterType] = useState('Bottomless');
  const [tasteTags, setTasteTags] = useState<TasteTag[]>([]);
  const [tasteOther, setTasteOther] = useState('');
  const [body, setBody] = useState<QualityLevel | null>(null);
  const [crema, setCrema] = useState<QualityLevel | null>(null);
  const [aftertaste, setAftertaste] = useState<QualityLevel | null>(null);
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(0);

  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const [multiVarWarning, setMultiVarWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!data) return null;
  const { user, beans, bags, shots, machines, grinders } = data;
  const machine = machines.find((m) => m.isDefault) ?? machines[0];

  const beanBags = bags.filter((b) => b.beanId === beanId);
  const selectedBean = beans.find((b) => b.id === beanId);
  const selectedBag = bags.find((b) => b.id === bagId);
  const selectedGrinder = grinders.find((g) => g.id === grinderId);
  const lastShot = shots[0];

  function applyLastShot() {
    if (!lastShot) return;
    setBeanId(lastShot.beanId);
    setBagId(lastShot.bagId);
    setGrinderId(lastShot.grinderId);
    setDose(String(lastShot.doseGrams));
    setGrindSetting(String(lastShot.grindSetting));
    setTemp(lastShot.machineTemp);
    setBasketType(lastShot.basketType);
    setPortafilterType(lastShot.portafilterType);
  }

  function computeRecommendation() {
    if (!selectedBean || !selectedBag || !user) return;
    const gId = grinderId || (grinders.find((g) => g.isDefault) ?? grinders[0])?.id;
    const rec = recommendShot({
      user,
      bean: selectedBean,
      bag: selectedBag,
      beanShots: shots.filter((s) => s.beanId === selectedBean.id),
      grinderShots: shots.filter((s) => s.beanId === selectedBean.id && s.grinderId === gId),
      doseGrams: parseFloat(dose) || user.defaultDoseGrams,
    });
    setRecommendation(rec);
    if (rec.grindSetting !== null && grindSetting === '') {
      setGrindSetting(String(rec.grindSetting));
    }
    if (yieldGrams === '') setYieldGrams(String(rec.yieldGrams));
    setStep('brew');
  }

  async function saveShot() {
    if (!selectedBean || !selectedBag || !user || saving) return;
    setSaving(true);
    try {
      const gId = grinderId || (grinders.find((g) => g.isDefault) ?? grinders[0]).id;

      // Dial-In Session: שקית חדשה בלי שוטים פותחת סשן כיול אוטומטית
      const bagShots = shots.filter((s) => s.bagId === selectedBag.id);
      let session = await dialInRepo.activeForBag(selectedBag.id);
      if (!session && bagShots.length === 0) {
        session = await dialInRepo.start(user.id, selectedBag.id);
      }

      const shot = await shotRepo.create({
        userId: user.id,
        machineId: machine.id,
        grinderId: gId,
        beanId: selectedBean.id,
        bagId: selectedBag.id,
        dialInSessionId: session?.id ?? null,
        doseGrams: parseFloat(dose) || 0,
        yieldGrams: parseFloat(yieldGrams) || 0,
        brewTimeSec: parseInt(brewTime) || 0,
        grindSetting: parseFloat(grindSetting) || 0,
        machineTemp: temp,
        basketType,
        portafilterType,
        tasteTags,
        tasteOther: tasteTags.includes('other') ? tasteOther : '',
        body,
        crema,
        aftertaste,
        notes,
        rating,
      });

      // בדיקת "משתנה אחד בלבד" מול השוט הקודם באותו סשן
      setMultiVarWarning(session ? await checkOneVariable(shot, session.id) : null);

      // סשן כיול מסתיים כשמגיעים לשוט מאוזן בדירוג 8+
      if (session && rating >= 8 && (tasteTags.includes('balanced') || tasteTags.includes('sweet'))) {
        await dialInRepo.put({
          ...session,
          status: 'dialed-in',
          completedAt: new Date().toISOString(),
          bestShotId: shot.id,
        });
      }

      setAdvice(analyzeShot(shot));
      setStep('coach');
    } finally {
      setSaving(false);
    }
  }

  // --- שלב 1: הגדרה ---
  if (step === 'setup') {
    return (
      <div>
        <div className="card">
          <h2>☕ שוט חדש — שלב 1: לפני החליטה</h2>

          {lastShot && (
            <button className="btn secondary block" style={{ marginBottom: 12 }} onClick={applyLastShot}>
              ⚡ כמו השוט הקודם (שכפול הגדרות)
            </button>
          )}

          <Field label="סוג פולים">
            <select value={beanId} onChange={(e) => { setBeanId(e.target.value); setBagId(''); }}>
              <option value="">בחר פולים…</option>
              {beans.map((b) => (
                <option key={b.id} value={b.id}>{b.name} — {b.roastery}</option>
              ))}
            </select>
          </Field>

          {beans.length === 0 && (
            <p className="muted small">
              אין פולים במערכת. <button className="btn small" onClick={() => navigate('beans')}>הוסף פולים</button>
            </p>
          )}

          {beanId && (
            <Field label="שקית (לצורך מעקב טריות ומלאי)">
              <select value={bagId} onChange={(e) => setBagId(e.target.value)}>
                <option value="">בחר שקית…</option>
                {beanBags.map((b) => (
                  <option key={b.id} value={b.id}>
                    נקלה: {b.roastDate ? new Date(b.roastDate).toLocaleDateString('he-IL') : 'לא ידוע'} · נפתחה:{' '}
                    {b.openDate ? new Date(b.openDate).toLocaleDateString('he-IL') : 'לא ידוע'} · {b.weightGrams} גרם
                  </option>
                ))}
              </select>
            </Field>
          )}

          {beanId && beanBags.length === 0 && (
            <QuickBagForm beanId={beanId} onCreated={(bag) => setBagId(bag.id)} />
          )}

          <div className="field-row">
            <Field label="גרם קפה נכנס">
              <input
                type="number" step="0.1" min="5" max="25" inputMode="decimal"
                value={dose} onChange={(e) => setDose(e.target.value)}
              />
            </Field>
            <Field label="מטחנה">
              <select
                value={grinderId || (grinders.find((g) => g.isDefault) ?? grinders[0])?.id || ''}
                onChange={(e) => setGrinderId(e.target.value)}
              >
                {grinders.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <button
            className="btn block"
            disabled={!beanId || !bagId || !dose}
            onClick={computeRecommendation}
          >
            הצג המלצה והתחל חליטה ←
          </button>
        </div>
      </div>
    );
  }

  // --- שלב 2: חליטה + טיימר ---
  if (step === 'brew' && recommendation) {
    return (
      <BrewStep
        recommendation={recommendation}
        beanName={selectedBean?.name ?? ''}
        onDone={(seconds) => {
          if (seconds > 0) setBrewTime(String(seconds));
          setStep('results');
        }}
        onBack={() => setStep('setup')}
      />
    );
  }

  // --- שלב 3: תוצאות ---
  if (step === 'results') {
    return (
      <div>
        <div className="card">
          <h2>📋 שלב 3: תוצאות השוט</h2>

          <div className="field-row thirds">
            <Field label="גרם נכנס">
              <input type="number" step="0.1" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
            </Field>
            <Field label="גרם יצא">
              <input type="number" step="0.1" inputMode="decimal" value={yieldGrams} onChange={(e) => setYieldGrams(e.target.value)} />
            </Field>
            <Field label="זמן (שניות)">
              <input type="number" inputMode="numeric" value={brewTime} onChange={(e) => setBrewTime(e.target.value)} />
            </Field>
          </div>

          {dose && yieldGrams && (
            <p className="muted small">
              יחס חליטה: 1:{(parseFloat(yieldGrams) / parseFloat(dose)).toFixed(1)}
              {brewTime && parseInt(brewTime) > 0 &&
                ` · זרימה: ${(parseFloat(yieldGrams) / parseInt(brewTime)).toFixed(1)} גרם/שנייה`}
            </p>
          )}

          <div className="field-row">
            <Field label={`דרגת טחינה (${selectedGrinder?.name ?? 'מטחנה'})`}>
              <input type="number" step="0.5" inputMode="decimal" value={grindSetting} onChange={(e) => setGrindSetting(e.target.value)} />
            </Field>
            <Field label="טמפרטורת מכונה">
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
                <option value="סטנדרטית">סטנדרטית</option>
                <option value="Pressurized">Pressurized (מקורית)</option>
                <option value="IMS/מקצועית">IMS / מקצועית</option>
              </select>
            </Field>
            <Field label="פורטפילטר">
              <select value={portafilterType} onChange={(e) => setPortafilterType(e.target.value)}>
                {(machine?.portafilterTypes ?? ['Bottomless']).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>

          <h3>טעם (אפשר לבחור כמה)</h3>
          <Chips
            options={TASTE_OPTIONS}
            selected={tasteTags}
            onToggle={(t) =>
              setTasteTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
            }
          />
          {tasteTags.includes('other') && (
            <div style={{ marginTop: 8 }}>
              <input placeholder="תאר את הטעם…" value={tasteOther} onChange={(e) => setTasteOther(e.target.value)} />
            </div>
          )}

          <h3>Body</h3>
          <Chips options={QUALITY_OPTIONS} selected={body ? [body] : []} onToggle={(v) => setBody(body === v ? null : v)} />
          <h3>Crema</h3>
          <Chips options={QUALITY_OPTIONS} selected={crema ? [crema] : []} onToggle={(v) => setCrema(crema === v ? null : v)} />
          <h3>Aftertaste</h3>
          <Chips options={QUALITY_OPTIONS} selected={aftertaste ? [aftertaste] : []} onToggle={(v) => setAftertaste(aftertaste === v ? null : v)} />

          <h3>הערות חופשיות</h3>
          <textarea
            placeholder="ריח, מראה הזרימה מה-Bottomless, הרגשה כללית…"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />

          <h3>דירוג אישי (1–10)</h3>
          <RatingPicker value={rating} onChange={setRating} />

          <div className="btn-row">
            <button className="btn secondary" onClick={() => setStep('brew')}>→ חזרה</button>
            <button
              className="btn" style={{ flex: 1 }}
              disabled={!dose || !yieldGrams || !brewTime || rating === 0 || saving}
              onClick={saveShot}
            >
              💾 שמור וקבל ניתוח AI Coach
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- שלב 4: AI Coach ---
  if (step === 'coach' && advice) {
    return (
      <div>
        <div className="card accent">
          <h2>🤖 AI Coach — ניתוח השוט</h2>
          <div className={`coach-verdict ${advice.verdict}`}>{advice.verdictLabel}</div>

          {multiVarWarning && (
            <div className="one-var-banner" style={{ borderColor: 'var(--bad)', marginBottom: 10 }}>
              ⚠️ {multiVarWarning}
            </div>
          )}

          <div className="coach-section">
            <div className="coach-label">האבחנה</div>
            <p style={{ margin: '4px 0' }}>{advice.explanation}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">המשתנה לשינוי: {advice.changeVariable}</div>
            <p style={{ margin: '4px 0' }}>{advice.changeInstruction}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">למה דווקא זה?</div>
            <p style={{ margin: '4px 0' }}>{advice.whyThisVariable}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">לא לגעת כרגע</div>
            <p style={{ margin: '4px 0' }}>{advice.doNotChange.join(' · ')}</p>
          </div>
          <div className="coach-section">
            <div className="coach-label">הניסיון הבא</div>
            <p style={{ margin: '4px 0' }}>{advice.nextShotPreview}</p>
          </div>
          <div className="one-var-banner">💡 {advice.oneVariableReminder}</div>

          <div className="btn-row">
            <button className="btn" style={{ flex: 1 }} onClick={() => navigate('home')}>סיום — למסך הבית</button>
            <button
              className="btn secondary"
              onClick={() => {
                // שוט נוסף עם אותם פולים — איפוס תוצאות בלבד
                setYieldGrams(''); setBrewTime(''); setTasteTags([]); setTasteOther('');
                setBody(null); setCrema(null); setAftertaste(null); setNotes(''); setRating(0);
                setAdvice(null); setMultiVarWarning(null);
                computeRecommendation();
              }}
            >
              ☕ שוט נוסף
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

async function checkOneVariable(shot: Shot, sessionId: string): Promise<string | null> {
  const sessionShots = await shotRepo.forSession(sessionId);
  const idx = sessionShots.findIndex((s) => s.id === shot.id);
  const prev = idx > 0 ? sessionShots[idx - 1] : null;
  if (!prev) return null;

  const changes: string[] = [];
  if (Math.abs(shot.grindSetting - prev.grindSetting) > 0.01) changes.push('דרגת טחינה');
  if (Math.abs(shot.doseGrams - prev.doseGrams) > 0.3) changes.push('מנת קפה');
  if (Math.abs(shot.yieldGrams - prev.yieldGrams) > 3) changes.push('Yield');
  if (shot.machineTemp !== prev.machineTemp) changes.push('טמפרטורה');
  if (shot.basketType !== prev.basketType) changes.push('סלסלה');

  if (changes.length > 1) {
    return `שינית ${changes.length} משתנים בבת אחת (${changes.join(', ')}). בסשן כיול קשה לדעת מה השפיע — בשוט הבא שנה משתנה אחד בלבד.`;
  }
  return null;
}

function BrewStep({
  recommendation, beanName, onDone, onBack,
}: {
  recommendation: ShotRecommendation;
  beanName: string;
  onDone: (seconds: number) => void;
  onBack: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => clearInterval(iv);
  }, [running]);

  return (
    <div>
      <div className="card accent">
        <h2>🎯 שלב 2: ההמלצה עבור {beanName}</h2>
        <div className="stat-grid">
          <StatTile value={recommendation.doseGrams} label="גרם נכנס" />
          <StatTile value={recommendation.yieldGrams} label="יעד גרם יוצא" />
          <StatTile value={`${recommendation.brewTimeSecMin}–${recommendation.brewTimeSecMax}`} label="יעד שניות" />
          <StatTile value={`1:${recommendation.ratio}`} label="יחס" />
          {recommendation.grindSetting !== null && <StatTile value={recommendation.grindSetting} label="טחינה" />}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {confidenceLabel(recommendation.confidence, recommendation.basedOnShots)}
        </p>
        {recommendation.reasons.map((r, i) => (
          <p key={i} className="muted small" style={{ margin: '4px 0' }}>• {r}</p>
        ))}
        {recommendation.beanNotes.length > 0 && (
          <>
            <h3>📝 הערות על הפולים</h3>
            {recommendation.beanNotes.map((n, i) => (
              <p key={i} className="small" style={{ margin: '4px 0', color: 'var(--crema)' }}>• {n}</p>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>⏱️ טיימר חליטה</h2>
        <div className={`timer-display ${running ? 'running' : ''}`}>
          {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
        </div>
        <div className="btn-row">
          {!running ? (
            <button
              className="btn" style={{ flex: 1 }}
              onClick={() => { startRef.current = Date.now(); setElapsed(0); setRunning(true); }}
            >
              ▶ התחל טיימר
            </button>
          ) : (
            <button className="btn danger" style={{ flex: 1 }} onClick={() => setRunning(false)}>
              ⏹ עצור ({elapsed} שניות)
            </button>
          )}
        </div>
        <div className="btn-row">
          <button className="btn secondary" onClick={onBack}>→ חזרה</button>
          <button className="btn" style={{ flex: 1 }} onClick={() => onDone(elapsed)}>
            השוט מוכן — לתוצאות ←
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          אפשר לדלג על הטיימר ולהזין את הזמן ידנית במסך הבא.
        </p>
      </div>
    </div>
  );
}

function QuickBagForm({ beanId, onCreated }: { beanId: string; onCreated: (bag: Bag) => void }) {
  const [roastDate, setRoastDate] = useState('');
  const [openDate, setOpenDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState('250');
  const [price, setPrice] = useState('');

  return (
    <div className="card" style={{ background: 'var(--bg-elevated)' }}>
      <h3 style={{ marginTop: 0 }}>שקית חדשה לפולים האלה</h3>
      <div className="field-row">
        <Field label="תאריך קלייה (אם ידוע)">
          <input type="date" value={roastDate} onChange={(e) => setRoastDate(e.target.value)} />
        </Field>
        <Field label="תאריך פתיחת השקית">
          <input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="משקל השקית (גרם)">
          <input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="מחיר (₪, לא חובה)">
          <input type="number" step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <button
        className="btn small"
        onClick={async () => {
          const bag = await bagRepo.create({
            beanId,
            roastDate: roastDate || null,
            openDate: openDate || null,
            price: price ? parseFloat(price) : null,
            weightGrams: parseInt(weight) || 250,
          });
          onCreated(bag);
        }}
      >
        ➕ צור שקית
      </button>
    </div>
  );
}
