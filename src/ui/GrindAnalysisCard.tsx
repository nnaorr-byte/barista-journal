import { useMemo } from 'react';
import type { Bag, Bean, Grinder, Shot } from '../domain/types';
import { analyzeGrind } from '../services/grindAnalysis';
import { makePersonalWindowResolver } from '../services/targetWindow';
import { ScatterChart } from './charts';
import { CountUp, EmptyState, StatTile } from './components';
import { formatDateTime, shotWeights } from './labels';
import { BulbIcon, GearIcon, TargetIcon, TimerIcon, TrophyIcon } from './icons';

// ===== ניתוח טחינה =====
// כרטיס אחד לכל השאלה "מה הטחינה תרמה בפולים האלה": טבלת הדרגות, שער
// ההמרה בין צעד טחינה לשניות, מי טובה יותר (או שאין הכרעה), השוט הטוב
// ביותר, והמסקנה. החישוב כולו ב-services/grindAnalysis.ts.
//
// beanId ריק = "כל הפולים יחד" במסנן. השוואת טחינה בין זני פולים שונים
// חסרת משמעות — לכל זן קיר דק אחר וחלון זמן אחר — ולכן נעצרים כאן.
export function GrindAnalysisCard({ beanId, shots, bags, beans, grinders }: {
  beanId: string;
  shots: Shot[];
  bags: Bag[];
  beans: Bean[];
  grinders: Grinder[];
}) {
  const analysis = useMemo(() => {
    if (!beanId) return null;
    const beanShots = shots.filter((s) => s.beanId === beanId);
    return analyzeGrind({
      rawShots: beanShots,
      bags,
      bean: beans.find((b) => b.id === beanId),
      grinders,
      resolveWindow: makePersonalWindowResolver(beans, bags, shots),
    });
  }, [beanId, shots, bags, beans, grinders]);

  if (!beanId) {
    return (
      <div className="card">
        <h2><GearIcon size={20} /> ניתוח טחינה</h2>
        <EmptyState
          icon={<GearIcon size={40} />}
          text="בחר פולים בודדים כדי לנתח טחינה"
          hint="לכל זן פולים קיר דק אחר וחלון זמן אחר — השוואת דרגות טחינה בין זנים שונים לא אומרת כלום."
        />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="card">
        <h2><GearIcon size={20} /> ניתוח טחינה</h2>
        <EmptyState
          icon={<GearIcon size={40} />}
          text="עדיין לא שינית טחינה בפולים האלה"
          hint="הניתוח מתעורר מהרגע שיש שתי דרגות טחינה שונות להשוות ביניהן."
        />
      </div>
    );
  }

  const { rows, time, verdict, best, sweetSpot, winningTime, floor, conclusions, beanName, totalShots } = analysis;

  const scatter = shots
    .filter((s) => s.beanId === beanId && s.grindSetting > 0 && s.brewTimeSec > 0 && !s.excluded && !s.choked)
    .map((s) => ({
      x: s.grindSetting,
      y: s.brewTimeSec,
      highlight: s.rating >= 8,
      label: `טחינה ${s.grindSetting}: ${s.brewTimeSec} שניות · דירוג ${s.rating}`,
    }));

  return (
    <>
      <div className="card">
        <h2><GearIcon size={20} /> ניתוח טחינה — {beanName}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {totalShots} שוטים ברי-ניתוח על {rows.length} דרגות טחינה, מכל השקיות של הפולים האלה.
          זמן העצירה בטבלה הוא מה שנמדד בפועל — ממוצע כשיש כמה שוטים על אותה דרגה.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>טחינה</th>
                <th>שוטים</th>
                <th>דירוג</th>
                <th>זמן עצירה</th>
                <th>יחס</th>
                <th>בחלון</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.grindSetting}>
                  <th style={{ whiteSpace: 'nowrap' }}>
                    {r.grindSetting}
                    {r.isCurrent && <span className="badge accent" style={{ marginInlineStart: 6 }}>עכשיו</span>}
                    {floor !== null && r.grindSetting <= floor
                      && <span className="badge warn" style={{ marginInlineStart: 6 }}>נחנק</span>}
                  </th>
                  <td>{r.shots}</td>
                  <td style={{ fontWeight: 700 }}>{r.avgRating.toFixed(1)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.avgTimeSec !== null ? `${r.avgTimeSec.toFixed(1)}s` : '—'}
                    {/* טווח, כדי ששוט בודד לא ייראה כמו ממוצע ושפיזור לא ייעלם בממוצע */}
                    {r.minTimeSec !== null && r.maxTimeSec !== null && r.minTimeSec !== r.maxTimeSec && (
                      <span className="muted small" style={{ display: 'block' }}>
                        {r.minTimeSec}–{r.maxTimeSec}
                      </span>
                    )}
                  </td>
                  <td>{r.avgRatio !== null ? `1:${r.avgRatio.toFixed(1)}` : '—'}</td>
                  <td>{r.inTargetPct !== null ? `${r.inTargetPct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          המספר הקטן מתחת לזמן הוא הטווח בפועל — הכי מהיר עד הכי איטי על אותה דרגה.
          "בחלון" = אחוז השוטים שנחתו גם בזמן היעד של הפולים האלה וגם בדירוג 8+. הוא מפריד
          טוב יותר מהדירוג לבדו, כי הדירוגים שלך דחוסים בקצה העליון.
        </p>
      </div>

      {/* מי טובה יותר — או שאין הכרעה */}
      {verdict && (
        <div className={`card${verdict.decisive ? ' accent' : ''}`}>
          <h2><TrophyIcon size={20} /> {verdict.decisive ? `הדרגה שעבדה: ${verdict.best}` : 'אין הכרעה בין הדרגות'}</h2>
          <div className="stat-grid cols-3">
            <StatTile value={<CountUp value={verdict.best} />} label="מובילה בדירוג" />
            <StatTile value={<CountUp value={verdict.deltaRating} decimals={1} />} label={`פער מ-${verdict.other}`} />
            <StatTile value={<CountUp value={verdict.se} decimals={1} />} label="שגיאת המדידה" />
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            {verdict.decisive
              ? `הפער גדול מפי שניים משגיאת המדידה — הוא לא צירוף מקרים.`
              : `כדי להכריז על מנצחת צריך פער של לפחות ${(2 * verdict.se).toFixed(1)} נקודות (פי שניים משגיאת המדידה) וגם 0.4 לפחות. כאן הוא ${verdict.deltaRating.toFixed(1)}.`}
          </p>
        </div>
      )}

      {/* שער ההמרה: צעד טחינה → שניות */}
      {time && (
        <div className="card">
          <h2><TimerIcon size={20} /> מה הטחינה עושה לזמן</h2>
          {time.meaningful ? (
            <div className="stat-grid cols-3">
              <StatTile
                value={<CountUp value={time.secPerStep} decimals={1} prefix={time.secPerStep > 0 ? '+' : ''} suffix="s" />}
                label="לכל צעד טחינה"
              />
              <StatTile value={<CountUp value={Math.abs(time.r)} decimals={2} />} label="חוזק הקשר" />
              <StatTile value={<CountUp value={time.shots} />} label="שוטים במדידה" />
            </div>
          ) : (
            <p className="small" style={{ color: 'var(--warn)' }}>
              הקשר בין הטחינה לזמן עדיין לא יוצא מהרעש — {time.shots} שוטים, מתאם {Math.abs(time.r).toFixed(2)}.
            </p>
          )}
          {scatter.length >= 2 && (
            <>
              <ScatterChart points={scatter} xLabel="דרגת טחינה" yLabel="זמן חליטה (שנ')" />
              <p className="muted small">
                ● מלא = שוט מצוין (8+) · ○ מתאר = השאר. שיפוע ברור משמאל לימין הוא הטחינה;
                עמודה מפוזרת על דרגה אחת היא ההכנה.
              </p>
            </>
          )}
        </div>
      )}

      {/* זמן החילוץ המנצח — משווה רצועות זמן לפי הדירוג שהן מייצרות */}
      {winningTime && (
        <div className={`card${winningTime.decisive ? ' accent' : ''}`}>
          <h2><TimerIcon size={20} /> זמן החילוץ המנצח</h2>
          <div className="stat-grid cols-3">
            {/* טווח = שני מספרים, ולכן שתי ספירות. הקו ביניהם נשאר במקומו */}
            <StatTile
              value={<><CountUp value={winningTime.best.from} />–<CountUp value={winningTime.best.to} suffix="s" /></>}
              label="רצועת הזמן"
            />
            <StatTile value={<CountUp value={winningTime.best.avgRating} decimals={1} />} label="דירוג ממוצע" />
            <StatTile value={<CountUp value={winningTime.best.grindMode} />} label="הטחינה שם" />
          </div>

          {winningTime.bands.length > 1 && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>זמן חילוץ</th>
                    <th>שוטים</th>
                    <th>דירוג</th>
                    <th>טחינה</th>
                  </tr>
                </thead>
                <tbody>
                  {winningTime.bands.map((b) => (
                    <tr key={`${b.from}-${b.to}`}>
                      <th style={{ whiteSpace: 'nowrap' }}>
                        {b.from}–{b.to}s
                        {b === winningTime.best && winningTime.decisive
                          && <span className="badge accent" style={{ marginInlineStart: 6 }}>מנצחת</span>}
                      </th>
                      <td>{b.shots}</td>
                      <td style={{ fontWeight: 700 }}>{b.avgRating.toFixed(1)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {b.grindMin === b.grindMax ? b.grindMin : `${b.grindMin}–${b.grindMax}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted small" style={{ marginTop: 10 }}>
            {winningTime.decisive
              ? `הפער מהרצועה הבאה הוא ${winningTime.delta.toFixed(1)} נקודות, גדול מפי שניים משגיאת המדידה (${winningTime.se.toFixed(1)}) — זו רצועת זמן אמיתית ולא מקרה.`
              : winningTime.runnerUp
                ? `הפער מהרצועה הבאה הוא ${winningTime.delta.toFixed(1)} נקודות בלבד, בתוך טווח השגיאה (${winningTime.se.toFixed(1)}). הרצועה מובילה, אבל עדיין לא מוכחת.`
                : 'כל השוטים שלך ברצועת זמן אחת — אין רצועה שנייה להשוות אליה.'}
            {' '}הרצועות נגזרות מטווח הזמנים שלך בפועל, לא מסולם קבוע.
          </p>
        </div>
      )}

      {/* האזור המנצח — טווח טחינה וזמן, לא נקודה אחת */}
      {sweetSpot && (
        <div className="card">
          <h2><TargetIcon size={20} /> איפה יצאו השוטים הכי טובים</h2>
          <div className="stat-grid cols-3">
            <StatTile
              value={sweetSpot.grindMin === sweetSpot.grindMax
                ? <CountUp value={sweetSpot.grindMin} />
                : <><CountUp value={sweetSpot.grindMin} />–<CountUp value={sweetSpot.grindMax} /></>}
              label="טווח טחינה"
            />
            <StatTile
              value={sweetSpot.timeMin === sweetSpot.timeMax
                ? <CountUp value={sweetSpot.timeMin} suffix="s" />
                : <><CountUp value={sweetSpot.timeMin} />–<CountUp value={sweetSpot.timeMax} suffix="s" /></>}
              label="טווח זמן עצירה"
            />
            <StatTile value={<CountUp value={sweetSpot.shots} />} label={`שוטים ${sweetSpot.minRating}+`} />
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            רוב השוטים הטובים נחתו על טחינה <b>{sweetSpot.grindMode}</b>, בזמן עצירה ממוצע של{' '}
            <b>{sweetSpot.timeAvg} שניות</b>. זה היעד — לא מספר בודד אלא חלון שאתה כבר יודע לפגוע בו.
          </p>
        </div>
      )}

      {/* השוט הטוב ביותר */}
      {best && (
        <div className="card">
          <h2><TrophyIcon size={20} /> השוט הטוב ביותר בפולים האלה</h2>
          <p style={{ margin: '4px 0' }}>
            <strong>{best.shot.rating}/10</strong> · טחינה {best.shot.grindSetting} ·{' '}
            {shotWeights(best.shot)} ב-{best.shot.brewTimeSec} שניות
          </p>
          <p className="muted small">
            {formatDateTime(best.shot.createdAt)}
            {best.roastAge !== null && ` · יום ${best.roastAge} מהקלייה`}
          </p>
        </div>
      )}

      {/* המסקנה */}
      {conclusions.length > 0 && (
        <div className="card">
          <h2><BulbIcon size={20} /> המסקנה</h2>
          {conclusions.map((c, i) => (
            <p key={i} className="small" style={{ margin: '6px 0' }}>{c}</p>
          ))}
        </div>
      )}
    </>
  );
}
