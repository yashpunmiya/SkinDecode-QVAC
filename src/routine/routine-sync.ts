import { supabase } from '../lib/supabase';
import type { RoutineLog, RoutineSnapshot, RoutineStep } from './models';
import type { Database, RoutineLogRow, RoutineRow, RoutineStepRow } from '../types/database.types';
import {
  getPendingRoutineRows,
  getRoutineSnapshot,
  getRoutineSyncCursors,
  markRoutineRowsSynced,
  mergeRoutineSnapshot,
  saveRoutineSyncCursors,
  type RoutineSyncAck,
} from './routine-database';
import { runSingleFlight, shouldReconcileRoutineWriteFailure, snapshotForUser } from './sync-policy';

const PAGE_SIZE = 500;
const MAX_PAGES_PER_TABLE = 20;
const PUSH_BATCH_SIZE = 100;

type RoutineUpsert = Database['public']['Tables']['routines']['Insert'];
type RoutineStepUpsert = Database['public']['Tables']['routine_steps']['Insert'];
type RoutineLogUpsert = Database['public']['Tables']['routine_logs']['Insert'];
type RemoteCursorRow = { id: string; sync_version: number; change_seq: number; step_id?: string; log_date?: string };
type PendingVersion = { id: string; updatedAt: string };

function fromRemote(routines: RoutineRow[], steps: RoutineStepRow[], logs: RoutineLogRow[]): RoutineSnapshot {
  return {
    routines: routines.map((row) => ({
      id: row.id, userId: row.user_id, name: row.name, isActive: row.is_active,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
      cloudVersion: row.sync_version,
    })),
    steps: steps.map((row) => ({
      id: row.id, routineId: row.routine_id, userId: row.user_id, title: row.title, kind: row.kind,
      period: row.period, daysOfWeek: row.days_of_week, frequencyPerWeek: row.frequency_per_week,
      notes: row.notes, position: row.position, enabled: row.enabled, productId: row.product_id,
      shelfItemId: row.shelf_item_id,
      sourceScanId: row.source_scan_id, recommendationId: row.recommendation_id,
      ingredientContext: row.ingredient_context, conflictRefs: row.conflict_refs,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
      cloudVersion: row.sync_version,
    })),
    logs: logs.map((row) => ({
      id: row.id, userId: row.user_id, routineId: row.routine_id, stepId: row.step_id, logDate: row.log_date,
      period: row.period, status: row.status, occurredAt: row.occurred_at, notes: row.notes,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
      cloudVersion: row.sync_version,
    })),
  };
}

const toRoutineRow = (row: RoutineSnapshot['routines'][number]): RoutineUpsert => ({
  id: row.id, user_id: row.userId, name: row.name, is_active: row.isActive,
  created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt,
  sync_version: row.cloudVersion,
});

const toStepRow = (row: RoutineStep): RoutineStepUpsert => ({
  id: row.id, routine_id: row.routineId, user_id: row.userId, title: row.title, kind: row.kind,
  period: row.period, days_of_week: row.daysOfWeek, frequency_per_week: row.frequencyPerWeek,
  notes: row.notes, position: row.position, enabled: row.enabled, product_id: row.productId,
  shelf_item_id: row.shelfItemId,
  source_scan_id: row.sourceScanId, recommendation_id: row.recommendationId,
  ingredient_context: row.ingredientContext, conflict_refs: row.conflictRefs,
  created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt,
  sync_version: row.cloudVersion,
});

const toLogRow = (row: RoutineLog): RoutineLogUpsert => ({
  id: row.id, user_id: row.userId, routine_id: row.routineId, step_id: row.stepId,
  log_date: row.logDate, period: row.period, status: row.status, occurred_at: row.occurredAt,
  notes: row.notes, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt,
  sync_version: row.cloudVersion,
});

async function fetchChangedRows<T extends RemoteCursorRow>(
  table: 'routines' | 'routine_steps' | 'routine_logs',
  userId: string,
  cursor: number,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES_PER_TABLE; page += 1) {
    const start = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .gt('change_seq', cursor)
      .order('change_seq', { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = data as unknown as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }

  throw new Error(`Routine sync page limit reached for ${table}; retry to continue safely.`);
}

function maximumCursor(rows: RemoteCursorRow[], previous: number) {
  return rows.reduce((maximum, row) => Math.max(maximum, row.change_seq), previous);
}

function chunks<T>(rows: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}

function assertRowsAccepted(expectedKeys: string[], responseRows: RemoteCursorRow[]) {
  const acceptedKeys = new Set(responseRows.map((row) => row.step_id && row.log_date
    ? `${row.step_id}:${row.log_date}`
    : row.id));
  if (expectedKeys.some((key) => !acceptedKeys.has(key))) {
    const conflict = new Error('routine_sync_conflict') as Error & { code: string };
    conflict.code = '40001';
    throw conflict;
  }
}

async function acknowledgeRows(
  userId: string,
  table: 'routines' | 'steps' | 'logs',
  pendingRows: PendingVersion[],
  responseRows: RemoteCursorRow[],
) {
  const pendingById = new Map(pendingRows.map((row) => [row.id, row]));
  const pendingLogByKey = table === 'logs'
    ? new Map((pendingRows as (PendingVersion & { stepId: string; logDate: string })[]).map((row) => [`${row.stepId}:${row.logDate}`, row]))
    : null;
  const acks: RoutineSyncAck[] = responseRows.flatMap((row) => {
    if (pendingLogByKey && row.step_id && row.log_date) {
      const pending = pendingLogByKey.get(`${row.step_id}:${row.log_date}`);
      return pending ? [{ id: pending.id, updatedAt: pending.updatedAt, cloudVersion: row.sync_version, stepId: row.step_id, logDate: row.log_date }] : [];
    }
    const pending = pendingById.get(row.id);
    return pending ? [{ id: pending.id, updatedAt: pending.updatedAt, cloudVersion: row.sync_version }] : [];
  });
  await markRoutineRowsSynced(userId, {
    routines: table === 'routines' ? acks : [],
    steps: table === 'steps' ? acks : [],
    logs: table === 'logs' ? acks : [],
  });
}

async function pushPendingRows(userId: string, pending: RoutineSnapshot) {
  for (const batch of chunks(pending.routines, PUSH_BATCH_SIZE)) {
    const payload = batch.map(toRoutineRow);
    const { data, error } = await supabase.from('routines').upsert(payload, { onConflict: 'id' }).select('id,sync_version,change_seq');
    if (error) throw error;
    const responseRows = data ?? [];
    assertRowsAccepted(batch.map((row) => row.id), responseRows);
    await acknowledgeRows(userId, 'routines', batch, responseRows);
  }
  for (const batch of chunks(pending.steps, PUSH_BATCH_SIZE)) {
    const payload = batch.map(toStepRow);
    const { data, error } = await supabase.from('routine_steps').upsert(payload, { onConflict: 'id' }).select('id,sync_version,change_seq');
    if (error) throw error;
    const responseRows = data ?? [];
    assertRowsAccepted(batch.map((row) => row.id), responseRows);
    await acknowledgeRows(userId, 'steps', batch, responseRows);
  }
  for (const batch of chunks(pending.logs, PUSH_BATCH_SIZE)) {
    const payload = batch.map(toLogRow);
    const { data, error } = await supabase
      .from('routine_logs')
      .upsert(payload, { onConflict: 'user_id,step_id,log_date' })
      .select('id,step_id,log_date,sync_version,change_seq');
    if (error) throw error;
    const responseRows = data ?? [];
    assertRowsAccepted(batch.map((row) => `${row.stepId}:${row.logDate}`), responseRows);
    await acknowledgeRows(userId, 'logs', batch, responseRows);
  }
}

async function pullChanges(userId: string, fullSnapshot = false) {
  const cursors = await getRoutineSyncCursors(userId);
  // A conflict can mean the local cursor is stale (or the cloud version was
  // reset during a schema repair). Reconcile against the full, still-small
  // user-owned routine snapshot once instead of repeatedly pushing a bad base.
  const fetchCursors = fullSnapshot ? { routines: 0, steps: 0, logs: 0 } : cursors;
  const [routines, steps, logs] = await Promise.all([
    fetchChangedRows<RoutineRow>('routines', userId, fetchCursors.routines),
    fetchChangedRows<RoutineStepRow>('routine_steps', userId, fetchCursors.steps),
    fetchChangedRows<RoutineLogRow>('routine_logs', userId, fetchCursors.logs),
  ]);
  const remote = snapshotForUser(userId, fromRemote(routines, steps, logs));
  await mergeRoutineSnapshot(userId, remote);
  await saveRoutineSyncCursors(userId, {
    routines: maximumCursor(routines, cursors.routines),
    steps: maximumCursor(steps, cursors.steps),
    logs: maximumCursor(logs, cursors.logs),
  });

  if (routines.length || steps.length || logs.length) {
    console.info('[routine-sync] pulled routine changes', { routines: routines.length, steps: steps.length, logs: logs.length });
  }
}

async function syncRoutineBackupImpl(userId: string): Promise<RoutineSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await pullChanges(userId, attempt > 0);
    const pending = await getPendingRoutineRows(userId);
    const dirtyCount = pending.routines.length + pending.steps.length + pending.logs.length;
    if (!dirtyCount) return getRoutineSnapshot(userId);

    try {
      await pushPendingRows(userId, pending);
      console.info('[routine-sync] pushed local changes', {
        routines: pending.routines.length,
        steps: pending.steps.length,
        logs: pending.logs.length,
      });
      return getRoutineSnapshot(userId);
    } catch (error) {
      if (!shouldReconcileRoutineWriteFailure(error) || attempt > 0) throw error;
      console.warn('[routine-sync] upload failed ambiguously; refreshing the routine snapshot before one retry.');
    }
  }

  return getRoutineSnapshot(userId);
}

const inFlightByUser = new Map<string, Promise<RoutineSnapshot>>();

export function syncRoutineBackup(userId: string): Promise<RoutineSnapshot> {
  return runSingleFlight(inFlightByUser, userId, () => syncRoutineBackupImpl(userId));
}
