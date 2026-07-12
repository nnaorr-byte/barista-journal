import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { grinderRepo, machineRepo, maintenanceRepo, userRepo, wipeAllData } from '../db/repositories';
import type { Grinder, GrinderType, Machine } from '../domain/types';
import { seedIfEmpty } from '../db/database';
import { MAINTENANCE_RULES, computeMaintenanceStatus } from '../services/maintenance';
import { exportBackup, exportCsv, exportExcel, getLastBackupAt, restoreBackup, shareBackup } from '../services/importExport';
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
      <EquipmentCard machines={machines} grinders={grinders} userId={user.id} />


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
        <button
          className="btn block"
          onClick={async () => {
            const result = await shareBackup();
            if (result === 'shared') setMessage('✅ הגיבוי שותף בהצלחה!');
            else if (result === 'fallback') setMessage('✅ קובץ הגיבוי ירד למכשיר!');
          }}
        >
          💾 גבה ושתף (וואטסאפ / מייל)
        </button>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>
          {getLastBackupAt()
            ? `גיבוי אחרון: ${formatDate(getLastBackupAt())}`
            : 'עוד לא בוצע גיבוי במכשיר הזה.'}
        </p>
        <div className="btn-row">
          <button className="btn secondary" onClick={() => exportCsv(shots, beans)}>
            📄 ייצוא CSV
          </button>
          <button className="btn secondary" onClick={() => exportExcel(shots, beans)}>
            📊 ייצוא Excel
          </button>
          <button className="btn secondary" onClick={async () => { await exportBackup(); setMessage('✅ קובץ הגיבוי ירד למכשיר!'); }}>
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
        יומן בריסטה חכם · הנתונים נשמרים מקומית במכשיר שלך בלבד
      </p>
    </div>
  );
}

// ===== ניהול ציוד: מכונות ומטחנות =====
function EquipmentCard({ machines, grinders, userId }: {
  machines: Machine[];
  grinders: Grinder[];
  userId: string;
}) {
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [editingGrinder, setEditingGrinder] = useState<Grinder | null>(null);
  const [addingGrinder, setAddingGrinder] = useState(false);
  const [addingMachine, setAddingMachine] = useState(false);
  const [msg, setMsg] = useState('');

  async function removeGrinder(g: Grinder) {
    const result = await grinderRepo.removeIfUnused(g.id);
    if (result === 'in-use') setMsg(`אי אפשר למחוק את "${g.name}" — יש שוטים שתועדו איתה. ההיסטוריה שלך חשובה!`);
    else if (result === 'last-one') setMsg('חייבת להישאר מטחנה אחת לפחות.');
    else setMsg(`"${g.name}" נמחקה.`);
  }

  async function removeMachine(m: Machine) {
    const result = await machineRepo.removeIfUnused(m.id);
    if (result === 'in-use') setMsg(`אי אפשר למחוק את "${m.name}" — יש שוטים שתועדו איתה.`);
    else if (result === 'last-one') setMsg('חייבת להישאר מכונה אחת לפחות.');
    else setMsg(`"${m.name}" נמחקה.`);
  }

  return (
    <div className="card">
      <h2>🛠️ הציוד שלי</h2>

      <h3 style={{ marginTop: 4 }}>מכונות אספרסו</h3>
      {machines.map((m) => (
        <div key={m.id} className="shot-item" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <strong>{m.name}</strong>
            {m.isDefault && <span className="badge accent" style={{ marginInlineStart: 6 }}>ברירת מחדל</span>}
            <div className="muted small">פורטפילטרים: {m.portafilterTypes.join(', ')}</div>
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            {!m.isDefault && (
              <button className="btn small secondary" onClick={() => machineRepo.setDefault(m.id)}>ברירת מחדל</button>
            )}
            <button className="btn small secondary" aria-label={`עריכת ${m.name}`} onClick={() => setEditingMachine(m)}>✏️</button>
            {machines.length > 1 && (
              <button className="btn small danger" aria-label={`מחיקת ${m.name}`} onClick={() => removeMachine(m)}>🗑️</button>
            )}
          </div>
        </div>
      ))}
      {editingMachine && (
        <MachineForm
          initial={editingMachine}
          onClose={() => setEditingMachine(null)}
          onSave={async (name, portafilters) => {
            await machineRepo.put({ ...editingMachine, name, portafilterTypes: portafilters });
            setEditingMachine(null);
          }}
        />
      )}
      {addingMachine ? (
        <MachineForm
          onClose={() => setAddingMachine(false)}
          onSave={async (name, portafilters) => {
            await machineRepo.create({
              userId, name, brand: '', model: '', defaultTemp: 'medium',
              portafilterTypes: portafilters, accessories: [],
            });
            setAddingMachine(false);
          }}
        />
      ) : (
        <button className="btn small secondary" onClick={() => setAddingMachine(true)}>➕ מכונה חדשה</button>
      )}

      <hr className="sep" />
      <h3 style={{ marginTop: 0 }}>מטחנות</h3>
      {grinders.map((g) => (
        <div key={g.id} className="shot-item" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            {g.name} <span className="muted small">({g.type === 'manual' ? 'ידנית' : 'חשמלית'} · סקאלה {g.scaleMin}–{g.scaleMax})</span>
            {g.isDefault && <span className="badge accent" style={{ marginInlineStart: 6 }}>ברירת מחדל</span>}
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            {!g.isDefault && (
              <button className="btn small secondary" onClick={() => grinderRepo.setDefault(g.id)}>ברירת מחדל</button>
            )}
            <button className="btn small secondary" aria-label={`עריכת ${g.name}`} onClick={() => setEditingGrinder(g)}>✏️</button>
            {grinders.length > 1 && (
              <button className="btn small danger" aria-label={`מחיקת ${g.name}`} onClick={() => removeGrinder(g)}>🗑️</button>
            )}
          </div>
        </div>
      ))}
      {editingGrinder && (
        <GrinderForm
          initial={editingGrinder}
          onClose={() => setEditingGrinder(null)}
          onSave={async (fields) => {
            await grinderRepo.put({ ...editingGrinder, ...fields });
            setEditingGrinder(null);
          }}
        />
      )}
      {addingGrinder ? (
        <GrinderForm
          onClose={() => setAddingGrinder(false)}
          onSave={async (fields) => {
            await grinderRepo.create({ userId, ...fields });
            setAddingGrinder(false);
          }}
        />
      ) : (
        <button className="btn small secondary" onClick={() => setAddingGrinder(true)}>➕ מטחנה חדשה</button>
      )}

      {msg && <p className="small" style={{ marginTop: 10 }}>{msg}</p>}
      <p className="muted small" style={{ marginTop: 10 }}>
        דרגות הטחינה ביומן נשמרות ביחס למטחנה שנבחרה בכל שוט — לכל מטחנה סקאלה משלה.
      </p>
    </div>
  );
}

function MachineForm({ initial, onSave, onClose }: {
  initial?: Machine;
  onSave: (name: string, portafilters: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [portafilters, setPortafilters] = useState((initial?.portafilterTypes ?? ['Bottomless', 'Standard']).join(', '));
  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 12, margin: '8px 0' }}>
      <Field label="שם המכונה">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: DeLonghi EC685" />
      </Field>
      <Field label="סוגי פורטפילטר (מופרדים בפסיק)">
        <input value={portafilters} onChange={(e) => setPortafilters(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn small secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn small" disabled={!name.trim()}
          onClick={() => onSave(name.trim(), portafilters.split(',').map((p) => p.trim()).filter(Boolean))}
        >
          💾 שמירה
        </button>
      </div>
    </div>
  );
}

function GrinderForm({ initial, onSave, onClose }: {
  initial?: Grinder;
  onSave: (fields: { name: string; type: GrinderType; scaleMin: number; scaleMax: number; scaleStep: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<GrinderType>(initial?.type ?? 'electric');
  const [scaleMin, setScaleMin] = useState(String(initial?.scaleMin ?? 0));
  const [scaleMax, setScaleMax] = useState(String(initial?.scaleMax ?? 40));
  const [scaleStep, setScaleStep] = useState(String(initial?.scaleStep ?? 1));
  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 12, margin: '8px 0' }}>
      <div className="field-row">
        <Field label="שם המטחנה">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: Timemore C2" />
        </Field>
        <Field label="סוג">
          <select value={type} onChange={(e) => setType(e.target.value as GrinderType)}>
            <option value="manual">ידנית</option>
            <option value="electric">חשמלית</option>
          </select>
        </Field>
      </div>
      <div className="field-row thirds">
        <Field label="סקאלה — מינימום">
          <input type="number" value={scaleMin} onChange={(e) => setScaleMin(e.target.value)} />
        </Field>
        <Field label="מקסימום">
          <input type="number" value={scaleMax} onChange={(e) => setScaleMax(e.target.value)} />
        </Field>
        <Field label="קפיצת דרגה">
          <input type="number" step="0.1" value={scaleStep} onChange={(e) => setScaleStep(e.target.value)} />
        </Field>
      </div>
      <div className="btn-row">
        <button className="btn small secondary" onClick={onClose}>ביטול</button>
        <button
          className="btn small" disabled={!name.trim()}
          onClick={() => onSave({
            name: name.trim(), type,
            scaleMin: parseFloat(scaleMin) || 0,
            scaleMax: parseFloat(scaleMax) || 40,
            scaleStep: parseFloat(scaleStep) || 1,
          })}
        >
          💾 שמירה
        </button>
      </div>
    </div>
  );
}
