import { deviceAlarm } from '../../modules/skindecode-alarm/src';
import { applyNativeWaterLogs } from './water-tracker';
import { groupPendingWaterLogs } from './native-water-log-format';

const syncByUser = new Map<string, Promise<void>>();

/** Reconciles lock-screen actions into SQLite without requiring a Home screen to be mounted. */
async function performSync(userId: string) {
  const pendingLogs = deviceAlarm.getPendingWaterLogs(userId);
  const pendingByDate = groupPendingWaterLogs(pendingLogs);
  for (const [date, ids] of pendingByDate) {
    // SQLite's action_id primary key makes retry and concurrent app/home sync idempotent.
    await applyNativeWaterLogs(userId, date, ids);
    await deviceAlarm.acknowledgeWaterLogIds(userId, date, ids);
  }
}

/** Concurrent startup, resume, and Home refreshes share one idempotent reconciliation. */
export function syncPendingWaterLogs(userId: string): Promise<void> {
  const existing = syncByUser.get(userId);
  if (existing) return existing;
  const pending = performSync(userId).finally(() => {
    if (syncByUser.get(userId) === pending) syncByUser.delete(userId);
  });
  syncByUser.set(userId, pending);
  return pending;
}
