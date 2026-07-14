import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { computeInsights } from '../services/learning';
import { recommendShot, confidenceLabel, daysSince } from '../services/recommendation';
import { computeMaintenanceStatus } from '../services/maintenance';
import { computeBackupStatus, shareBackup } from '../services/importExport';
import { computeFreshness, computeWinningWindow } from '../services/freshness';
import { computeBagUsage, ratingTrend } from '../services/stats';
import { shotRatio, type RoastLevel } from '../domain/types';
import { StatTile, EmptyState } from './components';
import { formatDateTime, ratingClass, shotWeights } from './labels';
import { BeanIcon, BellIcon, CupIcon, LeafIcon, SaveIcon, SoapIcon, TargetIcon, TrendIcon, TrophyIcon, WarnIcon } from './icons';
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

  const greeting = timeGreeting(user?.name);

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
          lastGrinderShot: shots.find((s) => s.grinderId === (lastShot?.grinderId ?? defaultGrinder?.id)),
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

  // השקית הפעילה להתראות: השקית של השוט האחרון — אלא אם סומנה כנגמרה,
  // ואז עוברים לשקית הפתוחה החדשה ביותר (אם קיימת). שקית שנגמרה לא מוזכרת.
  const openBags = bags.filter((b) => !b.finished);
  const newestOpenBag = [...openBags]
    .sort((a, b) => (b.openDate ?? b.createdAt).localeCompare(a.openDate ?? a.createdAt))[0] ?? null;
  const activeBag = lastBag && !lastBag.finished ? lastBag : newestOpenBag;
  const activeBagBean = activeBag ? beanMap.get(activeBag.beanId) : null;
  // כשההתראה עברה לשקית אחרת מזו של השוט האחרון — מציינים את שם הפולים
  const bagLabel = activeBag && activeBag.id !== lastBag?.id && activeBagBean
    ? `השקית החדשה (${activeBagBean.name})`
    : 'השקית';

  // התראת טריות: איפה השקית הפעילה ביחס לחלון הטריות.
  // עדיפות לחלון האישי (מההיסטוריה) — אך רק אם הוא סביר (מתחיל עד יום 30).
  // חלון "מנצח" שמתחיל ביום 30+ הוא כמעט תמיד הטיה — הטכניקה השתפרה
  // עם הזמן, לא הפולים — ואז נופלים חזרה לחלון המדעי (5–30 יום).
  const winning = computeWinningWindow(shots, bags);
  const personalWindow = winning && winning.from <= 30 ? winning : null;
  const bagAge = activeBag ? daysSince(activeBag.roastDate) : null;
  let freshnessNudge: { text: string; tone: 'good' | 'warn' } | null = null;
  if (recommendation && bagAge !== null && activeBag) {
    if (personalWindow) {
      const w = personalWindow;
      if (bagAge >= w.from && bagAge <= w.to) {
        freshnessNudge = {
          tone: 'good',
          text: `${bagLabel} ביום ${bagAge} מהקלייה — בדיוק בטווח שבו יצאו לך השוטים הכי טובים (ימים ${w.from}–${w.to}). זה הזמן ליהנות ממנה!`,
        };
      } else if (bagAge < w.from) {
        freshnessNudge = {
          tone: 'good',
          text: `${bagLabel} ביום ${bagAge} מהקלייה. לפי ההיסטוריה שלך, השוטים הכי טובים יוצאים בימים ${w.from}–${w.to} — היא תיכנס לטווח בעוד ${w.from - bagAge} ימים.`,
        };
      } else {
        freshnessNudge = {
          tone: 'warn',
          text: `${bagLabel} ביום ${bagAge} מהקלייה — אחרי הטווח שבו יצאו לך השוטים הכי טובים (ימים ${w.from}–${w.to}). שווה לסיים אותה בקרוב.`,
        };
      }
    } else {
      // אין חלון אישי אמין — הערכת הטריות המקצועית (5–30 יום אידיאלי, דד-ליין 60)
      const fresh = computeFreshness(activeBag.roastDate);
      const stageText: Partial<Record<typeof fresh.stage, { text: string; tone: 'good' | 'warn' }>> = {
        resting: { tone: 'warn', text: `${bagLabel} ביום ${bagAge} מהקלייה — הפולים עדיין משחררים גזים; חלון הטריות האידיאלי מתחיל סביב יום 5.` },
        peak: { tone: 'good', text: `${bagLabel} ביום ${bagAge} מהקלייה — בשיא הטריות. זה הזמן ליהנות ממנה!` },
        good: { tone: 'good', text: `${bagLabel} ביום ${bagAge} מהקלייה — עדיין בחלון טריות טוב.` },
        fading: { tone: 'warn', text: `${bagLabel} ביום ${bagAge} מהקלייה — הטריות יורדת; שווה לסיים אותה בקרוב.` },
        expired: { tone: 'warn', text: `${bagLabel} ביום ${bagAge} מהקלייה — מעבר לחלון הטריות (60 יום). עדיף לסיים אותה מהר.` },
      };
      freshnessNudge = stageText[fresh.stage] ?? null;
    }
  }

  // התראת מלאי נמוך: פחות מ-10 שוטים משוערים בשקית הפעילה
  let lowStock: string | null = null;
  if (recommendation && activeBag && !activeBag.finished) {
    const usage = computeBagUsage(activeBag, shots);
    const avgDose = usage.shotsCount > 0 ? usage.gramsUsed / usage.shotsCount : (user?.defaultDoseGrams ?? 16);
    const shotsLeft = avgDose > 0 ? Math.floor(usage.gramsLeft / avgDose) : 0;
    if (usage.shotsCount > 0 && shotsLeft < 10) {
      lowStock = shotsLeft <= 0
        ? 'השקית כמעט ריקה לפי התיעוד — הזמן פולים חדשים!'
        : `נשארו ~${shotsLeft} שוטים בשקית (~${usage.gramsLeft.toFixed(0)} גרם) — כדאי להזמין פולים חדשים.`;
    }
  }

  return (
    <div>
      {/* ברכת פתיחה לפי שעת היום */}
      <div className="home-greeting">
        <div className="greeting-main">{greeting.main}</div>
        <div className="greeting-sub">{greeting.sub}</div>
      </div>

      {/* תזכורת גיבוי */}
      {backupStatus.needsBackup && !backupDismissed && (
        <div className="card warn">
          <h2><SaveIcon size={18} /> הגיע הזמן לגבות</h2>
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
              <SaveIcon size={16} /> גבה עכשיו
            </button>
            <button className="btn secondary small" onClick={() => setBackupDismissed(true)}>
              אחר כך
            </button>
          </div>
        </div>
      )}
      {/* המלצת השוט הבא */}
      <div className="card accent">
        <h2><TargetIcon size={18} /> המלצת השוט הבא</h2>
        {recommendation && lastBean ? (
          <>
            <div className="muted small" style={{ marginBottom: 8 }}>
              {lastBean.name} · {lastBean.roastery}
            </div>
            <div className="stat-grid">
              <StatTile value={recommendation.doseGrams} label="גרם נכנס" />
              {recommendation.stopAtGrams !== null && (
                <StatTile value={recommendation.stopAtGrams} label="עצירה בפועל" />
              )}
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
            {freshnessNudge && (
              <p
                className="small"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6,
                  color: freshnessNudge.tone === 'good' ? 'var(--good)' : 'var(--warn)',
                }}
              >
                <LeafIcon size={15} strokeWidth={2} /> <span>{freshnessNudge.text}</span>
              </p>
            )}
            {lowStock && (
              <p
                className="small"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, color: 'var(--warn)' }}
              >
                <WarnIcon size={15} strokeWidth={2} /> <span>{lowStock}</span>
              </p>
            )}
            <button className="btn block" onClick={() => navigate('new-shot')}>
              <CupIcon size={18} /> התחל שוט חדש
            </button>
          </>
        ) : (
          <>
            <EmptyState
              icon={<CupIcon size={40} />}
              text="עדיין אין היסטוריה"
              hint="הוסף פולים והכן את השוט הראשון — ההמלצות יתחילו לזרום מיד."
            />
            <button className="btn block" onClick={() => navigate(beans.length ? 'new-shot' : 'beans')}>
              {beans.length ? <><CupIcon size={18} /> התחל שוט ראשון</> : <><BeanIcon size={17} /> הוסף פולים ראשונים</>}
            </button>
          </>
        )}
      </div>

      {/* תזכורות תחזוקה */}
      {overdueMaintenance.length > 0 && shots.length > 0 && (
        <div className="card warn">
          <h2><BellIcon size={18} /> תזכורות תחזוקה</h2>
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
        <h2><TrendIcon size={18} /> הסטטיסטיקה שלי</h2>
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
          <h2><TrophyIcon size={18} /> השוט הטוב ביותר אי פעם</h2>
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
          <h2><BeanIcon size={18} /> הפולים האחרונים שלי</h2>
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
          <h2><SoapIcon size={18} /> תחזוקה</h2>
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

// ברכה משתנה לפי שעת היום — נותנת לאפליקציה קול אנושי בכל כניסה
function timeGreeting(name?: string): { main: string; sub: string } {
  const who = name?.trim() ? `, ${name.trim()}` : '';
  const hour = new Date().getHours();
  if (hour < 5) return { main: `לילה טוב${who}`, sub: 'שוט אחרי חצות? מסירים בפניך את הכובע.' };
  if (hour < 11) return { main: `בוקר טוב${who}`, sub: 'הזמן המושלם לשוט הראשון של היום.' };
  if (hour < 15) return { main: `צהריים טובים${who}`, sub: 'הפסקת קפה? הגעת למקום הנכון.' };
  if (hour < 18) return { main: `אחר צהריים טובים${who}`, sub: 'שוט של אחר הצהריים מגיע לך.' };
  return { main: `ערב טוב${who}`, sub: 'שוט ערב — נהנים בכיף, רק שהקפאין לא יעיר אותך.' };
}

function shortMaintLabel(kind: string): string {
  switch (kind) {
    case 'machine-backflush': return 'שטיפת מכונה';
    case 'machine-descale': return 'ניקוי אבנית';
    case 'grinder-clean': return 'ניקוי מטחנה';
    default: return kind;
  }
}
