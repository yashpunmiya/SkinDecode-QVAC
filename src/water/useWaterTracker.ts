import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { localDateKey } from '../routine/models';
import { deviceAlarm } from '../../modules/skindecode-alarm/src';
import { syncPendingWaterLogs } from './native-water-log-sync';
import {
  DEFAULT_WATER_GOAL,
  loadWaterSnapshot,
  saveWaterSnapshot,
  type WaterSnapshot,
} from './water-tracker';

type WaterRecord = WaterSnapshot & { userId: string | null; dateKey: string };

const emptyRecord = (userId: string | null, dateKey: string): WaterRecord => ({
  userId,
  dateKey,
  glasses: 0,
  goal: DEFAULT_WATER_GOAL,
});

export function useWaterTracker(userId: string | undefined) {
  const [dateKey, setDateKey] = useState(() => localDateKey(new Date()));
  const [record, setRecord] = useState<WaterRecord>(() => emptyRecord(null, localDateKey(new Date())));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recordRef = useRef(record);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  recordRef.current = record;

  const refreshFromNative = useCallback(async (targetDate = localDateKey(new Date())) => {
    const activeUserId = userId;
    if (!activeUserId) return;
    await writeQueue.current.catch(() => undefined);
    await syncPendingWaterLogs(activeUserId);
    const snapshot = await loadWaterSnapshot(activeUserId, targetDate);
    if (recordRef.current.userId !== activeUserId) return;
    const next = { ...snapshot, userId: activeUserId, dateKey: targetDate };
    recordRef.current = next;
    setRecord(next);
    await deviceAlarm.updateWaterSnapshot(activeUserId, targetDate, snapshot.glasses, snapshot.goal);
  }, [userId]);

  useEffect(() => {
    const refreshLocalDate = () => setDateKey(localDateKey(new Date()));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refreshLocalDate();
      void refreshFromNative().catch((issue) => console.warn('[water-tracker] native reminder sync failed', issue));
    });
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const midnightTimer = setTimeout(refreshLocalDate, Math.max(1000, nextMidnight - now.getTime() + 250));
    return () => {
      subscription.remove();
      clearTimeout(midnightTimer);
    };
  }, [dateKey, refreshFromNative, userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = deviceAlarm.onWaterLogRecorded(() => {
      void refreshFromNative().catch((issue) => console.warn('[water-tracker] native reminder action refresh failed', issue));
    });
    return () => subscription.remove();
  }, [refreshFromNative, userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      const next = emptyRecord(null, dateKey);
      recordRef.current = next;
      setRecord(next);
      setIsLoading(false);
      return () => { active = false; };
    }

    setIsLoading(true);
    setError(null);
    void (async () => {
      await syncPendingWaterLogs(userId);
      const snapshot = await loadWaterSnapshot(userId, dateKey);
      if (!active) return;
      const next = { ...snapshot, userId, dateKey };
      recordRef.current = next;
      setRecord(next);
      void deviceAlarm.updateWaterSnapshot(userId, dateKey, snapshot.glasses, snapshot.goal).catch((issue) => {
        console.warn('[water-tracker] native reminder summary update failed', issue);
      });
    })().catch((loadError) => {
      console.warn('[water-tracker] local load failed', loadError);
      if (active) setError('Could not load today’s water tracker.');
    }).finally(() => {
      if (active) setIsLoading(false);
    });

    return () => { active = false; };
  }, [dateKey, userId]);

  const snapshot = record.userId === userId && record.dateKey === dateKey
    ? { glasses: record.glasses, goal: record.goal }
    : { glasses: 0, goal: DEFAULT_WATER_GOAL };

  const enqueueSave = useCallback((targetUserId: string, targetDate: string, next: WaterSnapshot) => {
    writeQueue.current = writeQueue.current
      .catch(() => undefined)
      .then(async () => {
        await saveWaterSnapshot(targetUserId, targetDate, next);
        await deviceAlarm.updateWaterSnapshot(targetUserId, targetDate, next.glasses, next.goal);
      })
      .catch((saveError) => {
        console.warn('[water-tracker] local save failed', saveError);
        if (recordRef.current.userId === targetUserId && recordRef.current.dateKey === targetDate) {
          setError('Your latest change could not be saved on this device.');
        }
      });
  }, []);

  const update = useCallback((changes: Partial<WaterSnapshot>) => {
    if (!userId || isLoading) return;
    const current = recordRef.current.userId === userId && recordRef.current.dateKey === dateKey
      ? recordRef.current
      : emptyRecord(userId, dateKey);
    const next: WaterRecord = { ...current, ...changes, userId, dateKey };
    recordRef.current = next;
    setRecord(next);
    setError(null);
    enqueueSave(userId, dateKey, next);
  }, [dateKey, enqueueSave, isLoading, userId]);

  const addGlass = useCallback(() => {
    const current = recordRef.current.userId === userId && recordRef.current.dateKey === dateKey
      ? recordRef.current.glasses
      : 0;
    update({ glasses: current + 1 });
  }, [dateKey, update, userId]);

  const removeGlass = useCallback(() => {
    const current = recordRef.current.userId === userId && recordRef.current.dateKey === dateKey
      ? recordRef.current.glasses
      : 0;
    update({ glasses: Math.max(0, current - 1) });
  }, [dateKey, update, userId]);

  const setGoal = useCallback((goal: number) => {
    update({ goal: Math.max(1, Math.min(12, Math.round(goal))) });
  }, [update]);

  const retrySave = useCallback(() => {
    if (!userId || recordRef.current.userId !== userId || recordRef.current.dateKey !== dateKey) return;
    setError(null);
    enqueueSave(userId, dateKey, recordRef.current);
  }, [dateKey, enqueueSave, userId]);

  return {
    ...snapshot,
    isLoading: isLoading || record.userId !== userId || record.dateKey !== dateKey,
    error,
    addGlass,
    removeGlass,
    setGoal,
    retrySave,
  };
}
