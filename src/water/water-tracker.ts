import * as SQLite from 'expo-sqlite';

export const DEFAULT_WATER_GOAL = 8;
export const MAX_WATER_GOAL = 12;

export type WaterSnapshot = {
  glasses: number;
  goal: number;
};

export type WaterHistoryEntry = { localDate: string; glasses: number };

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function openWaterDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync('skindecode-water.db');
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS water_daily_entries (
          user_id TEXT NOT NULL,
          local_date TEXT NOT NULL,
          glasses INTEGER NOT NULL DEFAULT 0 CHECK(glasses >= 0),
          updated_at TEXT NOT NULL,
          PRIMARY KEY(user_id, local_date)
        );
        CREATE TABLE IF NOT EXISTS water_preferences (
          user_id TEXT PRIMARY KEY NOT NULL,
          daily_goal INTEGER NOT NULL DEFAULT ${DEFAULT_WATER_GOAL} CHECK(daily_goal BETWEEN 1 AND ${MAX_WATER_GOAL}),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS water_native_actions (
          action_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          local_date TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

export async function deleteUserWaterData(userId: string) {
  const database = await openWaterDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM water_native_actions WHERE user_id = ?', userId);
    await database.runAsync('DELETE FROM water_daily_entries WHERE user_id = ?', userId);
    await database.runAsync('DELETE FROM water_preferences WHERE user_id = ?', userId);
  });
}

/** Applies native lock-screen reminder actions exactly once to the local SQLite source of truth. */
export async function applyNativeWaterLogs(userId: string, localDate: string, actionIds: string[]): Promise<WaterSnapshot> {
  const database = await openWaterDatabase();
  if (actionIds.length) {
    const now = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      for (const actionId of actionIds) {
        const inserted = await database.runAsync(
          'INSERT OR IGNORE INTO water_native_actions(action_id,user_id,local_date,applied_at) VALUES(?,?,?,?)',
          actionId, userId, localDate, now,
        );
        if (inserted.changes > 0) {
          await database.runAsync(
            `INSERT INTO water_daily_entries(user_id,local_date,glasses,updated_at) VALUES(?,?,1,?)
             ON CONFLICT(user_id,local_date) DO UPDATE SET glasses=water_daily_entries.glasses+1,updated_at=excluded.updated_at`,
            userId, localDate, now,
          );
        }
      }
    });
  }
  return loadWaterSnapshot(userId, localDate);
}

export async function loadWaterSnapshot(userId: string, localDate: string): Promise<WaterSnapshot> {
  const database = await openWaterDatabase();
  const [day, preferences] = await Promise.all([
    database.getFirstAsync<{ glasses: number }>(
      'SELECT glasses FROM water_daily_entries WHERE user_id = ? AND local_date = ?', userId, localDate,
    ),
    database.getFirstAsync<{ daily_goal: number }>(
      'SELECT daily_goal FROM water_preferences WHERE user_id = ?', userId,
    ),
  ]);
  return {
    glasses: Math.max(0, day?.glasses ?? 0),
    goal: Math.min(MAX_WATER_GOAL, Math.max(1, preferences?.daily_goal ?? DEFAULT_WATER_GOAL)),
  };
}

/** Returns only dates with a saved water record; missing dates remain unrecorded, not zero. */
export async function loadWaterHistory(userId: string, fromDate: string, throughDate: string): Promise<WaterHistoryEntry[]> {
  const database = await openWaterDatabase();
  const rows = await database.getAllAsync<{ local_date: string; glasses: number }>(
    'SELECT local_date,glasses FROM water_daily_entries WHERE user_id=? AND local_date>=? AND local_date<=? ORDER BY local_date ASC',
    userId, fromDate, throughDate,
  );
  return rows.map((row) => ({ localDate: row.local_date, glasses: Math.max(0, row.glasses) }));
}

export async function saveWaterSnapshot(userId: string, localDate: string, snapshot: WaterSnapshot) {
  const database = await openWaterDatabase();
  const now = new Date().toISOString();
  const glasses = Math.max(0, Math.floor(snapshot.glasses));
  const goal = Math.min(MAX_WATER_GOAL, Math.max(1, Math.floor(snapshot.goal)));

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO water_daily_entries(user_id,local_date,glasses,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,local_date) DO UPDATE SET glasses=excluded.glasses,updated_at=excluded.updated_at`,
      userId, localDate, glasses, now,
    );
    await database.runAsync(
      `INSERT INTO water_preferences(user_id,daily_goal,updated_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET daily_goal=excluded.daily_goal,updated_at=excluded.updated_at`,
      userId, goal, now,
    );
  });
}
