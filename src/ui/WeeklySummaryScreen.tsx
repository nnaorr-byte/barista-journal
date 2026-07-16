import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { weeklySummary, weeksBackWithData } from '../services/stats';
import { shotRatio } from '../domain/types';
import { StatTile } from './components';
import { formatDateTime, ratingClass, shotWeights } from './labels';
import { BulbIcon, ChartIcon, TrendIcon, TrophyIcon } from './icons';

// ===== סיכום שבועי =====
// המוטיב: טבעת הטיימר החתומה של האפליקציה בתפקיד חדש — מד הממוצע השבועי.
// נבחר בפרוטוטייפ (וריאציה C): כניסה מבאנר שקט במסך הבית.

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const FULL_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const RING_R = 62;
const RING_C = 2 * Math.PI * RING_R;

function weekLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  const last = new Date(end.getTime() - 86400000);
  const sameMonth = start.getMonth() === last.getMonth();
  const from = sameMonth
    ? String(start.getDate())
    : start.toLocaleDateString('he-IL', opts);
  return `${from}–${last.toLocaleDateString('he-IL', opts)}`;
}

export function WeeklySummaryScreen() {
  const data = useLiveQuery(async () => {
    const [shots, beans] = await Promise.all([
      db.shots.orderBy('createdAt').toArray(),
      db.beans.toArray(),
    ]);
    return { shots, beans };
  });
  const [offset, setOffset] = useState(0);

  if (!data) return null;
  const { shots, beans } = data;
  const beanMap = new Map(beans.map((b) => [b.id, b]));

  const maxBack = weeksBackWithData(shots);
  const wk = weeklySummary(shots, offset);
  const diff = wk.avgRating !== null && wk.prevAvg !== null
    ? Math.round((wk.avgRating - wk.prevAvg) * 10) / 10
    : null;
  const maxDay = Math.max(...wk.days, 1);

  // תובנה: היום החזק של השבוע (דירוג ממוצע גבוה ביותר, לפחות שוט מדורג אחד)
  let insight: string | null = null;
  if (wk.count >= 2) {
    let bestDay = -1;
    let bestAvg = 0;
    wk.dayAvgRatings.forEach((avg, i) => {
      if (avg !== null && avg > bestAvg) { bestAvg = avg; bestDay = i; }
    });
    if (bestDay >= 0 && wk.daysWithCoffee > 1) {
      insight = `יום ${FULL_DAY_NAMES[bestDay]} הוא היום החזק של השבוע — ממוצע ${bestAvg.toFixed(1)} על ${wk.days[bestDay]} ${wk.days[bestDay] === 1 ? 'שוט' : 'שוטים'}.`;
    }
  }

  const ringValue = wk.avgRating ?? 0;
  const dash = (ringValue / 10) * RING_C;

  return (
    <div>
      <div className="card accent">
        <h2><TrendIcon size={18} /> סיכום שבועי</h2>

        <div className="wk-nav">
          <button
            type="button"
            aria-label="שבוע קודם"
            disabled={offset >= maxBack}
            onClick={() => setOffset(offset + 1)}
          >
            ‹
          </button>
          <span className="wk-range">
            {weekLabel(wk.start, wk.end)}
            {offset === 0 && <span className="muted small"> · השבוע</span>}
          </span>
          <button
            type="button"
            aria-label="שבוע הבא"
            disabled={offset === 0}
            onClick={() => setOffset(offset - 1)}
          >
            ›
          </button>
        </div>

        {wk.count === 0 ? (
          <p className="muted" style={{ textAlign: 'center', padding: '18px 0' }}>
            אין שוטים בשבוע הזה.
          </p>
        ) : (
          <>
            {/* טבעת הממוצע — אחותה של טבעת הטיימר */}
            {wk.avgRating !== null && (
              <div className="wk-ring" dir="ltr">
                <svg width="164" height="164" viewBox="0 0 164 164" aria-hidden="true">
                  <circle cx="82" cy="82" r={RING_R} fill="none" stroke="var(--border-soft)" strokeWidth="9" />
                  <circle
                    cx="82" cy="82" r={RING_R} fill="none"
                    stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={`${dash} ${RING_C}`}
                    transform="rotate(-90 82 82)"
                  />
                </svg>
                <div className="wk-ring-num">
                  <span className="n">{wk.avgRating.toFixed(1)}</span>
                  <span className="l">
                    ממוצע שבועי
                    {diff !== null && diff !== 0 && (
                      <b style={{ color: diff > 0 ? 'var(--good)' : 'var(--warn)' }}>
                        {' '}{diff > 0 ? '‎↑' : '‎↓'}{Math.abs(diff).toFixed(1)}
                      </b>
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="stat-grid">
              <StatTile value={wk.count} label="שוטים" />
              <StatTile value={wk.bestShot ? wk.bestShot.rating : '—'} label="הכי טוב" />
              <StatTile value={wk.daysWithCoffee} label="ימים עם קפה" />
              <StatTile value={wk.prevCount} label="שבוע שעבר" />
            </div>
          </>
        )}
      </div>

      {wk.count > 0 && (
        <div className="card">
          <h2><ChartIcon size={18} /> שוטים לפי יום</h2>
          <div className="wk-days">
            {wk.days.map((n, i) => (
              <span className="wk-day" key={i}>
                <i
                  className={n ? '' : 'z'}
                  style={{ height: n ? 16 + (n / maxDay) * 58 : 6 }}
                  title={`${DAY_NAMES[i]}: ${n} שוטים`}
                />
                <em>{DAY_NAMES[i]}</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {wk.bestShot && (
        <div className="card">
          <h2><TrophyIcon size={18} /> השוט של השבוע</h2>
          <div className="shot-item" style={{ cursor: 'default' }}>
            <span className={`shot-rating ${ratingClass(wk.bestShot.rating)}`}>{wk.bestShot.rating}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block' }}>{beanMap.get(wk.bestShot.beanId)?.name ?? 'פולים שנמחקו'}</span>
              <span className="muted small" style={{ display: 'block' }}>
                {shotWeights(wk.bestShot)} · {wk.bestShot.brewTimeSec} שניות · יחס 1:{shotRatio(wk.bestShot).toFixed(1)}
              </span>
              <span className="muted small" style={{ display: 'block' }}>{formatDateTime(wk.bestShot.createdAt)}</span>
            </span>
          </div>
        </div>
      )}

      {insight && (
        <div className="one-var-banner" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
          <BulbIcon size={16} /> <span>{insight}</span>
        </div>
      )}
    </div>
  );
}
