import { db } from '../db/database';
import { shotRatio, shotFlowRate, type Bean, type Shot } from '../domain/types';

// ייצוא CSV / Excel / גיבוי JSON מלא + שחזור.

const SHOT_HEADERS = [
  'תאריך', 'פולים', 'גרם נכנס', 'גרם יוצא', 'יחס', 'זמן (שניות)', 'זרימה (גרם/שניה)',
  'טחינה', 'טמפרטורה', 'סלסלה', 'פורטפילטר', 'טעמים', 'Body', 'Crema', 'Aftertaste',
  'דירוג', 'הערות',
];

function shotRows(shots: Shot[], beans: Map<string, Bean>): (string | number)[][] {
  return shots.map((s) => [
    new Date(s.createdAt).toLocaleString('he-IL'),
    beans.get(s.beanId)?.name ?? '',
    s.doseGrams,
    s.yieldGrams,
    Number(shotRatio(s).toFixed(2)),
    s.brewTimeSec,
    Number(shotFlowRate(s).toFixed(2)),
    s.grindSetting,
    s.machineTemp,
    s.basketType,
    s.portafilterType,
    [...s.tasteTags, s.tasteOther].filter(Boolean).join(', '),
    s.body ?? '',
    s.crema ?? '',
    s.aftertaste ?? '',
    s.rating,
    s.notes,
  ]);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportCsv(shots: Shot[], beans: Bean[]): Promise<void> {
  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const rows = [SHOT_HEADERS, ...shotRows(shots, beanMap)];
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  // BOM כדי ש-Excel יזהה עברית ב-UTF-8
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `barista-journal-${stamp()}.csv`);
}

export async function exportExcel(shots: Shot[], beans: Bean[]): Promise<void> {
  // טעינה עצלה — הספרייה כבדה ונחוצה רק בייצוא
  const XLSX = await import('xlsx');
  const beanMap = new Map(beans.map((b) => [b.id, b]));
  const ws = XLSX.utils.aoa_to_sheet([SHOT_HEADERS, ...shotRows(shots, beanMap)]);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'Shots');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `barista-journal-${stamp()}.xlsx`,
  );
}

interface BackupFile {
  app: 'barista-journal';
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<void> {
  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    tables[table.name] = await table.toArray();
  }
  const backup: BackupFile = {
    app: 'barista-journal',
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
  download(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    `barista-journal-backup-${stamp()}.json`,
  );
}

export async function restoreBackup(file: File): Promise<{ ok: boolean; error?: string }> {
  try {
    const text = await file.text();
    const backup = JSON.parse(text) as BackupFile;
    if (backup.app !== 'barista-journal' || !backup.tables) {
      return { ok: false, error: 'הקובץ אינו גיבוי תקין של יומן הבריסטה.' };
    }
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        const rows = backup.tables[table.name];
        if (!Array.isArray(rows)) continue;
        await table.clear();
        await table.bulkAdd(rows as never[]);
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `שגיאה בשחזור: ${e instanceof Error ? e.message : String(e)}` };
  }
}
