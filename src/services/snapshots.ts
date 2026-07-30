import { db, newId } from '../db/database';
import type { DataSnapshot } from '../domain/types';
import { applyBackup, buildBackupObject, type BackupFile } from './importExport';

// ============================================================
// תמונות מצב אוטומטיות — רשת הביטחון הפנימית
// ============================================================
// עותק מלא של כל הטבלאות, נשמר בתוך ה-IndexedDB עצמו, בלי שום מגע.
//
// מה זה מציל: מחיקת שקית/פולים בטעות, שחזור מגיבוי ישן, "מחק את כל
// הנתונים" בהגדרות, באג שהשחית רשומות.
// מה זה *לא* מציל: "נקה נתוני אתר", מחיקת האפליקציה, איפוס המכשיר —
// כל אלה מוחקים את ה-IndexedDB כולו, ואיתו גם את תמונות המצב.
// לכן זו שכבה אחת משתיים; השנייה היא הגיבוי החיצוני (importExport).

const INTERVAL_DAYS = 3;
const KEEP = 5;

export type SnapshotMeta = Omit<DataSnapshot, 'payload'>;

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const rows = await db.snapshots.toArray();
  return rows
    .map(({ payload: _payload, ...meta }) => meta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createSnapshot(): Promise<SnapshotMeta> {
  const backup = await buildBackupObject();
  const payload = JSON.stringify(backup);
  const snap: DataSnapshot = {
    id: newId(),
    createdAt: backup.exportedAt,
    shotCount: (backup.tables.shots ?? []).length,
    // אורך המחרוזת ולא byteLength: קירוב טוב מספיק לתצוגה, בלי TextEncoder
    sizeBytes: payload.length,
    payload,
  };
  await db.snapshots.add(snap);
  await rotate();
  const { payload: _drop, ...meta } = snap;
  return meta;
}

// שמירה על KEEP האחרונות. מחיקה בבת אחת ולא בלולאה — פחות טרנזקציות.
async function rotate(): Promise<void> {
  const all = await db.snapshots.toArray();
  if (all.length <= KEEP) return;
  const stale = all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(KEEP)
    .map((s) => s.id);
  await db.snapshots.bulkDelete(stale);
}

// נקראת בעליית האפליקציה. לא מצלמת כשאין מה לצלם, וגם לא כשהמצב לא
// השתנה מאז התמונה האחרונה — אחרת חמש התמונות היו מתמלאות בעותקים זהים
// של אותו יום, ורשת הביטחון הייתה מכסה שלושה ימים במקום שבועיים.
export async function autoSnapshot(): Promise<SnapshotMeta | null> {
  try {
    const shotCount = await db.shots.count();
    if (shotCount === 0) return null;

    const all = await db.snapshots.toArray();
    const newest = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    if (newest) {
      const ageDays = (Date.now() - new Date(newest.createdAt).getTime()) / 86_400_000;
      if (ageDays < INTERVAL_DAYS) return null;
      const newShots = await db.shots.where('createdAt').above(newest.createdAt).count();
      if (newShots === 0) return null;
    }
    return await createSnapshot();
  } catch {
    // תמונת מצב שנכשלה (מכסת אחסון, DB נעול) לא מפילה את עליית האפליקציה
    return null;
  }
}

export async function restoreSnapshot(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const snap = await db.snapshots.get(id);
    if (!snap) return { ok: false, error: 'תמונת המצב לא נמצאה.' };
    // תמונה של המצב הנוכחי לפני הדריסה — גם שחזור צריך דרך חזרה.
    // לא מצלמים מצב ריק: אין לו מה להציל, והוא היה תופס מקום ב-KEEP.
    if ((await db.shots.count()) > 0) await createSnapshot();
    await applyBackup(JSON.parse(snap.payload) as BackupFile);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `השחזור נכשל: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id);
}

export function formatSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
