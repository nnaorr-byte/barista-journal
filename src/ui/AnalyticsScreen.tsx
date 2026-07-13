import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  shotRatio, shotFlowRate,
  type Bag, type Bean, type DialInSession, type FlavorNote, type Shot,
} from '../domain/types';
import { BarChart, LineChart, ScatterChart, Histogram, type Point, type ScatterPoint } from './charts';
import { StatTile, EmptyState } from './components';
import { computeWinningWindow, shotAgeRatings } from '../services/freshness';
import { FLAVOR_LABELS, formatDateTime, shotWeights } from './labels';
import { BeanIcon, BulbIcon, ChartIcon, CoinIcon, CupIcon, FlameIcon, GearIcon, GiftIcon, LeafIcon, MedalIcon, ScaleIcon, SettingsIcon, StarIcon, TargetIcon, TasteIcon, TimerIcon, TrendIcon, TrophyIcon } from './icons';

// ===== Coffee Shot Analytics =====
// ניתוח ויזואלי של איכות ועקביות ההכנה, מהנתונים הקיימים בלבד.

const GOOD_RATING = 8; // סף "שוט מצוין"

function movingAvg(values: number[], window = 5): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return Math.round((slice.reduce((a, b) => a + b, 0) / window) * 100) / 100;
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// ציון עקביות 0–100: כמה צמודים השוטים זה לזה בזמן חליטה וביחס.
// CV (סטיית תקן יחסית) של 5% ≈ ציון 85, של 20% ≈ ציון 40.
function consistencyScore(shots: Shot[]): number | null {
  const valid = shots.filter((s) => s.brewTimeSec > 0 && s.doseGrams > 0);
  if (valid.length < 4) return null;
  const times = valid.map((s) => s.brewTimeSec);
  const ratios = valid.map((s) => shotRatio(s));
  const cvTime = stddev(times) / mean(times);
  const cvRatio = stddev(ratios) / mean(ratios);
  const score = 100 - ((cvTime + cvRatio) / 2) * 300;
  return Math.max(0, Math.min(100, Math.round(score)));
}

interface Insight {
  icon: string;
  text: string;
}

// ===== מפת חום: טחינה × זמן — "האזור החם" שלך =====
const TIME_BUCKETS = [
  { label: '<22', test: (t: number) => t < 22 },
  { label: '22–25', test: (t: number) => t >= 22 && t < 25 },
  { label: '25–28', test: (t: number) => t >= 25 && t < 28 },
  { label: '28–32', test: (t: number) => t >= 28 && t <= 32 },
  { label: '32+', test: (t: number) => t > 32 },
];

function GrindTimeHeatmap({ shots }: { shots: Shot[] }) {
  const withGrind = shots.filter((s) => s.grindSetting > 0 && s.brewTimeSec > 0);
  if (withGrind.length < 4) return null;

  const grindValues = [...new Set(withGrind.map((s) => s.grindSetting))].sort((a, b) => b - a);
  if (grindValues.length < 2) return null;

  const cells = grindValues.map((g) =>
    TIME_BUCKETS.map((b) => {
      const inCell = withGrind.filter((s) => s.grindSetting === g && b.test(s.brewTimeSec));
      return inCell.length
        ? { avg: mean(inCell.map((s) => s.rating)), count: inCell.length }
        : null;
    }),
  );

  return (
    <div className="card">
      <h2><FlameIcon size={18} /> מפת חום: טחינה × זמן</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        כל תא = דירוג ממוצע. כהה יותר = טעים יותר. חפש את "האזור החם" שלך.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="data" style={{ minWidth: 320 }}>
          <thead>
            <tr>
              <th>טחינה \ זמן</th>
              {TIME_BUCKETS.map((b) => <th key={b.label} style={{ textAlign: 'center' }}>{b.label}s</th>)}
            </tr>
          </thead>
          <tbody>
            {grindValues.map((g, gi) => (
              <tr key={g}>
                <td style={{ fontWeight: 700 }}>{g}</td>
                {cells[gi].map((cell, ci) => (
                  <td key={ci} style={{ textAlign: 'center' }}>
                    {cell ? (
                      <span
                        title={`${cell.count} שוטים`}
                        style={{
                          display: 'inline-block',
                          minWidth: 42,
                          padding: '5px 6px',
                          borderRadius: 8,
                          fontWeight: 700,
                          /* מקסימום 45% — מעבר לזה הטקסט טובע ברקע הענברי */
                          background: `color-mix(in srgb, var(--accent) ${Math.round((cell.avg / 10) * 45)}%, transparent)`,
                        }}
                      >
                        {cell.avg.toFixed(1)}
                        <span style={{ fontWeight: 400, opacity: 0.85 }}> ×{cell.count}</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== היסטוריית סשני כיול =====
function DialInHistory({ sessions, shots, bags, beans }: {
  sessions: DialInSession[];
  shots: Shot[];
  bags: Bag[];
  beans: Bean[];
}) {
  if (sessions.length === 0) return null;
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const statusLabel = (s: DialInSession) =>
    s.status === 'dialed-in' ? { text: '✓ מכויל', cls: 'good' }
    : s.status === 'active' ? { text: 'פעיל', cls: 'accent' }
    : { text: 'ננטש', cls: 'warn' };

  // האם אתה מתכייל מהר יותר? ממוצע שוטים-עד-כיול, ראשונים מול אחרונים
  const dialed = sorted.filter((s) => s.status === 'dialed-in').reverse(); // ישן→חדש
  const shotsToDialed = dialed.map((s) => {
    const sessionShots = shots.filter((x) => x.dialInSessionId === s.id);
    return sessionShots.length;
  });
  let speedInsight: string | null = null;
  if (shotsToDialed.length >= 4) {
    const half = Math.floor(shotsToDialed.length / 2);
    const early = mean(shotsToDialed.slice(0, half));
    const late = mean(shotsToDialed.slice(half));
    if (early - late >= 0.8) {
      speedInsight = `אתה מתכייל מהר יותר: בעבר נדרשו לך בממוצע ${early.toFixed(1)} שוטים לכיול, היום ${late.toFixed(1)}. הניסיון עובד!`;
    }
  }

  return (
    <div className="card">
      <h2><SettingsIcon size={18} /> סשני הכיול שלי</h2>
      {speedInsight && <p className="small" style={{ color: 'var(--good)' }}>📈 {speedInsight}</p>}
      {sorted.slice(0, 8).map((s) => {
        const sessionShots = shots.filter((x) => x.dialInSessionId === s.id);
        const bag = bagMap.get(s.bagId);
        const bean = bag ? beanMap.get(bag.beanId) : null;
        const best = s.bestShotId ? shots.find((x) => x.id === s.bestShotId) : null;
        const st = statusLabel(s);
        return (
          <div key={s.id} className="shot-item" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              <div>
                {bean?.name ?? 'פולים'} <span className={`badge ${st.cls}`}>{st.text}</span>
              </div>
              <div className="muted small">
                {new Date(s.startedAt).toLocaleDateString('he-IL')} · {sessionShots.length} שוטים בסשן
                {best && ` · השוט המנצח: ${best.rating}/10 (טחינה ${best.grindSetting}, ${best.brewTimeSec} שניות)`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== דשבורד עלויות =====
const CAFE_ESPRESSO_PRICE = 12; // ₪ — הנחת מחיר אספרסו ממוצע בבית קפה

function CostDashboard({ shots, bags }: { shots: Shot[]; bags: Bag[] }) {
  const bagMap = new Map(bags.map((b) => [b.id, b]));
  const pricedShots = shots.filter((s) => {
    const bag = bagMap.get(s.bagId);
    return bag && bag.price !== null && bag.weightGrams > 0;
  });
  if (pricedShots.length < 2) return null;

  const shotCost = (s: Shot) => {
    const bag = bagMap.get(s.bagId)!;
    return (bag.price! / bag.weightGrams) * s.doseGrams;
  };
  const totalConsumed = pricedShots.reduce((a, s) => a + shotCost(s), 0);
  const avgCost = totalConsumed / pricedShots.length;
  const totalBagSpend = bags.filter((b) => b.price !== null).reduce((a, b) => a + b.price!, 0);
  const savings = pricedShots.length * CAFE_ESPRESSO_PRICE - totalConsumed;

  // פילוח חודשי
  const byMonth = new Map<string, number>();
  for (const s of pricedShots) {
    const month = s.createdAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + shotCost(s));
  }
  const monthly = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, cost]) => ({ label: month, value: Math.round(cost) }));

  return (
    <div className="card">
      <h2><CoinIcon size={18} /> עלויות הקפה שלי</h2>
      <div className="stat-grid">
        <StatTile value={`₪${avgCost.toFixed(1)}`} label="עלות לשוט" />
        <StatTile value={`₪${Math.round(totalConsumed)}`} label="קפה שנצרך" />
        <StatTile value={`₪${Math.round(totalBagSpend)}`} label="הושקע בפולים" />
        <StatTile value={`₪${Math.round(savings)}`} label="חיסכון מול בית קפה" />
      </div>
      {monthly.length > 1 && (
        <>
          <h3>הוצאה חודשית (₪, לפי צריכה בפועל)</h3>
          <BarChart points={monthly} unit="₪" />
        </>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        החיסכון מחושב מול אספרסו ממוצע בבית קפה (~₪{CAFE_ESPRESSO_PRICE}). מבוסס רק על שוטים משקיות שהוזן להן מחיר.
      </p>
    </div>
  );
}

// ===== Coffee Wrapped — סיכום השנה =====
function CoffeeWrapped({ shots, beans, onBack }: { shots: Shot[]; beans: Bean[]; onBack: () => void }) {
  const year = new Date().getFullYear();
  const yearShots = shots.filter((s) => s.createdAt.startsWith(String(year)));
  const beanMap = new Map(beans.map((b) => [b.id, b]));

  if (yearShots.length === 0) {
    return (
      <div className="card">
        <h2><GiftIcon size={18} /> Coffee Wrapped {year}</h2>
        <EmptyState icon="🎁" text={`עדיין אין שוטים ב-${year}`} hint="ברגע שתתעד — הסיכום יתמלא." />
        <button className="btn block" onClick={onBack}>→ חזרה לניתוח</button>
      </div>
    );
  }

  const totalCoffee = yearShots.reduce((a, s) => a + s.doseGrams, 0);
  const totalEspresso = yearShots.reduce((a, s) => a + s.yieldGrams, 0);
  const distinctBeans = new Set(yearShots.map((s) => s.beanId)).size;
  const avgRating = mean(yearShots.map((s) => s.rating));
  const best = [...yearShots].sort((a, b) => b.rating - a.rating)[0];

  // הפול של השנה: הכי הרבה שוטים
  const byBean = new Map<string, number>();
  for (const s of yearShots) byBean.set(s.beanId, (byBean.get(s.beanId) ?? 0) + 1);
  const topBeanId = [...byBean.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // החודש הפעיל ביותר
  const byMonth = new Map<number, number>();
  for (const s of yearShots) {
    const m = new Date(s.createdAt).getMonth();
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  const topMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const monthName = new Date(year, topMonth[0], 1).toLocaleDateString('he-IL', { month: 'long' });

  // תווי הטעם של השנה
  const byFlavor = new Map<FlavorNote, number>();
  for (const s of yearShots) for (const f of s.flavorNotes ?? []) byFlavor.set(f, (byFlavor.get(f) ?? 0) + 1);
  const topFlavors = [...byFlavor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  // שיפור: מחצית ראשונה מול שנייה
  const half = Math.floor(yearShots.length / 2);
  const firstAvg = half >= 3 ? mean(yearShots.slice(0, half).map((s) => s.rating)) : null;
  const secondAvg = half >= 3 ? mean(yearShots.slice(half).map((s) => s.rating)) : null;

  return (
    <div>
      <div className="card accent">
        <h2><GiftIcon size={18} /> Coffee Wrapped {year}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>השנה שלך באספרסו, במספרים.</p>
        <div className="stat-grid">
          <StatTile value={yearShots.length} label="שוטים השנה" />
          <StatTile value={`${(totalCoffee / 1000).toFixed(2)} ק״ג`} label="קפה נטחן" />
          <StatTile value={`${(totalEspresso / 1000).toFixed(1)} ליטר`} label="אספרסו בכוס" />
          <StatTile value={distinctBeans} label="סוגי פולים" />
          <StatTile value={avgRating.toFixed(1)} label="דירוג ממוצע" />
        </div>
      </div>

      <div className="card">
        <h2><TrophyIcon size={18} /> השוט של השנה</h2>
        <p style={{ margin: '4px 0' }}>
          <strong>{best.rating}/10</strong> · {beanMap.get(best.beanId)?.name ?? 'פולים'} ·{' '}
          {shotWeights(best)} ב-{best.brewTimeSec} שניות
        </p>
        <p className="muted small">{formatDateTime(best.createdAt)}</p>
      </div>

      <div className="card">
        <h2><BeanIcon size={18} /> הפול של השנה</h2>
        <p style={{ margin: '4px 0' }}>
          <strong>{beanMap.get(topBeanId)?.name ?? 'פולים'}</strong>
          {beanMap.get(topBeanId)?.roastery && ` · ${beanMap.get(topBeanId)!.roastery}`}
          {' — '}{byBean.get(topBeanId)} שוטים
        </p>
        <p className="muted small">החודש החזק שלך: {monthName} ({topMonth[1]} שוטים)</p>
      </div>

      {topFlavors.length > 0 && (
        <div className="card">
          <h2><TasteIcon size={18} /> הטעמים של השנה</h2>
          <div className="chips">
            {topFlavors.map(([f, n]) => (
              <span key={f} className="chip selected">{FLAVOR_LABELS[f]} × {n}</span>
            ))}
          </div>
        </div>
      )}

      {firstAvg !== null && secondAvg !== null && (
        <div className="card">
          <h2><TrendIcon size={18} /> המסע שלך</h2>
          <div className="stat-grid">
            <StatTile value={firstAvg.toFixed(1)} label="ממוצע — תחילת השנה" />
            <StatTile value={secondAvg.toFixed(1)} label="ממוצע — ההמשך" />
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            {secondAvg > firstAvg + 0.3
              ? `📈 השתפרת ב-${(secondAvg - firstAvg).toFixed(1)} נקודות במהלך השנה — הכיול והתיעוד עובדים!`
              : secondAvg < firstAvg - 0.3
                ? 'שווה להציץ מה השתנה — אולי הפולים או שגרת התחזוקה.'
                : '➡️ יציבות לאורך השנה — עקביות היא סימן של בריסטה אמיתי.'}
          </p>
        </div>
      )}

      <button className="btn block" onClick={onBack}>→ חזרה לניתוח</button>
    </div>
  );
}

function buildInsights(shots: Shot[]): Insight[] {
  const insights: Insight[] = [];
  const rated = shots.filter((s) => s.brewTimeSec > 0);

  // הטווח המנצח של זמן חליטה
  const timeBuckets: { label: string; test: (t: number) => boolean }[] = [
    { label: 'מתחת ל-22 שניות', test: (t) => t < 22 },
    { label: '22–25 שניות', test: (t) => t >= 22 && t < 25 },
    { label: '25–28 שניות', test: (t) => t >= 25 && t < 28 },
    { label: '28–32 שניות', test: (t) => t >= 28 && t <= 32 },
    { label: 'מעל 32 שניות', test: (t) => t > 32 },
  ];
  const timeStats = timeBuckets
    .map((b) => {
      const inBucket = rated.filter((s) => b.test(s.brewTimeSec));
      return { label: b.label, count: inBucket.length, avg: mean(inBucket.map((s) => s.rating)) };
    })
    .filter((b) => b.count >= 3)
    .sort((a, b) => b.avg - a.avg);
  if (timeStats.length >= 2) {
    insights.push({
      icon: '⏱️',
      text: `הטווח המנצח שלך: שוטים של ${timeStats[0].label} מקבלים דירוג ממוצע ${timeStats[0].avg.toFixed(1)} (${timeStats[0].count} שוטים). זה הטווח לכוון אליו.`,
    });
  }

  // היחס המנצח
  const ratioBuckets: { label: string; test: (r: number) => boolean }[] = [
    { label: 'קצר מ-1:1.8', test: (r) => r < 1.8 },
    { label: '1:1.8–1:2.1', test: (r) => r >= 1.8 && r < 2.1 },
    { label: '1:2.1–1:2.4', test: (r) => r >= 2.1 && r < 2.4 },
    { label: 'ארוך מ-1:2.4', test: (r) => r >= 2.4 },
  ];
  const ratioStats = ratioBuckets
    .map((b) => {
      const inBucket = shots.filter((s) => shotRatio(s) > 0 && b.test(shotRatio(s)));
      return { label: b.label, count: inBucket.length, avg: mean(inBucket.map((s) => s.rating)) };
    })
    .filter((b) => b.count >= 3)
    .sort((a, b) => b.avg - a.avg);
  if (ratioStats.length >= 2) {
    insights.push({
      icon: '⚖️',
      text: `יחס החליטה שעובד לך: ${ratioStats[0].label} עם ממוצע ${ratioStats[0].avg.toFixed(1)} (${ratioStats[0].count} שוטים).`,
    });
  }

  // בוקר מול אחר הצהריים
  const morning = shots.filter((s) => new Date(s.createdAt).getHours() < 12);
  const afternoon = shots.filter((s) => new Date(s.createdAt).getHours() >= 12);
  if (morning.length >= 3 && afternoon.length >= 3) {
    const mAvg = mean(morning.map((s) => s.rating));
    const aAvg = mean(afternoon.map((s) => s.rating));
    const diff = Math.abs(mAvg - aAvg);
    if (diff >= 0.5) {
      insights.push({
        icon: mAvg > aAvg ? '🌅' : '🌇',
        text: mAvg > aAvg
          ? `שוטי הבוקר שלך טובים יותר: ממוצע ${mAvg.toFixed(1)} מול ${aAvg.toFixed(1)} אחר הצהריים. ייתכן שקשור לשגרת החימום של המכונה.`
          : `דווקא אחר הצהריים אתה מצטיין: ממוצע ${aAvg.toFixed(1)} מול ${mAvg.toFixed(1)} בבוקר.`,
      });
    }
  }

  // אחוז הצלחה מצטבר
  const excellent = shots.filter((s) => s.rating >= GOOD_RATING).length;
  if (shots.length >= 5) {
    const pct = Math.round((excellent / shots.length) * 100);
    insights.push({
      icon: '🎯',
      text: `${pct}% מהשוטים שלך מצוינים (דירוג ${GOOD_RATING}+). ${pct >= 50 ? 'רמה של בריסטה רציני!' : 'עם כל סשן כיול המספר הזה יטפס.'}`,
    });
  }

  // עקביות: 10 אחרונים מול 10 קודמים
  const newest = [...shots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (newest.length >= 14) {
    const recent = consistencyScore(newest.slice(0, 10));
    const previous = consistencyScore(newest.slice(10, 20));
    if (recent !== null && previous !== null && Math.abs(recent - previous) >= 5) {
      insights.push({
        icon: recent > previous ? '📈' : '📉',
        text: recent > previous
          ? `העקביות שלך משתפרת: ציון ${recent} ב-10 השוטים האחרונים לעומת ${previous} בעשרה שלפניהם.`
          : `העקביות ירדה מ-${previous} ל-${recent}. בדוק אם משהו השתנה — פולים מתיישנים? טחינה לא אחידה?`,
      });
    }
  }

  return insights;
}

// ===== עקומת הטריות: דירוג מול גיל קלייה =====
// כל שוט ממופה לגיל הפולים ביום ההכנה (לפי תאריך הקלייה של השקית).
// חישוב הנקודות והחלון המנצח חי ב-services/freshness.ts — משותף עם מסך הבית.
function FreshnessCurve({ shots, bags }: { shots: Shot[]; bags: Bag[] }) {
  const points: ScatterPoint[] = shotAgeRatings(shots, bags).map((p) => ({
    x: p.age,
    y: p.rating,
    highlight: p.rating >= GOOD_RATING,
    label: `יום ${p.age} מהקלייה: דירוג ${p.rating}`,
  }));
  if (points.length < 3) return null;

  const winning = computeWinningWindow(shots, bags);

  return (
    <div className="card">
      <h2><LeafIcon size={18} /> עקומת הטריות — דירוג מול גיל קלייה</h2>
      <ScatterChart points={points} xLabel="ימים מהקלייה" yLabel="דירוג" />
      <p className="muted small">
        ● מלא = שוט מצוין ({GOOD_RATING}+) · ○ מתאר = שאר השוטים. איפה שהמלאים מתקבצים — שם הפולים שלך בשיא.
      </p>
      {winning && (
        <p className="small" style={{ color: 'var(--crema)' }}>
          חלון הטריות המנצח שלך: ימים {winning.label} מהקלייה — ממוצע {winning.avg.toFixed(1)} ({winning.count} שוטים).
        </p>
      )}
    </div>
  );
}

export function AnalyticsScreen() {
  const data = useLiveQuery(async () => {
    const [shots, grinders, beans, bags, sessions] = await Promise.all([
      db.shots.orderBy('createdAt').toArray(), // ישן→חדש
      db.grinders.toArray(),
      db.beans.toArray(),
      db.bags.toArray(),
      db.dialInSessions.toArray(),
    ]);
    return { shots, grinders, beans, bags, sessions };
  });
  const [wrapped, setWrapped] = useState(false);

  if (!data) return null;
  const { shots, grinders, beans, bags, sessions } = data;

  if (wrapped) {
    return <CoffeeWrapped shots={shots} beans={beans} onBack={() => setWrapped(false)} />;
  }

  if (shots.length < 2) {
    return (
      <div className="card">
        <h2><TrendIcon size={18} /> Coffee Shot Analytics</h2>
        <EmptyState
          icon="📈"
          text="הניתוח מתעורר אחרי 2 שוטים לפחות"
          hint="ככל שתתעד יותר, התמונה תהיה חדה יותר — מגמות, עקביות ותובנות אישיות."
        />
      </div>
    );
  }

  const valid = shots.filter((s) => s.brewTimeSec > 0 && s.doseGrams > 0);
  const last30 = shots.slice(-30);
  const dateLabel = (s: Shot) =>
    new Date(s.createdAt).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });

  // KPI
  const avgRating = mean(shots.map((s) => s.rating));
  const avgTime = mean(valid.map((s) => s.brewTimeSec));
  const avgRatio = mean(valid.map((s) => shotRatio(s)));
  const avgDose = mean(valid.map((s) => s.doseGrams));
  const avgYield = mean(valid.map((s) => s.yieldGrams));
  const avgFlow = mean(valid.filter((s) => s.brewTimeSec > 0).map((s) => shotFlowRate(s)));

  // סדרות
  const ratingPoints: Point[] = last30.map((s) => ({ label: dateLabel(s), value: s.rating }));
  const ratingMA = movingAvg(last30.map((s) => s.rating), 5);
  const timePoints: Point[] = last30.filter((s) => s.brewTimeSec > 0).map((s) => ({ label: dateLabel(s), value: s.brewTimeSec }));
  const ratioPoints: Point[] = last30
    .filter((s) => shotRatio(s) > 0)
    .map((s) => ({ label: dateLabel(s), value: Math.round(shotRatio(s) * 100) / 100 }));

  // טחינה — לפי המטחנה עם הכי הרבה שוטים
  const grinderCounts = new Map<string, number>();
  for (const s of shots) grinderCounts.set(s.grinderId, (grinderCounts.get(s.grinderId) ?? 0) + 1);
  const topGrinderId = [...grinderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topGrinder = grinders.find((g) => g.id === topGrinderId);
  const grindPoints: Point[] = shots
    .filter((s) => s.grinderId === topGrinderId && s.grindSetting > 0)
    .slice(-30)
    .map((s) => ({ label: dateLabel(s), value: s.grindSetting }));

  // פיזור Dose-Yield
  const scatterPoints = valid.slice(-60).map((s) => ({
    x: s.doseGrams,
    y: s.yieldGrams,
    highlight: s.rating >= GOOD_RATING,
    label: `${s.doseGrams}g ← ${s.yieldGrams}g · ${s.brewTimeSec}s · דירוג ${s.rating}`,
  }));

  // התפלגות הצלחה
  const excellent = shots.filter((s) => s.rating >= 8).length;
  const good = shots.filter((s) => s.rating >= 6 && s.rating < 8).length;
  const weak = shots.filter((s) => s.rating < 6).length;
  const distTotal = shots.length;
  const pct = (n: number) => Math.round((n / distTotal) * 100);

  // היסטוגרמת דירוגים
  const histBins: Point[] = Array.from({ length: 10 }, (_, i) => ({
    label: String(i + 1),
    value: shots.filter((s) => s.rating === i + 1).length,
  }));

  // עקביות
  const newest = [...shots].reverse();
  const consistency = consistencyScore(newest.slice(0, 10));
  const prevConsistency = newest.length >= 14 ? consistencyScore(newest.slice(10, 20)) : null;

  const insights = buildInsights(shots);

  return (
    <div>
      <div className="card accent">
        <h2><TrendIcon size={18} /> Coffee Shot Analytics</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          ניתוח {shots.length} השוטים שלך — איכות, עקביות ומגמות.
        </p>
        <button className="btn secondary block" style={{ marginBottom: 12 }} onClick={() => setWrapped(true)}>
          <GiftIcon size={16} /> Coffee Wrapped — סיכום השנה שלי
        </button>
        <div className="stat-grid">
          <StatTile value={avgRating.toFixed(1)} label="דירוג ממוצע" />
          <StatTile value={`${Math.round(avgTime)}s`} label="זמן ממוצע" />
          <StatTile value={`1:${avgRatio.toFixed(1)}`} label="יחס ממוצע" />
          <StatTile value={`${avgDose.toFixed(1)}g`} label="מנה ממוצעת" />
          <StatTile value={`${avgYield.toFixed(1)}g`} label="Yield ממוצע" />
          <StatTile value={avgFlow.toFixed(1)} label="זרימה (גרם/שנ')" />
        </div>
      </div>

      {/* עקביות */}
      {consistency !== null && (
        <div className="card">
          <h2><TargetIcon size={18} /> מדד העקביות שלי</h2>
          <div className="stat-grid">
            <StatTile value={consistency} label="ציון עקביות (10 אחרונים)" />
            {prevConsistency !== null && <StatTile value={prevConsistency} label="10 הקודמים" />}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            המדד בודק כמה השוטים שלך צמודים זה לזה בזמן החליטה וביחס (0–100).
            בריסטה עקבי מייצר את אותו שוט כל בוקר — לא רק שוט טוב אחד במקרה.
            {consistency >= 75 && ' ציון מעולה — יש לך יד יציבה!'}
            {consistency < 50 && ' יש מקום לשיפור — נסה להקפיד על WDT וטמפינג אחידים.'}
          </p>
        </div>
      )}

      {/* דירוג לאורך זמן */}
      <div className="card">
        <h2><StarIcon size={18} /> דירוג לאורך זמן</h2>
        <LineChart points={ratingPoints} overlay={ratingMA} overlayLabel="ממוצע נע (5 שוטים)" />
        <p className="muted small">הקו המקווקו הוא הממוצע הנע — הוא מראה את המגמה האמיתית בלי רעש של שוט בודד.</p>
      </div>

      {/* זמן חליטה */}
      {timePoints.length >= 2 && (
        <div className="card">
          <h2><TimerIcon size={18} /> זמן חליטה לאורך זמן</h2>
          <LineChart points={timePoints} unit="s" band={{ from: 25, to: 32, label: 'טווח יעד 25–32' }} />
          <p className="muted small">הרצועה המודגשת היא טווח היעד הקלאסי לאספרסו. שוטים מחוץ לה — סימן לכיול נדרש.</p>
        </div>
      )}

      {/* יחס חליטה */}
      {ratioPoints.length >= 2 && (
        <div className="card">
          <h2><ScaleIcon size={18} /> יחס חליטה (Brew Ratio) לאורך זמן</h2>
          <LineChart points={ratioPoints} band={{ from: 1.8, to: 2.4, label: 'טווח קלאסי 1:1.8–1:2.4' }} />
        </div>
      )}

      {/* דרגת טחינה */}
      {grindPoints.length >= 2 && topGrinder && (
        <div className="card">
          <h2><GearIcon size={18} /> דרגת טחינה לאורך זמן — {topGrinder.name}</h2>
          <LineChart points={grindPoints} />
          <p className="muted small">מסע הכיול שלך: שינויי הטחינה מספרים איך התאמת את עצמך לפולים ולטריות שלהם.</p>
        </div>
      )}

      {/* Dose מול Yield */}
      {scatterPoints.length >= 2 && (
        <div className="card">
          <h2><CupIcon size={18} /> מנה (Dose) מול תוצאה (Yield)</h2>
          <ScatterChart points={scatterPoints} xLabel="גרם נכנס (Dose)" yLabel="גרם יוצא (Yield)" />
          <p className="muted small">
            ● עיגול מלא = שוט מצוין (דירוג {GOOD_RATING}+) · ○ מתאר = שאר השוטים.
            איפה שהעיגולים המלאים מתקבצים — שם "האזור המנצח" שלך.
          </p>
        </div>
      )}

      {/* מפת חום: טחינה × זמן */}
      <GrindTimeHeatmap shots={valid} />

      {/* עקומת הטריות: דירוג מול גיל קלייה */}
      <FreshnessCurve shots={shots} bags={bags} />

      {/* היסטוריית סשני כיול */}
      <DialInHistory sessions={sessions} shots={shots} bags={bags} beans={beans} />

      {/* עלויות */}
      <CostDashboard shots={shots} bags={bags} />

      {/* התפלגות הצלחה */}
      <div className="card">
        <h2><MedalIcon size={18} /> התפלגות הצלחה</h2>
        <div className="dist-bar">
          {excellent > 0 && (
            <div className="dist-seg" style={{ flex: excellent, background: 'var(--good)' }}>
              {pct(excellent) >= 12 ? `${pct(excellent)}%` : ''}
            </div>
          )}
          {good > 0 && (
            <div className="dist-seg" style={{ flex: good, background: 'var(--warn)' }}>
              {pct(good) >= 12 ? `${pct(good)}%` : ''}
            </div>
          )}
          {weak > 0 && (
            <div className="dist-seg" style={{ flex: weak, background: 'var(--bad)' }}>
              {pct(weak) >= 12 ? `${pct(weak)}%` : ''}
            </div>
          )}
        </div>
        <div className="dist-legend">
          <span><span className="dist-dot" style={{ background: 'var(--good)' }} />מצוינים 8–10 ({excellent})</span>
          <span><span className="dist-dot" style={{ background: 'var(--warn)' }} />טובים 6–7 ({good})</span>
          <span><span className="dist-dot" style={{ background: 'var(--bad)' }} />חלשים 1–5 ({weak})</span>
        </div>
      </div>

      {/* היסטוגרמת דירוגים */}
      <div className="card">
        <h2><ChartIcon size={18} /> התפלגות הדירוגים</h2>
        <Histogram bins={histBins} />
      </div>

      {/* תובנות */}
      {insights.length > 0 && (
        <div className="card accent">
          <h2><BulbIcon size={18} /> תובנות אישיות</h2>
          {insights.map((ins, i) => (
            <div key={i} className="insight-item">
              <span className="insight-icon">{ins.icon}</span>
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
