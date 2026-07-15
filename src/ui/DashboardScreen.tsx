import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { compareBeans, monthlyBreakdown, topShots, ratingTrend } from '../services/stats';
import { computeInsights } from '../services/learning';
import { roastLabel } from '../services/recommendation';
import { shotRatio, type RoastLevel, type Shot } from '../domain/types';
import { BarChart, LineChart, type Point } from './charts';
import { StatTile, EmptyState } from './components';
import { FLAVOR_LABELS, TASTE_LABELS, formatDateTime, ratingClass, shotWeights } from './labels';
import { BeanIcon, CalendarIcon, ChartIcon, FlameIcon, GearIcon, TasteIcon, TrendDownIcon, TrendIcon, TrophyIcon } from './icons';
import type { FlavorNote } from '../domain/types';

type Metric = 'rating' | 'yield' | 'time' | 'grind';

const METRICS: { key: Metric; label: string; unit: string; pick: (s: Shot) => number }[] = [
  { key: 'rating', label: 'דירוג', unit: '', pick: (s) => s.rating },
  { key: 'yield', label: 'Yield (גרם)', unit: 'g', pick: (s) => s.yieldGrams },
  { key: 'time', label: 'זמן חליטה (שניות)', unit: 's', pick: (s) => s.brewTimeSec },
  { key: 'grind', label: 'דרגת טחינה', unit: '', pick: (s) => s.grindSetting },
];

export function DashboardScreen() {
  const data = useLiveQuery(async () => {
    const [shots, beans, grinders] = await Promise.all([
      db.shots.orderBy('createdAt').toArray(), // ישן→חדש לגרפים
      db.beans.toArray(),
      db.grinders.toArray(),
    ]);
    return { shots, beans, grinders };
  });

  const [metric, setMetric] = useState<Metric>('rating');

  if (!data) return null;
  const { shots, beans, grinders } = data;

  if (shots.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<ChartIcon size={40} />} text="ה-Dashboard יתעורר לחיים אחרי השוטים הראשונים" hint="כל שוט שתתעד יוסיף נתונים לגרפים ולתובנות." />
      </div>
    );
  }

  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const roastMap = new Map<string, RoastLevel>(beans.map((b) => [b.id, b.roastLevel]));
  const newestFirst = [...shots].reverse();
  const insights = computeInsights(shots, roastMap);
  const trend = ratingTrend(newestFirst);

  const activeMetric = METRICS.find((m) => m.key === metric)!;
  const last30 = shots.slice(-30);
  const linePoints: Point[] = last30.map((s) => ({
    label: new Date(s.createdAt).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
    value: Math.round(activeMetric.pick(s) * 10) / 10,
  }));

  const beanComparison = compareBeans(beans, shots);
  const monthly = monthlyBreakdown(shots);

  // פילוח לפי מטחנה
  const grinderPoints: Point[] = grinders
    .map((g) => {
      const gShots = shots.filter((s) => s.grinderId === g.id);
      if (gShots.length === 0) return null;
      return {
        label: `${g.name} (${gShots.length})`,
        value: Math.round((gShots.reduce((a, s) => a + s.rating, 0) / gShots.length) * 10) / 10,
      };
    })
    .filter((p): p is Point => p !== null);

  // פילוח לפי קלייה
  const roastPoints: Point[] = insights.roastPreference.map((r) => ({
    label: `${roastLabel(r.roastLevel)} (${r.count})`,
    value: Math.round(r.avgRating * 10) / 10,
  }));

  const best10 = topShots(shots, 10);
  const worst5 = topShots(shots, 5, true).filter((s) => s.rating <= 5);

  // פרופיל תווי טעם (גלגל הטעמים)
  const flavorProfile = (() => {
    const byNote = new Map<FlavorNote, { count: number; ratingSum: number }>();
    for (const s of shots) {
      for (const f of s.flavorNotes ?? []) {
        const e = byNote.get(f) ?? { count: 0, ratingSum: 0 };
        e.count += 1;
        e.ratingSum += s.rating;
        byNote.set(f, e);
      }
    }
    return [...byNote.entries()]
      .map(([note, e]) => ({ note, count: e.count, avgRating: e.ratingSum / e.count }))
      .sort((a, b) => b.avgRating - a.avgRating);
  })();

  return (
    <div>
      <div className="card">
        <h2><ChartIcon size={18} /> מבט על</h2>
        <div className="stat-grid">
          <StatTile value={shots.length} label="שוטים סה״כ" />
          <StatTile value={insights.avgRating.toFixed(1)} label="דירוג ממוצע" />
          <StatTile
            value={insights.sweetSpot.ratio ? `1:${insights.sweetSpot.ratio.toFixed(1)}` : '—'}
            label="היחס המנצח שלי"
          />
          <StatTile
            value={insights.sweetSpot.brewTime ? `${Math.round(insights.sweetSpot.brewTime)}s` : '—'}
            label="הזמן המנצח שלי"
          />
        </div>
        {trend.direction !== 'insufficient' && (
          <p className="muted small" style={{ marginTop: 8, display: 'flex', gap: 7, alignItems: 'center' }}>
            {trend.direction === 'up' && <><TrendIcon size={15} strokeWidth={2} /> <span>מגמה חיובית: {trend.previousAvg.toFixed(1)} ← {trend.recentAvg.toFixed(1)}</span></>}
            {trend.direction === 'down' && <><TrendDownIcon size={15} strokeWidth={2} /> <span>מגמה שלילית: {trend.previousAvg.toFixed(1)} ← {trend.recentAvg.toFixed(1)}</span></>}
            {trend.direction === 'stable' && <span>יציב סביב {trend.recentAvg.toFixed(1)}</span>}
          </p>
        )}
      </div>

      <div className="card">
        <h2><TrendIcon size={18} /> מגמה לאורך זמן (30 שוטים אחרונים)</h2>
        <div className="chips" style={{ marginBottom: 10 }}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={`chip ${metric === m.key ? 'selected' : ''}`}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <LineChart points={linePoints} unit={activeMetric.unit} />
      </div>

      {beanComparison.length > 0 && (
        <div className="card">
          <h2><BeanIcon size={18} /> השוואת פולים (דירוג ממוצע)</h2>
          <BarChart
            points={beanComparison.map((b) => ({
              label: `${b.bean.name} (${b.shots})`,
              value: Math.round(b.avgRating * 10) / 10,
            }))}
            maxValue={10}
          />
        </div>
      )}

      {roastPoints.length > 1 && (
        <div className="card">
          <h2><FlameIcon size={18} /> השוואת קליות (דירוג ממוצע)</h2>
          <BarChart points={roastPoints} maxValue={10} />
        </div>
      )}

      {grinderPoints.length > 1 && (
        <div className="card">
          <h2><GearIcon size={18} /> פילוח לפי מטחנה (דירוג ממוצע)</h2>
          <BarChart points={grinderPoints} maxValue={10} />
        </div>
      )}

      {monthly.length > 1 && (
        <div className="card">
          <h2><CalendarIcon size={18} /> פילוח חודשי (שוטים)</h2>
          <BarChart
            points={monthly.slice(-12).map((m) => ({
              label: `${m.month} (ממוצע ${m.avgRating.toFixed(1)})`,
              value: m.shots,
            }))}
          />
        </div>
      )}

      {(insights.tasteProfile.length > 0 || flavorProfile.length > 0) && (
        <div className="card">
          <h2><TasteIcon size={18} /> פרופיל הטעם שלי</h2>
          <p className="muted small">אילו טעמים מופיעים בשוטים שלך, ומה הדירוג הממוצע כשהם מופיעים:</p>
          {insights.tasteProfile.length > 0 && (
            <table className="data">
              <thead>
                <tr><th>טעם</th><th>הופעות</th><th>דירוג ממוצע</th></tr>
              </thead>
              <tbody>
                {insights.tasteProfile.map((t) => (
                  <tr key={t.tag}>
                    <td>{TASTE_LABELS[t.tag]}</td>
                    <td>{t.count}</td>
                    <td>{t.avgRating.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {flavorProfile.length > 0 && (
            <>
              <h3>גלגל הטעמים — אילו תווים אתה הכי אוהב</h3>
              <table className="data">
                <thead>
                  <tr><th>תו טעם</th><th>הופעות</th><th>דירוג ממוצע</th></tr>
                </thead>
                <tbody>
                  {flavorProfile.map((f) => (
                    <tr key={f.note}>
                      <td>{FLAVOR_LABELS[f.note]}</td>
                      <td>{f.count}</td>
                      <td>{f.avgRating.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2><TrophyIcon size={18} /> Top 10 שוטים</h2>
        {best10.map((s) => <ShotRow key={s.id} shot={s} beanName={beanMap.get(s.beanId)?.name} />)}
      </div>

      {worst5.length > 0 && (
        <div className="card">
          <h2><TrendDownIcon size={18} /> השוטים הפחות מוצלחים</h2>
          <p className="muted small">כדאי להציץ מה השתבש — לרוב יש דפוס חוזר.</p>
          {worst5.map((s) => <ShotRow key={s.id} shot={s} beanName={beanMap.get(s.beanId)?.name} />)}
        </div>
      )}
    </div>
  );
}

function ShotRow({ shot, beanName }: { shot: Shot; beanName?: string }) {
  return (
    <div className="shot-item" style={{ cursor: 'default' }}>
      <div className={`shot-rating ${ratingClass(shot.rating)}`}>{shot.rating}</div>
      <div style={{ flex: 1 }}>
        <div>{beanName ?? 'פולים שנמחקו'}</div>
        <div className="muted small">
          {shotWeights(shot)} · {shot.brewTimeSec} שניות · יחס 1:{shotRatio(shot).toFixed(1)}
        </div>
        <div className="muted small">{formatDateTime(shot.createdAt)}</div>
      </div>
    </div>
  );
}
