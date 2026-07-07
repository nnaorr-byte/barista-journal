import Dexie, { type EntityTable } from 'dexie';
import type {
  UserProfile, Machine, Grinder, Bean, Bag, Shot, DialInSession, MaintenanceEvent,
} from '../domain/types';

// שכבת האחסון המקומית (IndexedDB). כל הגישה לנתונים עוברת דרך
// המחלקות ב-repositories.ts כדי שמעבר עתידי לענן לא ידרוש שינוי ב-UI.

export class BaristaDB extends Dexie {
  users!: EntityTable<UserProfile, 'id'>;
  machines!: EntityTable<Machine, 'id'>;
  grinders!: EntityTable<Grinder, 'id'>;
  beans!: EntityTable<Bean, 'id'>;
  bags!: EntityTable<Bag, 'id'>;
  shots!: EntityTable<Shot, 'id'>;
  dialInSessions!: EntityTable<DialInSession, 'id'>;
  maintenanceEvents!: EntityTable<MaintenanceEvent, 'id'>;

  constructor() {
    super('barista-journal');
    this.version(1).stores({
      users: 'id',
      machines: 'id, userId',
      grinders: 'id, userId',
      beans: 'id, userId, name',
      bags: 'id, beanId, finished',
      shots: 'id, userId, beanId, bagId, grinderId, machineId, dialInSessionId, createdAt, rating',
      dialInSessions: 'id, userId, bagId, status',
      maintenanceEvents: 'id, userId, kind, equipmentId, performedAt',
    });
  }
}

export const db = new BaristaDB();

export function newId(): string {
  return crypto.randomUUID();
}

// זריעת פרופיל ברירת מחדל בהפעלה ראשונה — הציוד של נאור.
export async function seedIfEmpty(): Promise<void> {
  const count = await db.users.count();
  if (count > 0) return;

  const now = new Date().toISOString();
  const userId = newId();

  await db.transaction('rw', [db.users, db.machines, db.grinders], async () => {
    await db.users.add({
      id: userId,
      name: 'נאור',
      defaultDoseGrams: 16,
      doseRangeMin: 15.8,
      doseRangeMax: 16.5,
      createdAt: now,
    });
    await db.machines.add({
      id: newId(),
      userId,
      name: 'DeLonghi EC685',
      brand: 'DeLonghi',
      model: 'EC685',
      defaultTemp: 'medium',
      portafilterTypes: ['Bottomless', 'Standard'],
      accessories: ['WDT', 'Tamper', 'Puck Screen'],
      isDefault: true,
    });
    await db.grinders.add({
      id: newId(),
      userId,
      name: 'מטחנה ידנית',
      type: 'manual',
      scaleMin: 0,
      scaleMax: 40,
      scaleStep: 1,
      isDefault: true,
    });
    await db.grinders.add({
      id: newId(),
      userId,
      name: 'מטחנה חשמלית',
      type: 'electric',
      scaleMin: 0,
      scaleMax: 40,
      scaleStep: 1,
      isDefault: false,
    });
  });
}
