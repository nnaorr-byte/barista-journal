import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { computeInsights } from '../services/learning';
import { recommendShot, confidenceLabel } from '../services/recommendation';
import { computeMaintenanceStatus } from '../services/maintenance';
import { computeBackupStatus, shareBackup } from '../services/importExport';
import { ratingTrend } from '../services/stats';
import { shotRatio, type RoastLevel } from '../domain/types';
import { StatTile, EmptyState } from './components';
import { formatDateTime, ratingClass, shotWeights } from './labels';
import type { Screen } from '../App';

export function HomeScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const [backupMsg, setBackupMsg] = useState('');
  const [backupDismissed, setBackupDismissed] = useState(false);
  const data = useLiveQuery(async () => {
    const [user, shots, beans, bags, events, grinders] = await Promise.all([
      db.users.toArray().then((u) => u[0]),
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.beans.toArray(),
      db.bags.toArray(),
      db.maintenanceEvents.toArray(),
      db.grinders.toArray(),
    ]);
    return { user, shots, beans, bags, events, grinders };
  });

  if (!data) return null;
  const { user, shots, beans, bags, events, grinders } = data;

  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const roastMap = new Map<string, RoastLevel>(beans.map((b) => [b.id, b.roastLevel]));
  const insights = computeInsights(shots, roastMap);
  const maintenance = computeMaintenanceStatus(events);
  const trend = ratingTrend(shots);

  // המלצת השוט הבא: לפי השקית האחרונה שבה השתמשת
  const lastShot = shots[0];
  const lastBag = lastShot ? bags.find((b) => b.id === lastShot.bagId) : null;
  const lastBean = lastBag ? beanMap.get(lastBag.beanId) : null;
  const defaultGrinder = grinders.find((g) => g.isDefault) ?? grinders[0];

  const recommendation =
    lastBean && lastBag && user
      ? recommendShot({
          user,
          bean: lastBean,
          bag: lastBag,
          beanShots: shots.filter((s) => s.beanId === lastBean.id),
          grinderShots: shots.filter(
            (s) => s.beanId === lastBean.id && s.grinderId === (lastShot?.grinderId ?? defaultGrinder?.id),
          ),
          grinder: grinders.find((g) => g.id === (lastShot?.grinderId ?? defaultGrinder?.id)),
        })
      : null;

  // פולים אחרונים בשימוש
  const recentBeanIds: string[] = [];
  for (const s of shots) {
    if (!recentBeanIds.includes(s.beanId)) recentBeanIds.push(s.beanId);
    if (recentBeanIds.length >= 3) break;
  }

  const overdueMaintenance = maintenance.filter((m) => m.overdue || m.lastPerformed === null);
  const backupStatus = computeBackupStatus(shots);

  return (
    <div>
      {/* תזכורת גיבוי */}
      {backupStatus.needsBackup && !backupDismissed && (
        <div className="card warn">
          <h2>💾 הגיע הזמן לגבות</h2>
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            {backupStatus.lastBackupAt === null
              ? `יש לך ${backupStatus.shotsSinceBackup} שוטים שמעולם לא גובו. אם המכשיר יאבד — היומן יאבד איתו.`
              : `${backupStatus.shotsSinceBackup} שוטים חדשים מאז הגיבוי האחרון (לפני ${backupStatus.daysSinceBackup} ימים).`}
          </p>
          {backupMsg && <p className="small" style={{ margin: '0 0 8px', color: 'var(--good)' }}>{backupMsg}</p>}
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={async () => {
                const result = await shareBackup();
                if (result === 'shared') setBackupMsg('✅ הגיבוי שותף בהצלחה!');
                else if (result === 'fallback') setBackupMsg('✅ קובץ הגיבוי ירד למכשיר!');
              }}
            >
              💾 גבה עכשיו
            </button>
            <button className="btn secondary small" onClick={() => setBackupDismissed(true)}>
              אחר כך
            </button>
          </div>
        </div>
      )}
      {/* המלצת השוט הבא */}
      <div className="card accent">
        <h2>🎯 המלצת השוט הבא</h2>
        {recommendation && lastBean ? (
          <>
            <div className="muted small" style={{ marginBottom: 8 }}>
              {lastBean.name} · {lastBean.roastery}
            </div>
            <div className="stat-grid">
              <StatTile value={recommendation.doseGrams} label="גרם נכנס" />
              <StatTile value={recommendation.yieldGrams} label="גרם יוצא" />
              <StatTile value={`${recommendation.brewTimeSecMin}–${recommendation.brewTimeSecMax}`} label="שניות" />
              <StatTile value={`1:${recommendation.ratio}`} label="יחס" />
              {recommendation.grindSetting !== null && (
                <StatTile value={recommendation.grindSetting} label="טחינה" />
              )}
            </div>
            {recommendation.reasons[0]?.startsWith('🧠') && (
              <p className="small" style={{ marginTop: 10, color: 'var(--crema)' }}>
                {recommendation.reasons[0]}
              </p>
            )}
            <p className="muted small" style={{ marginTop: 6 }}>
              {confidenceLabel(recommendation.confidence, recommendation.basedOnShots)}
            </p>
            <button className="btn block" onClick={() => navigate('new-shot')}>
              ☕ התחל שוט חדש
            </button>
          </>
        ) : (
          <>
            <EmptyState
              icon="☕"
              text="עדיין אין היסטוריה"
              hint="הוסף פולים והכן את השוט הראשון — ההמלצות יתחילו לזרום מיד."
            />
            <button className="btn block" onClick={() => navigate(beans.length ? 'new-shot' : 'beans')}>
              {beans.length ? '☕ התחל שוט ראשון' : '🫘 הוסף פולים ראשונים'}
            </button>
          </>
        )}
      </div>

      {/* תזכורות תחזוקה */}
      {overdueMaintenance.length > 0 && shots.length > 0 && (
        <div className="card warn">
          <h2>🔔 תזכורות תחזוקה</h2>
          {overdueMaintenance.map((m) => (
            <div key={m.rule.kind} style={{ marginBottom: 6 }}>
              <span className="badge warn">
                {m.rule.label}
                {m.daysAgo !== null ? ` — לפני ${m.daysAgo} ימים` : ' — לא תועד עדיין'}
              </span>
            </div>
          ))}
          <button className="btn small secondary" onClick={() => navigate('settings')}>
            תיעוד ניקוי בהגדרות
          </button>
        </div>
      )}

      {/* סטטיסטיקה אישית */}
      <div className="card">
        <h2>📈 הסטטיסטיקה שלי</h2>
        <div className="stat-grid">
          <StatTile value={insights.shotCount} label="שוטים סה״כ" />
          <StatTile value={insights.shotCount ? insights.avgRating.toFixed(1) : '—'} label="דירוג ממוצע" />
          <StatTile
            value={insights.bestShot ? `${insights.bestShot.rating}/10` : '—'}
            label="השוט הטוב ביותר"
          />
        </div>
        {trend.direction !== 'insufficient' && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {trend.direction === 'up' && `📈 מגמת שיפור! הדירוג הממוצע עלה מ-${trend.previousAvg.toFixed(1)} ל-${trend.recentAvg.toFixed(1)} בשוטים האחרונים.`}
            {trend.direction === 'down' && `📉 שים לב: הדירוג הממוצע ירד מ-${trend.previousAvg.toFixed(1)} ל-${trend.recentAvg.toFixed(1)}. אולי הפולים מתיישנים או שהמכונה צריכה ניקוי?`}
            {trend.direction === 'stable' && `➡️ יציבות: הדירוג הממוצע שלך נשאר סביב ${trend.recentAvg.toFixed(1)} — עקביות היא שם המשחק.`}
          </p>
        )}
      </div>

      {/* השוט הטוב ביותר אי פעם */}
      {insights.bestShot && (
        <div className="card">
          <h2>🏆 השוט הטוב ביותר אי פעם</h2>
          <div className="shot-item" style={{ cursor: 'default' }}>
            <div className={`shot-rating ${ratingClass(insights.bestShot.rating)}`}>
              {insights.bestShot.rating}
            </div>
            <div style={{ flex: 1 }}>
              <div>{beanMap.get(insights.bestShot.beanId)?.name ?? 'פולים שנמחקו'}</div>
              <div className="muted small">
                {shotWeights(insights.bestShot)} ·{' '}
                {insights.bestShot.brewTimeSec} שניות · יחס 1:{shotRatio(insights.bestShot).toFixed(1)} · טחינה{' '}
                {insights.bestShot.grindSetting}
              </div>
              <div className="muted small">{formatDateTime(insights.bestShot.createdAt)}</div>
            </div>
          </div>
        </div>
      )}

      {/* פולים אחרונים */}
      {recentBeanIds.length > 0 && (
        <div className="card">
          <h2>🫘 הפולים האחרונים שלי</h2>
          {recentBeanIds.map((id) => {
            const bean = beanMap.get(id);
            if (!bean) return null;
            const beanShots = shots.filter((s) => s.beanId === id);
            const avg = beanShots.reduce((a, s) => a + s.rating, 0) / beanShots.length;
            return (
              <div key={id} className="shot-item" onClick={() => navigate('beans')}>
                <div style={{ flex: 1 }}>
                  <div>{bean.name}</div>
                  <div className="muted small">{bean.roastery} · {beanShots.length} שוטים</div>
                </div>
                <span className={`shot-rating ${ratingClass(avg)}`}>{avg.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ימי ניקיון */}
      {shots.length > 0 && (
        <div className="card">
          <h2>🧼 תחזוקה</h2>
          <div className="stat-grid">
            {maintenance.map((m) => (
              <StatTile
                key={m.rule.kind}
                value={m.daysAgo !== null ? m.daysAgo : '—'}
                label={`ימים מאז ${shortMaintLabel(m.rule.kind)}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function shortMaintLabel(kind: string): string {
  switch (kind) {
    case 'machine-backflush': return 'שטיפת מכונה';
    case 'machine-descale': return 'ניקוי אבנית';
    case 'grinder-clean': return 'ניקוי מטחנה';
    default: return kind;
  }
}
