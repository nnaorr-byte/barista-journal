import { db, newId } from './database';
import type {
  Bag, Bean, DialInSession, Grinder, Machine, MaintenanceEvent, Shot, UserProfile,
} from '../domain/types';

// ממשקי גישה לנתונים. ה-UI והשירותים תלויים רק בפונקציות האלה,
// כך שמימוש ענן עתידי מחליף את הקובץ הזה בלבד.

export const userRepo = {
  async getCurrent(): Promise<UserProfile> {
    const users = await db.users.toArray();
    return users[0];
  },
  async update(user: UserProfile): Promise<void> {
    await db.users.put(user);
  },
};

export const machineRepo = {
  all: (): Promise<Machine[]> => db.machines.toArray(),
  async getDefault(): Promise<Machine> {
    const all = await db.machines.toArray();
    return all.find((m) => m.isDefault) ?? all[0];
  },
  put: (m: Machine): Promise<unknown> => db.machines.put(m),
};

export const grinderRepo = {
  all: (): Promise<Grinder[]> => db.grinders.toArray(),
  async getDefault(): Promise<Grinder> {
    const all = await db.grinders.toArray();
    return all.find((g) => g.isDefault) ?? all[0];
  },
  put: (g: Grinder): Promise<unknown> => db.grinders.put(g),
  async setDefault(id: string): Promise<void> {
    await db.transaction('rw', db.grinders, async () => {
      const all = await db.grinders.toArray();
      for (const g of all) await db.grinders.put({ ...g, isDefault: g.id === id });
    });
  },
};

export const beanRepo = {
  all: (): Promise<Bean[]> => db.beans.toArray(),
  get: (id: string): Promise<Bean | undefined> => db.beans.get(id),
  async create(bean: Omit<Bean, 'id' | 'createdAt' | 'archived'>): Promise<Bean> {
    const full: Bean = { ...bean, id: newId(), createdAt: new Date().toISOString(), archived: false };
    await db.beans.add(full);
    return full;
  },
  put: (b: Bean): Promise<unknown> => db.beans.put(b),
  async remove(id: string): Promise<void> {
    // מחיקת פולים מוחקת גם שקיות ושוטים משויכים
    await db.transaction('rw', [db.beans, db.bags, db.shots, db.dialInSessions], async () => {
      const bags = await db.bags.where('beanId').equals(id).toArray();
      for (const bag of bags) {
        await db.dialInSessions.where('bagId').equals(bag.id).delete();
      }
      await db.bags.where('beanId').equals(id).delete();
      await db.shots.where('beanId').equals(id).delete();
      await db.beans.delete(id);
    });
  },
};

export const bagRepo = {
  all: (): Promise<Bag[]> => db.bags.toArray(),
  get: (id: string): Promise<Bag | undefined> => db.bags.get(id),
  forBean: (beanId: string): Promise<Bag[]> => db.bags.where('beanId').equals(beanId).toArray(),
  async create(bag: Omit<Bag, 'id' | 'createdAt' | 'finished'>): Promise<Bag> {
    const full: Bag = { ...bag, id: newId(), createdAt: new Date().toISOString(), finished: false };
    await db.bags.add(full);
    return full;
  },
  put: (b: Bag): Promise<unknown> => db.bags.put(b),
};

export const shotRepo = {
  all: (): Promise<Shot[]> => db.shots.orderBy('createdAt').reverse().toArray(),
  get: (id: string): Promise<Shot | undefined> => db.shots.get(id),
  forBean: (beanId: string): Promise<Shot[]> => db.shots.where('beanId').equals(beanId).toArray(),
  forBag: (bagId: string): Promise<Shot[]> => db.shots.where('bagId').equals(bagId).toArray(),
  forSession: (sessionId: string): Promise<Shot[]> =>
    db.shots.where('dialInSessionId').equals(sessionId).sortBy('createdAt'),
  async create(shot: Omit<Shot, 'id' | 'createdAt'>): Promise<Shot> {
    const full: Shot = { ...shot, id: newId(), createdAt: new Date().toISOString() };
    await db.shots.add(full);
    return full;
  },
  put: (s: Shot): Promise<unknown> => db.shots.put(s),
  remove: (id: string): Promise<void> => db.shots.delete(id),
};

export const dialInRepo = {
  async activeForBag(bagId: string): Promise<DialInSession | undefined> {
    const sessions = await db.dialInSessions.where('bagId').equals(bagId).toArray();
    return sessions.find((s) => s.status === 'active');
  },
  get: (id: string): Promise<DialInSession | undefined> => db.dialInSessions.get(id),
  async start(userId: string, bagId: string): Promise<DialInSession> {
    const session: DialInSession = {
      id: newId(), userId, bagId, status: 'active',
      startedAt: new Date().toISOString(), completedAt: null, bestShotId: null,
    };
    await db.dialInSessions.add(session);
    return session;
  },
  put: (s: DialInSession): Promise<unknown> => db.dialInSessions.put(s),
};

export const maintenanceRepo = {
  all: (): Promise<MaintenanceEvent[]> => db.maintenanceEvents.toArray(),
  async log(ev: Omit<MaintenanceEvent, 'id'>): Promise<void> {
    await db.maintenanceEvents.add({ ...ev, id: newId() });
  },
  async lastOfKind(kind: MaintenanceEvent['kind']): Promise<MaintenanceEvent | undefined> {
    const events = await db.maintenanceEvents.where('kind').equals(kind).toArray();
    events.sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    return events[0];
  },
};

export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}
