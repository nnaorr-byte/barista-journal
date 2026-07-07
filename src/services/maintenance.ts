import type { MaintenanceEvent, MaintenanceKind, MaintenanceRule } from '../domain/types';
import { daysSince } from './recommendation';

// כללי תחזוקה מותאמים ל-DeLonghi EC685 (מכונה ביתית, שימוש יומי)
// ולמטחנות ביתיות.

export const MAINTENANCE_RULES: MaintenanceRule[] = [
  { kind: 'machine-backflush', label: 'שטיפת מכונה (Backflush/ניקוי ראש)', intervalDays: 14 },
  { kind: 'machine-descale', label: 'ניקוי אבנית (Descaling)', intervalDays: 90 },
  { kind: 'grinder-clean', label: 'ניקוי מטחנה', intervalDays: 30 },
];

export interface MaintenanceStatus {
  rule: MaintenanceRule;
  lastPerformed: string | null;
  daysAgo: number | null;
  overdue: boolean;
  dueInDays: number | null;
}

export function computeMaintenanceStatus(events: MaintenanceEvent[]): MaintenanceStatus[] {
  return MAINTENANCE_RULES.map((rule) => {
    const ofKind = events
      .filter((e) => e.kind === rule.kind)
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    const last = ofKind[0] ?? null;
    const daysAgo = last ? daysSince(last.performedAt) : null;
    const overdue = daysAgo === null ? false : daysAgo >= rule.intervalDays;
    return {
      rule,
      lastPerformed: last?.performedAt ?? null,
      daysAgo,
      overdue,
      dueInDays: daysAgo === null ? null : Math.max(0, rule.intervalDays - daysAgo),
    };
  });
}

export function kindLabel(kind: MaintenanceKind): string {
  return MAINTENANCE_RULES.find((r) => r.kind === kind)?.label ?? kind;
}
