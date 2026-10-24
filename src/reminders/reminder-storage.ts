import * as SQLite from 'expo-sqlite';
import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from './models';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function openDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('skindecode-reminders.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS reminder_preferences (
          user_id TEXT PRIMARY KEY NOT NULL,
          morning_enabled INTEGER NOT NULL, morning_time INTEGER NOT NULL,
          evening_enabled INTEGER NOT NULL, evening_time INTEGER NOT NULL,
          skin_check_enabled INTEGER NOT NULL, skin_check_time INTEGER NOT NULL,
          water_enabled INTEGER NOT NULL, water_start INTEGER NOT NULL,
          water_end INTEGER NOT NULL, water_interval INTEGER NOT NULL,
          water_reminder_style TEXT NOT NULL DEFAULT 'notification',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminder_schedule_state (
          user_id TEXT PRIMARY KEY NOT NULL,
          signature TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminder_water_mode_draft (
          user_id TEXT PRIMARY KEY NOT NULL,
          style TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(reminder_preferences)');
      if (!columns.some((column) => column.name === 'water_reminder_style')) {
        // Existing installs keep their current notification behavior after upgrade.
        await db.execAsync("ALTER TABLE reminder_preferences ADD COLUMN water_reminder_style TEXT NOT NULL DEFAULT 'notification'");
      }
      return db;
    })().catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

export async function deleteUserReminderData(userId: string) {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM reminder_preferences WHERE user_id = ?', userId);
    await db.runAsync('DELETE FROM reminder_schedule_state WHERE user_id = ?', userId);
    await db.runAsync('DELETE FROM reminder_water_mode_draft WHERE user_id = ?', userId);
  });
}

type PreferenceRow = {
  morning_enabled: number; morning_time: number; evening_enabled: number; evening_time: number;
  skin_check_enabled: number; skin_check_time: number; water_enabled: number;
  water_start: number; water_end: number; water_interval: number; water_reminder_style: string;
};

function fromRow(row?: PreferenceRow | null): ReminderPreferences {
  if (!row) return { ...DEFAULT_REMINDER_PREFERENCES };
  return {
    morningEnabled: row.morning_enabled === 1,
    morningTimeMinutes: row.morning_time,
    eveningEnabled: row.evening_enabled === 1,
    eveningTimeMinutes: row.evening_time,
    skinCheckEnabled: row.skin_check_enabled === 1,
    skinCheckTimeMinutes: row.skin_check_time,
    waterEnabled: row.water_enabled === 1,
    waterStartMinutes: row.water_start,
    waterEndMinutes: row.water_end,
    waterIntervalHours: row.water_interval === 2 ? 2 : 3,
    waterReminderStyle: row.water_reminder_style === 'alarm' ? 'alarm' : 'notification',
  };
}

export async function loadReminderPreferenceState(userId: string) {
  const db = await openDatabase();
  const row = await db.getFirstAsync<PreferenceRow>('SELECT * FROM reminder_preferences WHERE user_id = ?', userId);
  return { preferences: fromRow(row), hasSavedPreferences: row !== null };
}

export async function saveReminderPreferences(userId: string, p: ReminderPreferences) {
  const db = await openDatabase();
  await db.runAsync(`INSERT INTO reminder_preferences(
    user_id,morning_enabled,morning_time,evening_enabled,evening_time,skin_check_enabled,skin_check_time,
    water_enabled,water_start,water_end,water_interval,water_reminder_style,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
    morning_enabled=excluded.morning_enabled,morning_time=excluded.morning_time,
    evening_enabled=excluded.evening_enabled,evening_time=excluded.evening_time,
    skin_check_enabled=excluded.skin_check_enabled,skin_check_time=excluded.skin_check_time,
    water_enabled=excluded.water_enabled,water_start=excluded.water_start,water_end=excluded.water_end,
    water_interval=excluded.water_interval,water_reminder_style=excluded.water_reminder_style,updated_at=excluded.updated_at`,
  userId, Number(p.morningEnabled), p.morningTimeMinutes, Number(p.eveningEnabled), p.eveningTimeMinutes,
  Number(p.skinCheckEnabled), p.skinCheckTimeMinutes, Number(p.waterEnabled), p.waterStartMinutes,
  p.waterEndMinutes, p.waterIntervalHours, p.waterReminderStyle, new Date().toISOString());
}

export async function loadScheduleSignature(userId: string) {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ signature: string }>('SELECT signature FROM reminder_schedule_state WHERE user_id = ?', userId);
  return row?.signature ?? null;
}

export async function saveScheduleSignature(userId: string, signature: string) {
  const db = await openDatabase();
  await db.runAsync(`INSERT INTO reminder_schedule_state(user_id,signature,updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET signature=excluded.signature,updated_at=excluded.updated_at`, userId, signature, new Date().toISOString());
}

export async function saveWaterReminderStyleDraft(userId: string, style: ReminderPreferences['waterReminderStyle']) {
  const db = await openDatabase();
  await db.runAsync(`INSERT INTO reminder_water_mode_draft(user_id,style,updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET style=excluded.style,updated_at=excluded.updated_at`, userId, style, new Date().toISOString());
}

export async function consumeWaterReminderStyleDraft(userId: string) {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ style: string }>('SELECT style FROM reminder_water_mode_draft WHERE user_id = ?', userId);
  if (row) await db.runAsync('DELETE FROM reminder_water_mode_draft WHERE user_id = ?', userId);
  return row?.style === 'notification' ? 'notification' as const : row?.style === 'alarm' || row?.style === 'silent_alarm' ? 'alarm' as const : null;
}

export async function loadWaterReminderStyleDraft(userId: string) {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ style: string }>('SELECT style FROM reminder_water_mode_draft WHERE user_id = ?', userId);
  return row?.style === 'notification' ? 'notification' as const : row?.style === 'alarm' || row?.style === 'silent_alarm' ? 'alarm' as const : null;
}

export async function clearWaterReminderStyleDraft(userId: string) {
  const db = await openDatabase();
  await db.runAsync('DELETE FROM reminder_water_mode_draft WHERE user_id = ?', userId);
}
