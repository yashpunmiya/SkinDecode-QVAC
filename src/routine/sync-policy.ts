import type { RoutineSnapshot } from './models';

export type RemoteMergeDecision = 'apply' | 'keep-local' | 'rebase-local' | 'cloud-conflict-wins' | 'reject-owner';

export function runSingleFlight<K, V>(activeByKey: Map<K, Promise<V>>, key: K, run: () => Promise<V>): Promise<V> {
  const active = activeByKey.get(key);
  if (active) return active;

  const task = Promise.resolve().then(run);
  activeByKey.set(key, task);
  return task.finally(() => {
    if (activeByKey.get(key) === task) activeByKey.delete(key);
  });
}

export function decideRemoteMerge(input: {
  expectedUserId: string;
  localUserId: string | null;
  localDirty: boolean;
  localCloudVersion: number;
  remoteUserId: string;
  remoteCloudVersion: number;
}): RemoteMergeDecision {
  if (input.remoteUserId !== input.expectedUserId || (input.localUserId && input.localUserId !== input.expectedUserId)) {
    return 'reject-owner';
  }
  if (!input.localUserId || !input.localDirty) return 'apply';
  if (input.remoteCloudVersion > input.localCloudVersion) return 'cloud-conflict-wins';
  if (input.remoteCloudVersion < input.localCloudVersion) return 'rebase-local';
  return 'keep-local';
}

export function snapshotForUser(userId: string, snapshot: RoutineSnapshot): RoutineSnapshot {
  const routines = snapshot.routines.filter((row) => row.userId === userId);
  const routineIds = new Set(routines.map((row) => row.id));
  const steps = snapshot.steps.filter((row) => row.userId === userId && routineIds.has(row.routineId));
  const stepIds = new Set(steps.map((row) => row.id));
  const logs = snapshot.logs.filter((row) =>
    row.userId === userId && routineIds.has(row.routineId) && stepIds.has(row.stepId),
  );
  return { routines, steps, logs };
}

export function isOptimisticConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '40001'
    || (typeof candidate.message === 'string' && candidate.message.includes('routine_sync_conflict'));
}

/** A timed-out upload may have committed even when the client got no response.
 * Pull once before retrying so an acknowledged cloud write is not replayed stale. */
export function shouldReconcileRoutineWriteFailure(error: unknown) {
  if (isOptimisticConflict(error)) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown };
  const status = Number(candidate.status);
  if ([408, 425, 502, 503, 504].includes(status)) return true;
  return typeof candidate.message === 'string'
    && /timeout|timed out|network request failed|fetch failed|connection reset|socket hang up/i.test(candidate.message);
}
