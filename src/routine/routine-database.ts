import * as SQLite from 'expo-sqlite';
import type { Routine, RoutineDraft, RoutineLog, RoutineLogStatus, RoutinePeriod, RoutineSnapshot, RoutineStep } from './models';
import { makeLocalId, localDateKey } from './models';
import { decideRemoteMerge } from './sync-policy';

type RoutineRow = {
  id: string; user_id: string; name: string; is_active: number; created_at: string; updated_at: string; deleted_at: string | null; cloud_version: number; sync_pending: number;
};
type StepRow = {
  id: string; routine_id: string; user_id: string; title: string; kind: string; period: RoutinePeriod; days_of_week: string;
  frequency_per_week: number; notes: string | null; position: number; enabled: number; product_id: string | null; shelf_item_id: string | null;
  source_scan_id: string | null; recommendation_id: string | null; ingredient_context: string | null; conflict_refs: string;
  created_at: string; updated_at: string; deleted_at: string | null; cloud_version: number; sync_pending: number;
};
type LogRow = {
  id: string; user_id: string; routine_id: string; step_id: string; log_date: string; period: RoutinePeriod;
  status: RoutineLogStatus; occurred_at: string; notes: string | null; created_at: string; updated_at: string;
  deleted_at: string | null; cloud_version: number; sync_pending: number;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export async function openRoutineDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync('skindecode-routines.db');
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS routines (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          cloud_version INTEGER NOT NULL DEFAULT 0,
          sync_pending INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS routines_user_idx ON routines(user_id, is_active, deleted_at);
        CREATE TABLE IF NOT EXISTS routine_steps (
          id TEXT PRIMARY KEY NOT NULL,
          routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          kind TEXT NOT NULL,
          period TEXT NOT NULL CHECK(period IN ('am','pm')),
          days_of_week TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
          frequency_per_week INTEGER NOT NULL DEFAULT 7 CHECK(frequency_per_week BETWEEN 0 AND 7),
          notes TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          product_id TEXT,
          shelf_item_id TEXT,
          source_scan_id TEXT,
          recommendation_id TEXT,
          ingredient_context TEXT,
          conflict_refs TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          cloud_version INTEGER NOT NULL DEFAULT 0,
          sync_pending INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS routine_steps_owner_idx ON routine_steps(user_id, routine_id, period, position, deleted_at);
        CREATE TABLE IF NOT EXISTS routine_logs (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
          step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
          log_date TEXT NOT NULL,
          period TEXT NOT NULL CHECK(period IN ('am','pm')),
          status TEXT NOT NULL CHECK(status IN ('completed','skipped')),
          occurred_at TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          cloud_version INTEGER NOT NULL DEFAULT 0,
          sync_pending INTEGER NOT NULL DEFAULT 1,
          UNIQUE(user_id, step_id, log_date)
        );
        CREATE INDEX IF NOT EXISTS routine_logs_history_idx ON routine_logs(user_id, log_date, period, deleted_at);
        CREATE TABLE IF NOT EXISTS routine_sync_state (
          user_id TEXT PRIMARY KEY NOT NULL,
          routines_cursor INTEGER NOT NULL DEFAULT 0,
          steps_cursor INTEGER NOT NULL DEFAULT 0,
          logs_cursor INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
      `);
      for (const [table, column, declaration] of [
        ['routine_steps', 'conflict_refs', "TEXT NOT NULL DEFAULT '[]'"],
        ['routines', 'cloud_version', 'INTEGER NOT NULL DEFAULT 0'],
        ['routine_steps', 'cloud_version', 'INTEGER NOT NULL DEFAULT 0'],
        ['routine_logs', 'cloud_version', 'INTEGER NOT NULL DEFAULT 0'],
        ['routine_steps', 'shelf_item_id', 'TEXT'],
      ] as const) {
        const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        if (!columns.some((item) => item.name === column)) {
          await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration};`);
        }
      }
      await database.execAsync('PRAGMA user_version = 4;');
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapRoutine(row: RoutineRow): Routine {
  return { id: row.id, userId: row.user_id, name: row.name, isActive: row.is_active === 1, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, cloudVersion: row.cloud_version };
}
function mapStep(row: StepRow): RoutineStep {
  return {
    id: row.id, routineId: row.routine_id, userId: row.user_id, title: row.title, kind: row.kind, period: row.period,
    daysOfWeek: parseJson<number[]>(row.days_of_week, [0, 1, 2, 3, 4, 5, 6]),
    frequencyPerWeek: row.frequency_per_week, notes: row.notes, position: row.position, enabled: row.enabled === 1,
    productId: row.product_id == null ? null : Number(row.product_id), shelfItemId: row.shelf_item_id,
    sourceScanId: row.source_scan_id, recommendationId: row.recommendation_id,
    ingredientContext: parseJson<Record<string, unknown> | null>(row.ingredient_context, null),
    conflictRefs: parseJson<string[]>(row.conflict_refs, []),
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, cloudVersion: row.cloud_version,
  };
}
function mapLog(row: LogRow): RoutineLog {
  return {
    id: row.id, userId: row.user_id, routineId: row.routine_id, stepId: row.step_id, logDate: row.log_date,
    period: row.period, status: row.status, occurredAt: row.occurred_at, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, cloudVersion: row.cloud_version,
  };
}

export async function getRoutineSnapshot(userId: string, includeDeleted = false): Promise<RoutineSnapshot> {
  const database = await openRoutineDatabase();
  const tombstoneFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const [routineRows, stepRows, logRows] = await Promise.all([
    database.getAllAsync<RoutineRow>(`SELECT * FROM routines WHERE user_id = ?${tombstoneFilter} ORDER BY created_at`, userId),
    database.getAllAsync<StepRow>(`SELECT * FROM routine_steps WHERE user_id = ?${tombstoneFilter} ORDER BY position`, userId),
    database.getAllAsync<LogRow>(`SELECT * FROM routine_logs WHERE user_id = ?${tombstoneFilter} ORDER BY log_date DESC`, userId),
  ]);
  return { routines: routineRows.map(mapRoutine), steps: stepRows.map(mapStep), logs: logRows.map(mapLog) };
}

/** Local-only bounded snapshot for personal AI context; no sync service is called. */
export async function getRoutineSnapshotForRange(userId: string, fromDate: string, throughDate: string): Promise<RoutineSnapshot> {
  const database = await openRoutineDatabase();
  const [routineRows, stepRows, logRows] = await Promise.all([
    database.getAllAsync<RoutineRow>('SELECT * FROM routines WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at', userId),
    database.getAllAsync<StepRow>('SELECT * FROM routine_steps WHERE user_id=? AND deleted_at IS NULL ORDER BY position', userId),
    database.getAllAsync<LogRow>(
      'SELECT * FROM routine_logs WHERE user_id=? AND deleted_at IS NULL AND log_date>=? AND log_date<=? ORDER BY log_date DESC',
      userId, fromDate, throughDate,
    ),
  ]);
  return { routines: routineRows.map(mapRoutine), steps: stepRows.map(mapStep), logs: logRows.map(mapLog) };
}

export async function getPendingRoutineRows(userId: string): Promise<RoutineSnapshot> {
  const database = await openRoutineDatabase();
  const [routines, steps, logs] = await Promise.all([
    database.getAllAsync<RoutineRow>('SELECT * FROM routines WHERE user_id=? AND sync_pending=1', userId),
    database.getAllAsync<StepRow>('SELECT * FROM routine_steps WHERE user_id=? AND sync_pending=1', userId),
    database.getAllAsync<LogRow>('SELECT * FROM routine_logs WHERE user_id=? AND sync_pending=1', userId),
  ]);
  return { routines: routines.map(mapRoutine), steps: steps.map(mapStep), logs: logs.map(mapLog) };
}

export type RoutineSyncCursors = { routines: number; steps: number; logs: number };

export async function getRoutineSyncCursors(userId: string): Promise<RoutineSyncCursors> {
  const database = await openRoutineDatabase();
  const row = await database.getFirstAsync<{ routines_cursor: number; steps_cursor: number; logs_cursor: number }>(
    'SELECT routines_cursor,steps_cursor,logs_cursor FROM routine_sync_state WHERE user_id=?', userId,
  );
  return { routines: row?.routines_cursor ?? 0, steps: row?.steps_cursor ?? 0, logs: row?.logs_cursor ?? 0 };
}

export async function saveRoutineSyncCursors(userId: string, cursors: RoutineSyncCursors) {
  const database = await openRoutineDatabase();
  await database.runAsync(
    `INSERT INTO routine_sync_state(user_id,routines_cursor,steps_cursor,logs_cursor,updated_at)
     VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
       routines_cursor=MAX(routine_sync_state.routines_cursor,excluded.routines_cursor),
       steps_cursor=MAX(routine_sync_state.steps_cursor,excluded.steps_cursor),
       logs_cursor=MAX(routine_sync_state.logs_cursor,excluded.logs_cursor),updated_at=excluded.updated_at`,
    userId, cursors.routines, cursors.steps, cursors.logs, new Date().toISOString(),
  );
}

export async function saveRoutineDraft(userId: string, draft: RoutineDraft): Promise<RoutineSnapshot> {
  const database = await openRoutineDatabase();
  const now = new Date().toISOString();
  const routineId = draft.routineId || makeLocalId('routine', userId);
  const routineOwner = await database.getFirstAsync<{ user_id: string }>('SELECT user_id FROM routines WHERE id=?', routineId);
  if (routineOwner && routineOwner.user_id !== userId) throw new Error('Routine does not belong to the signed-in account.');
  const existingRoutine = await database.getFirstAsync<RoutineRow>('SELECT * FROM routines WHERE id = ? AND user_id = ?', routineId, userId);
  const draftStepIds = draft.steps.map((step) => step.id).filter(Boolean);
  if (draftStepIds.length) {
    const owners = await database.getAllAsync<{ id: string; user_id: string }>(
      `SELECT id,user_id FROM routine_steps WHERE id IN (${draftStepIds.map(() => '?').join(',')})`,
      ...draftStepIds,
    );
    if (owners.some((row) => row.user_id !== userId)) throw new Error('Routine step does not belong to the signed-in account.');
  }

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO routines(id,user_id,name,is_active,created_at,updated_at,deleted_at,cloud_version,sync_pending)
       VALUES(?,?,?,?,?,?,NULL,?,1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, deleted_at=NULL, sync_pending=1
       WHERE routines.user_id=excluded.user_id`,
      routineId, userId, draft.name.trim() || 'My skincare routine', 1, existingRoutine?.created_at || now, now,
      existingRoutine?.cloud_version ?? 0,
    );

    const existingSteps = await database.getAllAsync<{ id: string; created_at: string; cloud_version: number }>(
      'SELECT id,created_at,cloud_version FROM routine_steps WHERE routine_id = ? AND user_id = ? AND deleted_at IS NULL', routineId, userId,
    );
    const existingStepsById = new Map(existingSteps.map((step) => [step.id, step]));
    const included = new Set(draft.steps.map((step) => step.id).filter(Boolean));
    for (const step of existingSteps) {
      if (!included.has(step.id)) {
        await database.runAsync(
          'UPDATE routine_steps SET deleted_at = ?, updated_at = ?, sync_pending = 1 WHERE id = ? AND user_id = ?',
          now, now, step.id, userId,
        );
      }
    }

    for (const [position, step] of draft.steps.entries()) {
      const id = step.id || makeLocalId('step', userId);
      const existingStep = existingStepsById.get(id);
      await database.runAsync(
        `INSERT INTO routine_steps(
          id,routine_id,user_id,title,kind,period,days_of_week,frequency_per_week,notes,position,enabled,
          product_id,shelf_item_id,source_scan_id,recommendation_id,ingredient_context,conflict_refs,created_at,updated_at,deleted_at,cloud_version,sync_pending
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,1)
        ON CONFLICT(id) DO UPDATE SET
          routine_id=excluded.routine_id,title=excluded.title,kind=excluded.kind,period=excluded.period,
          days_of_week=excluded.days_of_week,frequency_per_week=excluded.frequency_per_week,notes=excluded.notes,
          position=excluded.position,enabled=excluded.enabled,product_id=excluded.product_id,shelf_item_id=excluded.shelf_item_id,
          source_scan_id=excluded.source_scan_id,recommendation_id=excluded.recommendation_id,
          ingredient_context=excluded.ingredient_context,conflict_refs=excluded.conflict_refs,
          updated_at=excluded.updated_at,deleted_at=NULL,sync_pending=1
        WHERE routine_steps.user_id=excluded.user_id`,
        id, routineId, userId, step.title.trim() || 'New step', step.kind, step.period,
        JSON.stringify(step.daysOfWeek), step.frequencyPerWeek, step.notes?.trim() || null, position, step.enabled ? 1 : 0,
        step.productId, step.shelfItemId, step.sourceScanId, step.recommendationId,
        step.ingredientContext ? JSON.stringify(step.ingredientContext) : null,
        JSON.stringify(step.conflictRefs),
        existingStep?.created_at || now, now, existingStep?.cloud_version ?? 0,
      );
    }
  });

  return getRoutineSnapshot(userId);
}

export async function setRoutineStepLog(
  userId: string,
  step: RoutineStep,
  status: RoutineLogStatus | null,
  date = new Date(),
): Promise<RoutineSnapshot> {
  if (step.userId !== userId) throw new Error('Routine step does not belong to the signed-in account.');
  const database = await openRoutineDatabase();
  const logDate = localDateKey(date);
  const existing = await database.getFirstAsync<LogRow>(
    'SELECT * FROM routine_logs WHERE user_id = ? AND step_id = ? AND log_date = ?', userId, step.id, logDate,
  );
  const now = new Date().toISOString();

  if (!status) {
    if (existing) {
      await database.runAsync(
        'UPDATE routine_logs SET deleted_at = ?, updated_at = ?, sync_pending = 1 WHERE id = ? AND user_id = ?',
        now, now, existing.id, userId,
      );
    }
    return getRoutineSnapshot(userId);
  }

  const id = existing?.id || makeLocalId('log', userId);
  await database.runAsync(
    `INSERT INTO routine_logs(id,user_id,routine_id,step_id,log_date,period,status,occurred_at,notes,created_at,updated_at,deleted_at,cloud_version,sync_pending)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,1)
     ON CONFLICT(user_id,step_id,log_date) DO UPDATE SET
       period=excluded.period,status=excluded.status,occurred_at=excluded.occurred_at,updated_at=excluded.updated_at,
       deleted_at=NULL,sync_pending=1`,
    id, userId, step.routineId, step.id, logDate, step.period, status, now,
    status === 'skipped' ? 'Skipped for this session' : null, existing?.created_at || now, now, existing?.cloud_version ?? 0,
  );
  return getRoutineSnapshot(userId);
}

export async function mergeRoutineSnapshot(userId: string, remote: RoutineSnapshot) {
  const database = await openRoutineDatabase();
  if (!remote.routines.length && !remote.steps.length && !remote.logs.length) return;
  await database.withTransactionAsync(async () => {
    const [routineRows, stepRows, logRows] = await Promise.all([
      database.getAllAsync<RoutineRow>('SELECT * FROM routines WHERE user_id=?', userId),
      database.getAllAsync<StepRow>('SELECT * FROM routine_steps WHERE user_id=?', userId),
      database.getAllAsync<LogRow>('SELECT * FROM routine_logs WHERE user_id=?', userId),
    ]);
    const routinesById = new Map(routineRows.map((row) => [row.id, row]));
    const stepsById = new Map(stepRows.map((row) => [row.id, row]));
    const logsByKey = new Map(logRows.map((row) => [`${row.step_id}:${row.log_date}`, row]));

    for (const routine of remote.routines) {
      const local = routinesById.get(routine.id);
      const decision = decideRemoteMerge({
        expectedUserId: userId,
        localUserId: local?.user_id ?? null,
        localDirty: local?.sync_pending === 1,
        localCloudVersion: local?.cloud_version ?? 0,
        remoteUserId: routine.userId,
        remoteCloudVersion: routine.cloudVersion,
      });
      if (decision === 'reject-owner' || decision === 'keep-local') continue;
      if (decision === 'rebase-local') {
        await database.runAsync(
          'UPDATE routines SET cloud_version=?,sync_pending=1 WHERE id=? AND user_id=?',
          routine.cloudVersion, routine.id, userId,
        );
        continue;
      }
      if (decision === 'cloud-conflict-wins') console.warn('[routine-sync] cloud version won a concurrent routine edit.');
      await database.runAsync(
        `INSERT INTO routines(id,user_id,name,is_active,created_at,updated_at,deleted_at,cloud_version,sync_pending)
         VALUES(?,?,?,?,?,?,?,?,0)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_active=excluded.is_active,updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at,cloud_version=excluded.cloud_version,sync_pending=0 WHERE routines.user_id=excluded.user_id`,
        routine.id, userId, routine.name, routine.isActive ? 1 : 0, routine.createdAt, routine.updatedAt, routine.deletedAt, routine.cloudVersion,
      );
    }
    for (const step of remote.steps) {
      const local = stepsById.get(step.id);
      const decision = decideRemoteMerge({
        expectedUserId: userId,
        localUserId: local?.user_id ?? null,
        localDirty: local?.sync_pending === 1,
        localCloudVersion: local?.cloud_version ?? 0,
        remoteUserId: step.userId,
        remoteCloudVersion: step.cloudVersion,
      });
      if (decision === 'reject-owner' || decision === 'keep-local') continue;
      if (decision === 'rebase-local') {
        await database.runAsync(
          'UPDATE routine_steps SET cloud_version=?,sync_pending=1 WHERE id=? AND user_id=?',
          step.cloudVersion, step.id, userId,
        );
        continue;
      }
      if (decision === 'cloud-conflict-wins') console.warn('[routine-sync] cloud version won a concurrent step edit.');
      await database.runAsync(
        `INSERT INTO routine_steps(
          id,routine_id,user_id,title,kind,period,days_of_week,frequency_per_week,notes,position,enabled,
          product_id,shelf_item_id,source_scan_id,recommendation_id,ingredient_context,conflict_refs,created_at,updated_at,deleted_at,cloud_version,sync_pending
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
        ON CONFLICT(id) DO UPDATE SET
          routine_id=excluded.routine_id,title=excluded.title,kind=excluded.kind,period=excluded.period,
          days_of_week=excluded.days_of_week,frequency_per_week=excluded.frequency_per_week,notes=excluded.notes,
          position=excluded.position,enabled=excluded.enabled,product_id=excluded.product_id,shelf_item_id=excluded.shelf_item_id,
          source_scan_id=excluded.source_scan_id,recommendation_id=excluded.recommendation_id,
          ingredient_context=excluded.ingredient_context,conflict_refs=excluded.conflict_refs,
          updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,cloud_version=excluded.cloud_version,sync_pending=0
        WHERE routine_steps.user_id=excluded.user_id`,
        step.id, step.routineId, userId, step.title, step.kind, step.period, JSON.stringify(step.daysOfWeek),
        step.frequencyPerWeek, step.notes, step.position, step.enabled ? 1 : 0, step.productId, step.shelfItemId, step.sourceScanId,
        step.recommendationId, step.ingredientContext ? JSON.stringify(step.ingredientContext) : null,
        JSON.stringify(step.conflictRefs), step.createdAt, step.updatedAt, step.deletedAt, step.cloudVersion,
      );
    }
    for (const log of remote.logs) {
      const local = logsByKey.get(`${log.stepId}:${log.logDate}`);
      const decision = decideRemoteMerge({
        expectedUserId: userId,
        localUserId: local?.user_id ?? null,
        localDirty: local?.sync_pending === 1,
        localCloudVersion: local?.cloud_version ?? 0,
        remoteUserId: log.userId,
        remoteCloudVersion: log.cloudVersion,
      });
      if (decision === 'reject-owner' || decision === 'keep-local') continue;
      if (decision === 'rebase-local') {
        await database.runAsync(
          'UPDATE routine_logs SET cloud_version=?,sync_pending=1 WHERE user_id=? AND step_id=? AND log_date=?',
          log.cloudVersion, userId, log.stepId, log.logDate,
        );
        continue;
      }
      if (decision === 'cloud-conflict-wins') console.warn('[routine-sync] cloud version won a concurrent check-in edit.');
      await database.runAsync(
        `INSERT INTO routine_logs(id,user_id,routine_id,step_id,log_date,period,status,occurred_at,notes,created_at,updated_at,deleted_at,cloud_version,sync_pending)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(user_id,step_id,log_date) DO UPDATE SET status=excluded.status,period=excluded.period,
           occurred_at=excluded.occurred_at,notes=excluded.notes,updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at,cloud_version=excluded.cloud_version,sync_pending=0`,
        log.id, userId, log.routineId, log.stepId, log.logDate, log.period, log.status, log.occurredAt,
        log.notes, log.createdAt, log.updatedAt, log.deletedAt, log.cloudVersion,
      );
    }
  });
}

export type RoutineSyncAck = { id: string; updatedAt: string; cloudVersion: number; stepId?: string; logDate?: string };

export async function markRoutineRowsSynced(userId: string, acks: { routines: RoutineSyncAck[]; steps: RoutineSyncAck[]; logs: RoutineSyncAck[] }) {
  const database = await openRoutineDatabase();
  await database.withTransactionAsync(async () => {
    for (const row of acks.routines) await database.runAsync('UPDATE routines SET sync_pending=0,cloud_version=? WHERE id=? AND user_id=? AND updated_at=?', row.cloudVersion, row.id, userId, row.updatedAt);
    for (const row of acks.steps) await database.runAsync('UPDATE routine_steps SET sync_pending=0,cloud_version=? WHERE id=? AND user_id=? AND updated_at=?', row.cloudVersion, row.id, userId, row.updatedAt);
      for (const row of acks.logs) {
        if (row.stepId && row.logDate) {
          await database.runAsync(
            'UPDATE routine_logs SET sync_pending=0,cloud_version=? WHERE user_id=? AND step_id=? AND log_date=? AND updated_at=?',
            row.cloudVersion, userId, row.stepId, row.logDate, row.updatedAt,
          );
        } else {
          await database.runAsync('UPDATE routine_logs SET sync_pending=0,cloud_version=? WHERE id=? AND user_id=? AND updated_at=?', row.cloudVersion, row.id, userId, row.updatedAt);
        }
      }
  });
}

export async function deleteUserRoutineData(userId: string) {
  const database = await openRoutineDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM routine_logs WHERE user_id = ?', userId);
    await database.runAsync('DELETE FROM routine_steps WHERE user_id = ?', userId);
    await database.runAsync('DELETE FROM routines WHERE user_id = ?', userId);
    await database.runAsync('DELETE FROM routine_sync_state WHERE user_id = ?', userId);
  });
}
