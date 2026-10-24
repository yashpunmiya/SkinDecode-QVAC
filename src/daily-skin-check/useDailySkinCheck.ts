import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDateKey } from '../routine/models';
import {
  deleteDailySkinCheck,
  loadDailySkinCheckHistory,
  loadDailySkinCheckPair,
  saveDailySkinCheck,
} from './storage';
import type { DailySkinCheck } from './rules';

type DailyPair = { today: DailySkinCheck | null; yesterday: DailySkinCheck | null };

export function useDailySkinCheck(userId: string | undefined) {
  const [now, setNow] = useState(() => new Date());
  const [pair, setPair] = useState<DailyPair>({ today: null, yesterday: null });
  const [history, setHistory] = useState<DailySkinCheck[]>([]);
  const [historyOwner, setHistoryOwner] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const dateKey = localDateKey(now);
  const ownerKey = userId ? `${userId}:${dateKey}` : null;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateAfterMidnight = () => {
      const current = new Date();
      setNow((previous) => localDateKey(previous) === localDateKey(current) ? previous : current);
      const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
      timer = setTimeout(updateAfterMidnight, Math.max(1000, midnight - current.getTime() + 250));
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateAfterMidnight();
    });
    const current = new Date();
    const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
    timer = setTimeout(updateAfterMidnight, Math.max(1000, midnight - current.getTime() + 250));
    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const loaded = await loadDailySkinCheckPair(userId, now);
      setPair(loaded);
      setLoadedFor(`${userId}:${localDateKey(now)}`);
    } catch (loadError) {
      console.warn('[daily-skin-check] local load failed', loadError);
      setError('Could not load your skin check on this device.');
    }
  }, [now, userId]);

  const refreshHistory = useCallback(async () => {
    if (!userId) return;
    setHistoryLoading(true);
    try {
      const loaded = await loadDailySkinCheckHistory(userId, now);
      setHistory(loaded);
      setHistoryOwner(userId);
    } catch (historyError) {
      console.warn('[daily-skin-check] local history load failed', historyError);
      setError('Could not load your skin history on this device.');
    } finally {
      setHistoryLoading(false);
    }
  }, [now, userId]);

  useEffect(() => {
    if (!userId) {
      setPair({ today: null, yesterday: null });
      setHistory([]);
      setHistoryOwner(null);
      setLoadedFor(null);
      setError(null);
      return;
    }
    setLoadedFor(null);
    void refresh();
  }, [ownerKey, refresh, userId]);

  const save = useCallback(async (checkin: DailySkinCheck) => {
    setIsSaving(true);
    setError(null);
    try {
      await saveDailySkinCheck(checkin);
      await refresh();
    } catch (saveError) {
      console.warn('[daily-skin-check] local save failed', saveError);
      setError('Your check-in could not be saved. Please try again.');
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }, [refresh]);

  const removeCheckin = useCallback(async (localDate: string) => {
    if (!userId) return;
    await deleteDailySkinCheck(userId, localDate);
    await refresh();
  }, [refresh, userId]);

  const isCurrentOwner = loadedFor === ownerKey;
  return {
    today: isCurrentOwner ? pair.today : null,
    yesterday: isCurrentOwner ? pair.yesterday : null,
    dateKey,
    isLoading: Boolean(userId && !isCurrentOwner && !error),
    isSaving,
    error,
    history: historyOwner === userId ? history : [],
    historyLoading,
    refresh,
    refreshHistory,
    save,
    removeCheckin,
  };
}
