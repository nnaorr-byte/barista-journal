import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { computeInsights } from '../services/learning';
import { confidenceLabel, daysSince } from '../services/recommendation';
import { computeMaintenanceStatus } from '../services/maintenance';
import { computeBackupStatus, shareBackup } from '../services/importExport';
import { AGED_OPTIMAL_DAYS, computeFreshness, computeWinningWindow } from '../services/freshness';
import { computeBagUsage, ratingTrend, weeklySummary } from '../services/stats';
import { computeAgingSlope, computePrepTightness, computeRepeatability, prepTightnessTrend } from '../services/aging';
import { makePersonalWindowResolver } from '../services/targetWindow';
import { nextShotRecommendation } from '../services/nextShot';
import type { RoastLevel, Shot } from '../domain/types';
import { CountUp, DialInLadder, StatTile, EmptyState, ScreenSkeleton, useRevealOnView } from './components';
import { ratingClass } from './labels';
import { BeanIcon, ChevronDownIcon, CupIcon, LeafIcon, SaveIcon, SoapIcon, TargetIcon, TrendDownIcon, TrendIcon, WarnIcon } from './icons';
import type { Screen } from '../App';

// מסילת הטריות. רכיב נפרד ולא JSX בתוך ה-IIFE, כי הוא מריץ hook — וגם
// כי החשיפה שלו היא שלו: החלון גדל מתחילתו, ואז הסמן נוסע מיום 0 עד היום.
function FreshTrack({ windowStart, windowWidth, todayAt }: {
  windowStart: string;
  windowWidth: string;
  todayAt: string;
}) {
  const { ref, revealed } = useRevealOnView<HTMLDivElement>();
  return (
    <div className="fresh-track" ref={ref}>
      <div className="fresh-window" style={{ insetInlineStart: windowStart, width: windowWidth }} />
      {/* לפני החשיפה הסמן יושב על יום 0; ה-transition עושה את הנסיעה */}
      <div className="fresh-today" style={{ insetInlineStart: revealed ? todayAt : '0%' }} />
    </div>
  );
}

// ===== שכבת ההתראות =====
// התראה אחת מוצגת במלואה (הראשונה בסולם העדיפות), היתר נספרות ב-+N.
// הסולם קבוע: גיבוי דחוף → שקית ריקה → תחזוקה באיחור → טריות מעבר לטווח →
// גיבוי רגיל → מלאי מתחת ל-10. עדיפות היא נתון אחד, לא סדרת && בתוך ה-JSX.
type AlertTone = 'bad' | 'warn' | 'muted';

interface HomeAlert {
  key: string;
  tone: AlertTone;
  icon: ReactNode;
  title: string;
  sub: string;
  cta: string; // הכיתוב במצב המקופל ("גבה עכשיו")
  action: { label: string; secondary?: boolean; onClick: () => void };
  isBackup?: boolean;
}

const TONE_VAR: Record<AlertTone, string> = {
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  muted: 'var(--text-muted)',
};

export function HomeScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const [backupMsg, setBackupMsg] = useState('');
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const data = useLiveQuery(async () => {
    const [user, shots, beans, bags, events, grinders, dialInSessions] = await Promise.all([
      db.users.toArray().then((u) => u[0]),
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.beans.toArray(),
      db.bags.toArray(),
      db.maintenanceEvents.toArray(),
      db.grinders.toArray(),
      db.dialInSessions.toArray(),
    ]);
    return { user, shots, beans, bags, events, grinders, dialInSessions };
  });

  if (!data) return <ScreenSkeleton cards={3} tiles={3} />;
  const { user, shots, beans, bags, events, grinders, dialInSessions } = data;

  const greeting = timeGreeting(user?.name);

  // באנר הסיכום השבועי (וריאציה C מהפרוטוטייפ) — שקט, מעל ההמלצה
  // חלון היעד לכל שוט נגזר מהפולים והקלייה שלו, לא מקבוע גלובלי
  // אותו resolver כמו במסך הסיכום, כדי ששני המסכים לא יחשבו את אותו מדד אחרת
  const week = weeklySummary(shots, 0, makePersonalWindowResolver(beans, bags, shots));
  const weekDiff = week.avgRating !== null && week.prevAvg !== null
    ? Math.round((week.avgRating - week.prevAvg) * 10) / 10
    : null;

  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const roastMap = new Map<string, RoastLevel>(beans.map((b) => [b.id, b.roastLevel]));
  const insights = computeInsights(shots, roastMap);
  const maintenance = computeMaintenanceStatus(events);
  const trend = ratingTrend(shots);

  // ---- השקית הפעילה ----
  // השקית של השוט האחרון — אלא אם סומנה כנגמרה, ואז השקית הפתוחה
  // החדשה ביותר. שקית שנגמרה לא מוזכרת, ולא נותנת המלצה.
  const lastShot = shots[0];
  const lastBag = lastShot ? bags.find((b) => b.id === lastShot.bagId) : null;
  const defaultGrinder = grinders.find((g) => g.isDefault) ?? grinders[0];
  const openBags = bags.filter((b) => !b.finished);
  const newestOpenBag = [...openBags]
    .sort((a, b) => (b.openDate ?? b.createdAt).localeCompare(a.openDate ?? a.createdAt))[0] ?? null;
  const activeBag = lastBag && !lastBag.finished ? lastBag : newestOpenBag;
  // שם הפולים של השקית הפעילה — מופיע בהתראת המלאי, כדי שברור על איזו שקית מדובר
  const activeBagBean = activeBag ? beanMap.get(activeBag.beanId) : null;
  // שקית חדשה שעוד אין בה שוטים — ההמלצה כבר מתייחסת אליה
  const switchedBag = !!activeBag && !!lastBag && activeBag.id !== lastBag.id;

  // המלצת השוט הבא — תמיד לשקית הפעילה, וכשיש עליה כיול פעיל גם יעדי
  // הכיול. ההרכבה חיה ב-services/nextShot.ts כדי שמסך הבית, שלב ההכנה
  // בשוט חדש והשוט האחרון ביומן יראו את אותו מספר בדיוק.
  const next = activeBagBean && activeBag && user
    ? nextShotRecommendation({
        user,
        bean: activeBagBean,
        bag: activeBag,
        shots,
        grinders,
        sessions: dialInSessions,
        grinderId: lastShot?.grinderId ?? defaultGrinder?.id,
        leadReason: switchedBag
          ? `עברת לשקית חדשה — ${activeBagBean.name}. ההמלצה מתייחסת אליה בלבד; ההיסטוריה של הפולים הקודמים לא נכנסת לחישוב.`
          : null,
      })
    : null;

  const recommendation = next?.recommendation ?? null;
  const dialInAdvice = next?.dialInAdvice ?? null;
  const dialInState = dialInAdvice?.dialIn ?? null;
  const dialInBean = next?.session ? activeBagBean : null;
  const dialInShots = next?.sessionShots ?? [];
  const dialInLast = dialInShots[dialInShots.length - 1] ?? null;
  // השורה האחרונה במסלול היא ההווה, לא היסטוריה — היא מקבלת את ההמלצה
  // שחושבה עכשיו. אחרת המסלול היה סותר את שורת המתכון שמתחתיו.
  const dialInLadderShots = dialInAdvice && dialInLast
    ? dialInShots.map((s: Shot) => (s.id === dialInLast.id ? { ...s, aiAdvice: dialInAdvice } : s))
    : dialInShots;

  // פולים אחרונים בשימוש
  const recentBeanIds: string[] = [];
  for (const s of shots) {
    if (!recentBeanIds.includes(s.beanId)) recentBeanIds.push(s.beanId);
    if (recentBeanIds.length >= 3) break;
  }

  const overdueMaintenance = maintenance.filter((m) => m.overdue || m.lastPerformed === null);
  const backupStatus = computeBackupStatus(shots);

  // ---- הזדקנות וחזרתיות לשקית הפעילה ----
  // שני מדדים מאותה מדידה: כמה הזמן נודד בגלל הפולים, וכמה הוא נודד
  // כשהם לא. השני הוא היחיד שבשליטתך, ולכן הוא שמחליף את "השוט הטוב
  // ביותר" — מדד פסגה שלא אומר כלום על כמה בקרים יצאו כמו שרצית.
  const activeBagForAge = lastBag && !lastBag.finished ? lastBag : null;
  const activeBagShots = activeBagForAge
    ? shots.filter((s) => s.bagId === activeBagForAge.id)
    : [];
  const activeBagAge = activeBagForAge ? daysSince(activeBagForAge.roastDate) : null;
  const agingSlope = activeBagForAge
    ? computeAgingSlope(activeBagShots, [activeBagForAge], activeBagAge)
    : null;
  const repeatability = activeBagForAge
    ? computeRepeatability(activeBagShots, [activeBagForAge], agingSlope)
    : null;
  // רמת ההידוק הכללית ומגמתה. הפער של קבוצה אחת רגיש לחריג בודד;
  // סטיית התקן על כל הקבוצות היא המספר שאמור לרדת כשהפאק משתפר.
  const tightness = activeBagForAge
    ? computePrepTightness(activeBagShots, [activeBagForAge], agingSlope)
    : null;
  const tightnessTrend = activeBagForAge
    ? prepTightnessTrend(activeBagShots, [activeBagForAge])
    : null;

  // התראת טריות: איפה השקית הפעילה ביחס לחלון הטריות.
  // עדיפות לחלון האישי (מההיסטוריה) — אך רק אם הוא סביר (מתחיל עד יום 30).
  // חלון "מנצח" שמתחיל ביום 30+ הוא כמעט תמיד הטיה — הטכניקה השתפרה
  // עם הזמן, לא הפולים — ואז נופלים חזרה לחלון המדעי (5–30 יום).
  // מצב הטריות של השקית הפעילה — מקור אחד, אותו אחד שמסך הפולים מציג
  const activeFresh = activeBag
    ? computeFreshness(activeBag.roastDate, activeBag.openDate, activeBagBean?.roastType)
    : null;
  // קלייה ישנה: השעון הוא הפתיחה, ולכן גם החלון האישי לא רלוונטי כאן.
  // computeWinningWindow מודד דירוג מול *גיל קלייה*, ובפולים שנקנו ישנים
  // הציר הזה חסר משמעות — שקית שנפתחה היום היא יום 0, לא יום 95.
  const agedClock = activeFresh?.clock === 'opened';
  const winning = computeWinningWindow(shots, bags);
  const personalWindow = !agedClock && winning && winning.from <= 30 ? winning : null;
  // הגיל שמולו נמדדת הטריות: מהפתיחה בקלייה ישנה, מהקלייה בטרייה
  const bagAge = agedClock
    ? activeFresh?.freshnessAgeDays ?? null
    : (activeBag ? daysSince(activeBag.roastDate) : null);
  // חלון הטריות להצגה בפס שבתוך ההמלצה. FALLBACK_WINDOW הוא החלון המקצועי
  // (5–30 יום) שמשמש כשאין חלון אישי אמין — אותו טווח שהטקסטים דיברו עליו עד היום.
  const freshWindow = agedClock
    ? { from: 0, to: AGED_OPTIMAL_DAYS }
    : (personalWindow ?? { from: 5, to: 30 });
  // טון הטריות: מקור האמת נשאר הלוגיקה הקיימת (חלון אישי / שלב הטריות),
  // כי היא זו שקובעת אם יש כאן משהו לעשות. הפס עצמו נצבע לפי המקום בטווח.
  let freshnessNudge: { sub: string; tone: 'good' | 'warn' } | null = null;
  if (recommendation && bagAge !== null && activeBag) {
    if (personalWindow) {
      const w = personalWindow;
      if (bagAge > w.to) {
        freshnessNudge = { tone: 'warn', sub: `אחרי הטווח ${w.from}–${w.to} — שווה לסיים` };
      } else if (bagAge < w.from) {
        freshnessNudge = { tone: 'good', sub: `נכנסת לטווח ${w.from}–${w.to} בעוד ${w.from - bagAge} ימים` };
      } else {
        freshnessNudge = { tone: 'good', sub: `בתוך הטווח ${w.from}–${w.to}` };
      }
    } else {
      // אין חלון אישי אמין — הערכת הטריות המקצועית (5–30 יום אידיאלי, דד-ליין 60)
      const fresh = activeFresh ?? computeFreshness(activeBag.roastDate, activeBag.openDate, activeBagBean?.roastType);
      // בקלייה ישנה השעון הוא הפתיחה, ולכן גם הניסוח: "בשיא הטריות" על
      // פולים בני 95 יום היה נשמע כמו טעות, גם כשהחלון עצמו נכון.
      const stageText: Partial<Record<typeof fresh.stage, { sub: string; tone: 'good' | 'warn' }>> =
        fresh.clock === 'opened'
          ? {
            peak: { tone: 'good', sub: `שימוש מיטבי · יום ${fresh.freshnessAgeDays} מפתיחת השקית` },
            fading: { tone: 'warn', sub: `${fresh.daysToDeadline} ימים לדד-ליין — שווה לסיים` },
            expired: { tone: 'warn', sub: 'עברו 60 יום מהפתיחה — עדיף לסיים מהר' },
          }
          : {
            resting: { tone: 'warn', sub: 'עדיין משחרר גזים — הטווח מתחיל ביום 5' },
            peak: { tone: 'good', sub: 'בשיא הטריות' },
            good: { tone: 'good', sub: 'עדיין בחלון טריות טוב' },
            fading: { tone: 'warn', sub: 'הטריות יורדת — שווה לסיים בקרוב' },
            expired: { tone: 'warn', sub: 'מעבר לדד-ליין 60 יום — עדיף לסיים מהר' },
          };
      freshnessNudge = stageText[fresh.stage] ?? null;
    }
  }

  // מלאי השקית הפעילה: כמה שוטים נשארו לפי המנה הממוצעת בפועל
  let stock: { shotsLeft: number; gramsLeft: number; label: string } | null = null;
  if (recommendation && activeBag && !activeBag.finished) {
    const usage = computeBagUsage(activeBag, shots);
    const avgDose = usage.shotsCount > 0 ? usage.gramsUsed / usage.shotsCount : (user?.defaultDoseGrams ?? 16);
    const shotsLeft = avgDose > 0 ? Math.floor(usage.gramsLeft / avgDose) : 0;
    if (usage.shotsCount > 0 && shotsLeft < 10) {
      stock = {
        shotsLeft,
        gramsLeft: usage.gramsLeft,
        label: activeBagBean?.name ?? 'השקית הפעילה',
      };
    }
  }

  // בניית שכבת ההתראות לפי סולם העדיפות
  const alerts: HomeAlert[] = [];
  const backupSub = backupStatus.lastBackupAt === null
    ? 'מעולם לא גובה'
    : `לפני ${backupStatus.daysSinceBackup} ימים`;
  const backupAlert = (tone: AlertTone): HomeAlert => ({
    key: 'backup',
    tone,
    icon: tone === 'bad' ? <WarnIcon size={18} strokeWidth={1.8} /> : <SaveIcon size={18} strokeWidth={1.8} />,
    title: `${backupStatus.shotsSinceBackup} שוטים לא מגובים`,
    sub: backupSub,
    cta: 'גבה עכשיו',
    action: {
      label: 'גבה',
      onClick: async () => {
        const result = await shareBackup();
        if (result === 'shared') setBackupMsg('הגיבוי שותף בהצלחה!');
        else if (result === 'fallback') setBackupMsg('קובץ הגיבוי ירד למכשיר!');
      },
    },
    isBackup: true,
  });
  const showBackup = backupStatus.needsBackup && !backupDismissed;

  if (showBackup && backupStatus.urgent) alerts.push(backupAlert('bad'));
  if (stock && stock.shotsLeft <= 0) {
    alerts.push({
      key: 'stock-empty',
      tone: 'warn',
      icon: <BeanIcon size={18} strokeWidth={1.8} />,
      title: 'השקית כמעט ריקה',
      sub: `~${stock.gramsLeft.toFixed(0)} גרם · ${stock.label}`,
      cta: 'הזמן פולים חדשים',
      action: { label: 'שקית חדשה', secondary: true, onClick: () => navigate('beans') },
    });
  }
  if (shots.length > 0) {
    for (const m of overdueMaintenance) {
      alerts.push({
        key: `maint-${m.rule.kind}`,
        tone: 'warn',
        icon: <SoapIcon size={18} strokeWidth={1.8} />,
        title: shortMaintLabel(m.rule.kind),
        sub: m.daysAgo !== null ? `לפני ${m.daysAgo} ימים` : 'לא תועד עדיין',
        cta: 'תעד ניקוי',
        action: { label: 'תיעוד', secondary: true, onClick: () => navigate('settings') },
      });
    }
  }
  if (freshnessNudge?.tone === 'warn' && bagAge !== null) {
    alerts.push({
      key: 'freshness',
      tone: 'warn',
      icon: <LeafIcon size={18} strokeWidth={1.8} />,
      title: `יום ${bagAge} ${agedClock ? 'מפתיחת השקית' : 'מהקלייה'}`,
      sub: freshnessNudge.sub,
      cta: 'בדוק את הפולים',
      action: { label: 'הפולים שלי', secondary: true, onClick: () => navigate('beans') },
    });
  }
  if (showBackup && !backupStatus.urgent) alerts.push(backupAlert('warn'));
  if (stock && stock.shotsLeft > 0) {
    alerts.push({
      key: 'stock-low',
      tone: 'muted',
      icon: <BeanIcon size={18} strokeWidth={1.8} />,
      title: `~${stock.shotsLeft} שוטים בשקית`,
      sub: `~${stock.gramsLeft.toFixed(0)} גרם · ${stock.label}`,
      cta: 'כדאי להזמין פולים',
      action: { label: 'שקית חדשה', secondary: true, onClick: () => navigate('beans') },
    });
  }

  const lead = alerts[0];
  // שינוי הטחינה מול השוט האחרון — המשתנה היחיד שההמלצה מזיזה, ולכן היחיד שמודגש
  const grindDelta =
    recommendation?.grindSetting != null && lastShot?.grindSetting != null
      ? Math.round((recommendation.grindSetting - lastShot.grindSetting) * 10) / 10
      : 0;

  return (
    <div>
      {/* ברכת פתיחה — כשיש שוטים בשבוע, השורה השנייה היא הסיכום השבועי ולחיצה עליה מנווטת אליו */}
      <div className="home-greeting">
        {week.count > 0 ? (
          <button type="button" className="greeting-tap" onClick={() => navigate('weekly')}>
            <span className="greeting-main">{greeting.main}</span>
            <span className="greeting-sub">
              {week.count} {week.count === 1 ? 'שוט' : 'שוטים'} השבוע
              {week.avgRating !== null && <> · ממוצע {week.avgRating.toFixed(1)}</>}
              {weekDiff !== null && weekDiff !== 0 && (
                <b style={{ color: weekDiff > 0 ? 'var(--good)' : 'var(--warn)' }}>
                  {' '}{weekDiff > 0 ? '‎↑' : '‎↓'}{Math.abs(weekDiff).toFixed(1)}
                </b>
              )}
              {' · '}<span style={{ color: 'var(--crema)' }}>הקש לסיכום</span>
            </span>
          </button>
        ) : (
          <>
            <span className="greeting-main">{greeting.main}</span>
            <span className="greeting-sub">{greeting.sub}</span>
          </>
        )}
      </div>

      {/* שכבת ההתראות — ההתראה הדחופה ביותר, והשאר נספרות. אין שכבה כשאין התראות. */}
      {lead && (
        <div
          className={`alert-layer${alertsOpen ? ' open' : ''}`}
          style={{ ['--alert-tone' as string]: TONE_VAR[lead.tone] }}
        >
          <button
            type="button"
            className="alert-toggle"
            aria-expanded={alertsOpen}
            onClick={() => setAlertsOpen((v) => !v)}
          >
            {alertsOpen ? (
              <span className="alert-head">
                {alerts.length === 1 ? 'דבר אחד לטיפול' : `${alerts.length} דברים לטיפול`}
              </span>
            ) : (
              <>
                <span className="alert-ico">{lead.icon}</span>
                <span className="small alert-text" role="status">
                  {lead.title} · {lead.sub}
                  <br />
                  <b style={{ color: 'var(--alert-tone)' }}>{lead.cta}</b>
                </span>
                {alerts.length > 1 && <span className="alert-count">{`‎+${alerts.length - 1}`}</span>}
              </>
            )}
            <span className="alert-chevron"><ChevronDownIcon size={16} strokeWidth={1.9} /></span>
          </button>
          <div className={`collapse${alertsOpen ? ' open' : ''}`}>
            <div className="collapse-inner">
              {alerts.map((a) => (
                <div key={a.key} className="alert-row" style={{ ['--alert-tone' as string]: TONE_VAR[a.tone] }}>
                  <span className="alert-ico">{a.icon}</span>
                  <span className="small alert-body">
                    {a.title}
                    <span className="muted alert-sub">{a.sub}</span>
                    {a.isBackup && backupMsg && (
                      <span className="alert-sub" style={{ color: 'var(--good)' }}>{backupMsg}</span>
                    )}
                  </span>
                  {a.isBackup ? (
                    <>
                      <button className="btn small" onClick={a.action.onClick}>{a.action.label}</button>
                      <button className="btn small secondary" onClick={() => setBackupDismissed(true)}>אחר כך</button>
                    </>
                  ) : (
                    <button
                      className={`btn small${a.action.secondary ? ' secondary' : ''}`}
                      onClick={a.action.onClick}
                    >
                      {a.action.label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* המלצת השוט הבא — הכרטיס הראשי, מודגש מעל השאר */}
      <div className="card accent hero">
        <h2><TargetIcon size={20} /> המלצת השוט הבא</h2>
        {recommendation && activeBagBean ? (
          <>
            <div className="muted small" style={{ marginBottom: 7 }}>
              {activeBagBean.name} · {activeBagBean.roastery}
            </div>

            {/* כיול פעיל — התהליך המיוחד מוצג במקום שבו מסתכלים לפני שוט */}
            {dialInState && (
              <div className="dial-in-strip">
                <div className="dial-in-head">
                  <TargetIcon size={17} />
                  <span>
                    {dialInState.kind === 'recheck' ? 'בדיקה חוזרת' : 'כיול'}
                    {dialInBean ? ` · ${dialInBean.name}` : ''}
                  </span>
                  <span className="dial-in-count">שוט {dialInState.shotIndex}</span>
                </div>
                <ol className="dial-in-track" aria-label={`שלב ${dialInState.phaseStep} מתוך 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <li
                      key={n}
                      className={
                        n < dialInState.phaseStep ? 'done' : n === dialInState.phaseStep ? 'now' : ''
                      }
                      aria-current={n === dialInState.phaseStep ? 'step' : undefined}
                    />
                  ))}
                </ol>
                <p className="small" style={{ margin: '0 0 8px' }}>{dialInState.phaseLabel}</p>
                <DialInLadder shots={dialInLadderShots} limit={3} />
              </div>
            )}

            {/* פס חלון הטריות: המסילה היא כל אורך החיים, המלבן הירוק הוא הטווח, הסמן הוא היום */}
            {bagAge !== null && (() => {
              const scaleMax = Math.max(bagAge, freshWindow.to) * 1.15;
              const pct = (n: number) => `${(n / scaleMax) * 100}%`;
              const past = bagAge > freshWindow.to;
              return (
                <div className="fresh-bar">
                  <FreshTrack
                    windowStart={pct(freshWindow.from)}
                    windowWidth={pct(freshWindow.to - freshWindow.from)}
                    todayAt={pct(bagAge)}
                  />
                  {/* "הטווח שלך" כשהוא נגזר מהיומן, "טווח מומלץ" כשזה החלון המקצועי —
                      אחרת המספר נראה חיצוני, בזמן שהוא בא מהשוטים של נאור עצמו */}
                  <span className="small fresh-label" style={{ color: past ? 'var(--warn)' : 'var(--good)' }}>
                    {agedClock ? `יום ${bagAge} מהפתיחה` : `יום ${bagAge}`}
                    {' · '}
                    {agedClock
                      ? `שימוש מיטבי עד ${freshWindow.to}`
                      : `${personalWindow ? 'הטווח שלך' : 'טווח מומלץ'} ${freshWindow.from}–${freshWindow.to}`}
                  </span>
                </div>
              );
            })()}

            {/* המרשם: מנה → עצור ב־ → בכוס, שלושה מספרים בגודל זהה */}
            <div className="recipe-row">
              <div className="recipe-num">
                <span className="recipe-label">מנה</span>
                <span className="recipe-value"><CountUp value={recommendation.doseGrams} /></span>
              </div>
              {recommendation.stopAtGrams !== null && (
                <>
                  <span className="recipe-arrow">→</span>
                  <div className="recipe-num">
                    <span className="recipe-label">עצור ב־</span>
                    <span className="recipe-value"><CountUp value={recommendation.stopAtGrams} /></span>
                  </div>
                </>
              )}
              <span className="recipe-arrow">→</span>
              <div className="recipe-tail">
                <div className="recipe-num">
                  <span className="recipe-label cup">בכוס</span>
                  <span className="recipe-value cup"><CountUp value={recommendation.yieldGrams} /></span>
                </div>
                <span className="recipe-unit">גרם</span>
              </div>
            </div>

            <div className="recipe-divider" />

            {/* שורת האימות: שלושת המשתנים שמאמתים את המרשם. הטחינה מודגשת רק כשהיא משתנה. */}
            <div className="verify-row">
              <div className="verify-tile">
                <span className="verify-label">שניות</span>
                <span className="verify-value">{recommendation.brewTimeSecMin}–{recommendation.brewTimeSecMax}</span>
              </div>
              <div className="verify-tile">
                <span className="verify-label">יחס</span>
                <span className="verify-value">1:{recommendation.ratio.toFixed(1)}</span>
              </div>
              {recommendation.grindSetting !== null && (
                /* key לפי ערך הטחינה: כשההמלצה מזיזה אותו React בונה את
                   האריח מחדש, וזה מריץ שוב את הבזק ה-tile-settle. בלי זה
                   האנימציה רצה פעם אחת בלבד, בטעינה הראשונה. */
                <div key={recommendation.grindSetting} className={`verify-tile${grindDelta !== 0 ? ' changed' : ''}`}>
                  <span className="verify-label">
                    טחינה{grindDelta !== 0 && ` ${grindDelta < 0 ? '‎↓' : '‎↑'}${Math.abs(grindDelta)}`}
                  </span>
                  <span className="verify-value">{recommendation.grindSetting}</span>
                </div>
              )}
            </div>

            <button className="btn block" onClick={() => navigate('new-shot')}>
              <CupIcon size={20} /> התחל שוט חדש
            </button>
            <details className="why-details" style={{ marginTop: 8 }}>
              {/* הניסוח הספציפי נשמר לרגע שבו הטחינה באמת זזה — אחרת "למה טחינה 6?"
                  שואל על שינוי שלא קרה. אותו תנאי שמדגיש את אריח הטחינה. */}
              <summary>
                {recommendation.grindSetting !== null && grindDelta !== 0
                  ? `למה טחינה ${recommendation.grindSetting}?`
                  : 'למה ההמלצה הזו?'}
                {' · '}{shortConfidence(recommendation.confidence)}
              </summary>
              {recommendation.reasons[0] && (
                <p className="muted small" style={{ margin: '0 0 4px' }}>
                  {recommendation.reasons[0].replace(/^🧠\s*/, '')}
                </p>
              )}
              <p className="muted small" style={{ margin: 0 }}>
                {confidenceLabel(recommendation.confidence, recommendation.basedOnShots)}
              </p>
            </details>
          </>
        ) : (
          <>
            <EmptyState
              icon={<CupIcon size={40} />}
              text="עדיין אין היסטוריה"
              hint="הוסף פולים והכן את השוט הראשון — ההמלצות יתחילו לזרום מיד."
            />
            <button className="btn block" onClick={() => navigate(beans.length ? 'new-shot' : 'beans')}>
              {beans.length ? <><CupIcon size={20} /> התחל שוט ראשון</> : <><BeanIcon size={19} /> הוסף פולים ראשונים</>}
            </button>
          </>
        )}
      </div>

      {/* סטטיסטיקה אישית */}
      <div className="card">
        <h2><TrendIcon size={20} /> הסטטיסטיקה שלי</h2>
        <div className="stat-grid cols-3">
          <StatTile value={<CountUp value={insights.shotCount} />} label="שוטים סה״כ" />
          <StatTile
            value={tightness ? <CountUp value={tightness.stdevSec} decimals={1} prefix="±" /> : '—'}
            label="פיזור ההכנה (שנ׳)"
          />
          <StatTile
            value={
              tightnessTrend
                ? <CountUp value={tightnessTrend.deltaSec} decimals={1} prefix={tightnessTrend.deltaSec > 0 ? '+' : ''} />
                : '—'
            }
            label={tightnessTrend && tightnessTrend.deltaSec < 0 ? 'מתהדק' : 'שינוי בפיזור'}
          />
        </div>
        {tightnessTrend && (
          <p className="small" style={{ marginTop: 10 }}>
            {tightnessTrend.deltaSec < -0.2
              ? `ההכנה שלך מתהדקת: הפיזור ירד מ-±${tightnessTrend.previous} ל-±${tightnessTrend.recent} שניות.`
              : tightnessTrend.deltaSec > 0.2
                ? `הפיזור גדל מ-±${tightnessTrend.previous} ל-±${tightnessTrend.recent} שניות — שווה לחזור לבסיסי הפאק.`
                : `הפיזור יציב סביב ±${tightnessTrend.recent} שניות.`}
          </p>
        )}
        {repeatability && (
          <p className="small" style={{ marginTop: 6 }}>
            <b>{repeatability.shots} שוטים</b> על טחינה {repeatability.grindSetting} ומנה{' '}
            {repeatability.doseGrams} גרם — אותן הגדרות בדיוק — נפרשו על{' '}
            <b>{repeatability.spreadSec} שניות</b>
            {repeatability.ageAdjusted ? ' (אחרי נטרול הזדקנות הפולים)' : ''}.{' '}
            {repeatability.spreadSec >= 6
              ? 'את הפער הזה לא גרמו ההגדרות ולא הפולים — הוא ההכנה.'
              : 'זה הפיזור הטבעי שלך. כל שיפור מכאן מגיע מהפאק, לא מהמספרים.'}
          </p>
        )}
        {agingSlope?.measured && (
          <p className="muted small" style={{ marginTop: 6 }}>
            {agingSlope.meaningful
              ? `הפולים בשקית הזו מזיזים את הזמן ב-${Math.abs(agingSlope.secPerDay)} שניות ליום${agingSlope.secPerDay < 0 ? ' כלפי מטה' : ' כלפי מעלה'} סביב יום ${activeBagAge}. זה הגזים, לא אתה.`
              : 'הזמן בשקית הזו לא נודד עם הגיל — הגזים כבר יצאו. כל שינוי בזמן הוא ההכנה.'}
          </p>
        )}
        {trend.direction !== 'insufficient' && (
          <p className="muted small" style={{ marginTop: 10, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            {trend.direction === 'up' && <><TrendIcon size={17} strokeWidth={2} /> <span>מגמת שיפור! הדירוג הממוצע עלה מ-{trend.previousAvg.toFixed(1)} ל-{trend.recentAvg.toFixed(1)} בשוטים האחרונים.</span></>}
            {trend.direction === 'down' && <><TrendDownIcon size={17} strokeWidth={2} /> <span>שים לב: הדירוג הממוצע ירד מ-{trend.previousAvg.toFixed(1)} ל-{trend.recentAvg.toFixed(1)}. אולי הפולים מתיישנים או שהמכונה צריכה ניקוי?</span></>}
            {trend.direction === 'stable' && <span>יציבות: הדירוג הממוצע שלך נשאר סביב {trend.recentAvg.toFixed(1)} — עקביות היא שם המשחק.</span>}
          </p>
        )}
      </div>

      {/* פולים אחרונים */}
      {recentBeanIds.length > 0 && (
        <div className="card">
          <h2><BeanIcon size={20} /> הפולים האחרונים שלי</h2>
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
          <h2><SoapIcon size={20} /> תחזוקה</h2>
          <div className="stat-grid cols-3">
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

// תווית ביטחון קצרה ל-summary של "למה?" — הניסוח המלא נשאר בתוך הפירוט
function shortConfidence(c: 'rules' | 'low' | 'medium' | 'high'): string {
  switch (c) {
    case 'rules': return 'כללים מקצועיים';
    case 'low': return 'ביטחון נמוך';
    case 'medium': return 'ביטחון בינוני';
    case 'high': return 'ביטחון גבוה';
  }
}

function shortMaintLabel(kind: string): string {
  switch (kind) {
    case 'machine-backflush': return 'שטיפת מכונה';
    case 'machine-descale': return 'ניקוי אבנית';
    case 'grinder-clean': return 'ניקוי מטחנה';
    default: return kind;
  }
}
