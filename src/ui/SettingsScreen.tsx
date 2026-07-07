import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { grinderRepo, maintenanceRepo, userRepo, wipeAllData } from '../db/repositories';
import { seedIfEmpty } from '../db/database';
import { MAINTENANCE_RULES, computeMaintenanceStatus } from '../services/maintenance';
import { exportBackup, exportCsv, exportExcel, restoreBackup } from '../services/importExport';
import { Field } from './components';
import { formatDate } from './labels';

export function SettingsScreen() {
  const data = useLiveQuery(async () => {
    const [user, machines, grinders, events, shots, beans] = await Promise.all([
      db.users.toArray().then((u) => u[0]),
      db.machines.toArray(),
      db.grinders.toArray(),
      db.maintenanceEvents.toArray(),
      db.shots.orderBy('createdAt').reverse().toArray(),
      db.beans.toArray(),
    ]);
    return { user, machines, grinders, events, shots, beans };
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  if (!data?.user) return null;
  const { user, machines, grinders, events, shots, beans } = data;
  const maintenance = computeMaintenanceStatus(events);

  return (
    <div>
      {/* פרופיל */}
      <div className="card">
        <h2>👤 הפרופיל שלי</h2>
        <div className="field-row thirds">
          <Field label="מנה ברירת מחדל (גרם)">
            <input
              type="number" step="0.1" defaultValue={user.defaultDoseGrams}
              onBlur={(e) => userRepo.update({ ...user, defaultDoseGrams: parseFloat(e.target.value) || 16 })}
            />
          </Field>
          <Field label="טווח מינימום">
            <input
              type="number" step="0.1" defaultValue={user.doseRangeMin}
              onBlur={(e) => userRepo.update({ ...user, doseRangeMin: parseFloat(e.target.value) || 15.8 })}
            />
          </Field>
          <Field label="טווח מקסימום">
            <input
              type="number" step="0.1" defaultValue={user.doseRangeMax}
              onBlur={(e) => userRepo.update({ ...user, doseRangeMax: parseFloat(e.target.value) || 16.5 })}
            />
          </Field>
        </div>
      </div>

      {/* ציוד */}
      <div className="card">
        <h2>🛠️ הציוד שלי</h2>
        {machines.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <strong>{m.name}</strong>
            <div className="muted small">
              פורטפילטרים: {m.portafilterTypes.join(', ')} · אביזרים: {m.accessories.join(', ')}
            </div>
          </div>
        ))}
        <hr className="sep" />
        <h3 style={{ marginTop: 0 }}>מטחנות</h3>
        {grinders.map((g) => (
          <div key={g.id} className="shot-item" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              {g.name} <span className="muted small">({g.type === 'manual' ? 'ידנית' : 'חשמלית'})</span>
              {g.isDefault && <span className="badge accent">ברירת מחדל</span>}
            </div>
            {!g.isDefault && (
              <button className="btn small secondary" onClick={() => grinderRepo.setDefault(g.id)}>
                הפוך לברירת מחדל
              </button>
            )}
          </div>
        ))}
      </div>

      {/* תחזוקה */}
      <div className="card">
        <h2>🧼 תיעוד תחזוקה</h2>
        {maintenance.map((m) => (
          <div key={m.rule.kind} className="shot-item" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              <div>{m.rule.label}</div>
              <div className="muted small">
                {m.lastPerformed
                  ? `בוצע לאחרונה: ${formatDate(m.lastPerformed)} (לפני ${m.daysAgo} ימים)`
                  : 'לא תועד עדיין'}
                {' · '}מומלץ כל {m.rule.intervalDays} ימים
              </div>
            </div>
            <button
              className="btn small"
              onClick={() => {
                const rule = MAINTENANCE_RULES.find((r) => r.kind === m.rule.kind)!;
                const machine = machines[0];
                const grinder = grinders.find((g) => g.isDefault) ?? grinders[0];
                maintenanceRepo.log({
                  userId: user.id,
                  kind: rule.kind,
                  equipmentId: rule.kind === 'grinder-clean' ? grinder.id : machine.id,
                  performedAt: new Date().toISOString(),
                  notes: '',
                });
              }}
            >
              ✔ בוצע עכשיו
            </button>
          </div>
        ))}
      </div>

      {/* ייצוא וגיבוי */}
      <div className="card">
        <h2>📦 ייצוא וגיבוי</h2>
        <div className="btn-row">
          <button className="btn secondary" onClick={() => exportCsv(shots, beans)}>
            📄 ייצוא CSV
          </button>
          <button className="btn secondary" onClick={() => exportExcel(shots, beans)}>
            📊 ייצוא Excel
          </button>
          <button className="btn secondary" onClick={() => exportBackup()}>
            💾 גיבוי מלא (JSON)
          </button>
        </div>
        <hr className="sep" />
        <h3 style={{ marginTop: 0 }}>שחזור מגיבוי</h3>
        <p className="muted small">שחזור מחליף את כל הנתונים הקיימים בנתוני הגיבוי.</p>
        <input
          ref={fileRef} type="file" accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!confirm('שחזור ימחק את הנתונים הנוכחיים ויחליף אותם בגיבוי. להמשיך?')) {
              e.target.value = '';
              return;
            }
            const result = await restoreBackup(file);
            setMessage(result.ok ? '✅ הגיבוי שוחזר בהצלחה!' : `❌ ${result.error}`);
            e.target.value = '';
          }}
        />
        {message && <p className="small" style={{ marginTop: 8 }}>{message}</p>}
      </div>

      {/* אזור מסוכן */}
      <div className="card warn">
        <h2>⚠️ אזור מסוכן</h2>
        <p className="muted small">מחיקת כל ההיסטוריה — כל השוטים, הפולים והתיעודים. מומלץ לגבות קודם.</p>
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm('למחוק את כל ההיסטוריה? הפעולה בלתי הפיכה!')) return;
            if (!confirm('בטוח בטוח? זו ההזדמנות האחרונה לבטל.')) return;
            await wipeAllData();
            await seedIfEmpty();
            setMessage('כל הנתונים נמחקו. פרופיל הציוד נוצר מחדש.');
          }}
        >
          🗑️ מחיקת כל ההיסטוריה
        </button>
      </div>

      <p className="muted small" style={{ textAlign: 'center' }}>
        יומן בריסטה חכם · גרסה 1.0 · הנתונים נשמרים מקומית במכשיר שלך בלבד
      </p>
    </div>
  );
}
