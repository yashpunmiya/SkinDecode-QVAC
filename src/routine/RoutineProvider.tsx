import { AppState } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { generateRoutineFromProfile } from './generate-routine';
import type { RoutineDraft, RoutineLogStatus, RoutinePeriod, RoutineSnapshot, RoutineStep } from './models';
import { getRoutineSnapshot, saveRoutineDraft, setRoutineStepLog } from './routine-database';
import { syncRoutineBackup } from './routine-sync';

type RoutineLoadStatus = 'loading' | 'ready' | 'error';

type RoutineContextValue = {
  status: RoutineLoadStatus;
  error: string | null;
  syncError: string | null;
  isSyncing: boolean;
  isSaving: boolean;
  snapshot: RoutineSnapshot;
  activeRoutineId: string | null;
  stepsForPeriod: (period: RoutinePeriod) => RoutineStep[];
  refresh: () => Promise<void>;
  retrySync: () => Promise<void>;
  saveDraft: (draft: RoutineDraft) => Promise<void>;
  setStepStatus: (step: RoutineStep, value: RoutineLogStatus | null, date?: Date) => Promise<void>;
};

const emptySnapshot: RoutineSnapshot = { routines: [], steps: [], logs: [] };
const RoutineContext = createContext<RoutineContextValue | null>(null);

export function RoutineProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [snapshot, setSnapshot] = useState<RoutineSnapshot>(emptySnapshot);
  const [snapshotOwnerId, setSnapshotOwnerId] = useState<string | null>(null);
  const [status, setStatus] = useState<RoutineLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const generation = useRef(0);
  const syncTasks = useRef(new Map<string, Promise<RoutineSnapshot | null>>());
  const rerunAfterSync = useRef(new Set<string>());
  const scheduledSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledUser = useRef<string | null>(null);
  const retryAt = useRef(0);
  const retryDelay = useRef(5_000);

  const commitSnapshot = useCallback((ownerId: string, next: RoutineSnapshot) => {
    setSnapshot(next);
    setSnapshotOwnerId(ownerId);
  }, []);

  const sync = useCallback(async (id: string, reason: 'startup' | 'foreground' | 'mutation' | 'manual') => {
    const retryIsAutomatic = reason !== 'manual';
    if (retryIsAutomatic && Date.now() < retryAt.current) return null;
    const active = syncTasks.current.get(id);
    if (active) {
      if (reason === 'mutation' || reason === 'manual') rerunAfterSync.current.add(id);
      return active;
    }
    const syncGeneration = generation.current;
    const task = (async (): Promise<RoutineSnapshot | null> => {
      setIsSyncing(true);
      let latest: RoutineSnapshot | null = null;
      try {
        do {
          rerunAfterSync.current.delete(id);
          latest = await syncRoutineBackup(id);
          if (generation.current !== syncGeneration) return null;
          commitSnapshot(id, latest);
          setSyncError(null);
          retryAt.current = 0;
          retryDelay.current = 5_000;
        } while (rerunAfterSync.current.has(id) && generation.current === syncGeneration);
        return latest;
      } catch (syncIssue) {
        console.warn('[routine-sync] backup sync failed; local changes remain queued.', syncIssue);
        if (generation.current === syncGeneration) {
          setSyncError('Your routine is saved on this device. Backup will retry later.');
          retryAt.current = Date.now() + retryDelay.current;
          retryDelay.current = Math.min(retryDelay.current * 2, 5 * 60_000);
        }
        return null;
      } finally {
        if (generation.current === syncGeneration) setIsSyncing(false);
        rerunAfterSync.current.delete(id);
      }
    })();
    syncTasks.current.set(id, task);
    try { return await task; }
    finally { if (syncTasks.current.get(id) === task) syncTasks.current.delete(id); }
  }, [commitSnapshot]);

  const queueMutationSync = useCallback((id: string) => {
    if (scheduledSync.current) clearTimeout(scheduledSync.current);
    scheduledUser.current = id;
    scheduledSync.current = setTimeout(() => {
      scheduledSync.current = null;
      scheduledUser.current = null;
      void sync(id, 'mutation');
    }, 700);
  }, [sync]);

  const initialize = useCallback(async () => {
    if (!userId) {
      generation.current += 1;
      if (scheduledSync.current) clearTimeout(scheduledSync.current);
      scheduledSync.current = null;
      scheduledUser.current = null;
      setSnapshot(emptySnapshot);
      setSnapshotOwnerId(null);
      setStatus('loading');
      setError(null);
      setSyncError(null);
      return;
    }

    const currentGeneration = ++generation.current;
    if (scheduledSync.current && scheduledUser.current !== userId) clearTimeout(scheduledSync.current);
    scheduledSync.current = null;
    scheduledUser.current = null;
    setStatus('loading');
    setError(null);
    setSyncError(null);

    try {
      const local = await getRoutineSnapshot(userId);
      if (generation.current !== currentGeneration) return;
      if (local.routines.length > 0) {
        commitSnapshot(userId, local);
        setStatus('ready');
        void sync(userId, 'startup');
        return;
      }

      // Read a cloud backup before creating defaults, so an reinstall restores
      // the user's own routine instead of replacing it with generated steps.
      const cloudSnapshot = await sync(userId, 'startup');
      if (generation.current !== currentGeneration) return;
      if (cloudSnapshot?.routines.length) {
        commitSnapshot(userId, cloudSnapshot);
        setStatus('ready');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('skin_type, sensitivity, skin_concerns, skin_goals')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error('Your skin profile is not available yet. Please retry in a moment.');

      const draft = generateRoutineFromProfile(userId, profile);
      const generated = await saveRoutineDraft(userId, draft);
      if (generation.current !== currentGeneration) return;
      commitSnapshot(userId, generated);
      setStatus('ready');
      queueMutationSync(userId);
    } catch (loadIssue) {
      if (generation.current !== currentGeneration) return;
      console.warn('Could not prepare the skincare routine:', loadIssue);
      setError('We could not load your routine yet. Check your connection and try again.');
      setStatus('error');
    }
  }, [commitSnapshot, queueMutationSync, sync, userId]);

  useEffect(() => {
    void initialize();
    return () => {
      generation.current += 1;
      if (scheduledSync.current) clearTimeout(scheduledSync.current);
      scheduledSync.current = null;
      scheduledUser.current = null;
    };
  }, [initialize]);

  useEffect(() => {
    if (!userId || status !== 'ready') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync(userId, 'foreground');
    });
    return () => subscription.remove();
  }, [status, sync, userId]);

  const refresh = useCallback(async () => {
    await initialize();
  }, [initialize]);

  const retrySync = useCallback(async () => {
    retryAt.current = 0;
    if (userId) await sync(userId, 'manual');
  }, [sync, userId]);

  const saveDraft = useCallback(async (draft: RoutineDraft) => {
    if (!userId) throw new Error('Please sign in again to save your routine.');
    setIsSaving(true);
    try {
      const next = await saveRoutineDraft(userId, draft);
      commitSnapshot(userId, next);
      queueMutationSync(userId);
    } finally {
      setIsSaving(false);
    }
  }, [commitSnapshot, queueMutationSync, userId]);

  const setStepStatus = useCallback(async (step: RoutineStep, value: RoutineLogStatus | null, date?: Date) => {
    if (!userId) throw new Error('Please sign in again to update your routine.');
    const next = await setRoutineStepLog(userId, step, value, date);
    commitSnapshot(userId, next);
    queueMutationSync(userId);
  }, [commitSnapshot, queueMutationSync, userId]);

  const visibleSnapshot = userId && snapshotOwnerId === userId ? snapshot : emptySnapshot;
  const activeRoutineId = visibleSnapshot.routines.find((routine) => routine.isActive)?.id
    || visibleSnapshot.routines[0]?.id
    || null;
  const stepsForPeriod = useCallback((period: RoutinePeriod) => visibleSnapshot.steps
    .filter((step) => step.routineId === activeRoutineId && step.period === period && step.enabled)
    .sort((first, second) => first.position - second.position), [activeRoutineId, visibleSnapshot.steps]);

  const value = useMemo<RoutineContextValue>(() => ({
    status, error, syncError, isSyncing, isSaving, snapshot: visibleSnapshot, activeRoutineId, stepsForPeriod,
    refresh, retrySync, saveDraft, setStepStatus,
  }), [status, error, syncError, isSyncing, isSaving, visibleSnapshot, activeRoutineId, stepsForPeriod, refresh, retrySync, saveDraft, setStepStatus]);

  return <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>;
}

export function useRoutine() {
  const context = useContext(RoutineContext);
  if (!context) throw new Error('useRoutine must be used inside RoutineProvider.');
  return context;
}
