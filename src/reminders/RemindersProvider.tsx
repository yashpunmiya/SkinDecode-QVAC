import { AppState, Linking } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { BASELINE_REMINDER_PREFERENCES, DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences, type WaterReminderStyle } from './models';
import { clearWaterReminderStyleDraft, consumeWaterReminderStyleDraft, loadReminderPreferenceState, loadWaterReminderStyleDraft, saveReminderPreferences, saveWaterReminderStyleDraft } from './reminder-storage';
import { cancelAllSkinDecodeReminders, getReminderPermission, reconcileLocalReminders, requestReminderPermission, setActiveReminderOwner, type ReminderPermission } from './reminder-service';
import { ReminderPermissionPrompt } from './ReminderPermissionPrompt';
import { reminderTapDestination } from './notification-navigation';
import { deviceAlarm } from '../../modules/skindecode-alarm/src';
import { syncPendingWaterLogs } from '../water/native-water-log-sync';

type RemindersContextValue = {
  preferences: ReminderPreferences;
  permission: ReminderPermission | null;
  isLoading: boolean;
  error: string | null;
  permissionPromptVisible: boolean;
  isRequestingPermission: boolean;
  updatePreferences: (next: ReminderPreferences) => Promise<void>;
  requestPermissionFromPrompt: (waterReminderStyle: WaterReminderStyle) => Promise<void>;
  dismissPermissionPrompt: () => void;
  refreshPermission: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
};

const RemindersContext = createContext<RemindersContextValue | null>(null);

export function RemindersProvider({ userId, children }: PropsWithChildren<{ userId: string | null | undefined }>) {
  const router = useRouter();
  const [preferences, setPreferences] = useState<ReminderPreferences>({ ...DEFAULT_REMINDER_PREFERENCES });
  const [permission, setPermission] = useState<ReminderPermission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPromptDismissed, setIsPromptDismissed] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [promptWaterStyle, setPromptWaterStyle] = useState<WaterReminderStyle>('alarm');
  const generation = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const returningFromSettings = useRef(false);
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;

  useEffect(() => {
    let isMounted = true;
    const handledResponses = new Set<string>();
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const notification = response.notification;
      const data = notification.request.content.data;
      const responseId = `${notification.request.identifier}:${response.actionIdentifier}`;
      if (handledResponses.has(responseId)) return;
      handledResponses.add(responseId);

      // Never route an old account's reminder into the currently signed-in account.
      const destination = reminderTapDestination(data, userId);
      if (destination) {
        router.push(destination);
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (!isMounted || !response) return;
      handleResponse(response);
      await Notifications.clearLastNotificationResponseAsync();
    }).catch((issue) => console.warn('[reminders] notification tap handling failed', issue));

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [router, userId]);

  const ensureGrantedPreferences = useCallback(async (ownerId: string, selectedWaterStyle?: WaterReminderStyle) => {
    const state = await loadReminderPreferenceState(ownerId);
    const draftStyle = selectedWaterStyle ?? await consumeWaterReminderStyleDraft(ownerId);
    const current = state.hasSavedPreferences ? state.preferences : BASELINE_REMINDER_PREFERENCES;
    const next = draftStyle ? { ...current, waterReminderStyle: draftStyle } : { ...current };
    if (!state.hasSavedPreferences || next.waterReminderStyle !== state.preferences.waterReminderStyle) {
      await saveReminderPreferences(ownerId, next);
    }
    return next;
  }, []);

  const refreshPermission = useCallback(async () => {
    const next = await getReminderPermission();
    if (userIdRef.current !== userId) return;
    setPermission(next);
    if (!userId || isLoading) return;
    const current = next.granted ? await ensureGrantedPreferences(userId) : prefsRef.current;
    if (userIdRef.current !== userId) return;
    prefsRef.current = current;
    setPreferences(current);
    await reconcileLocalReminders(userId, current, next);
  }, [ensureGrantedPreferences, isLoading, userId]);

  useEffect(() => {
    const current = ++generation.current;
    if (userId === undefined) return;
    setActiveReminderOwner(userId);
    setIsPromptDismissed(false);
    if (userId === null) {
      setIsLoading(false);
      setPreferences({ ...DEFAULT_REMINDER_PREFERENCES });
      void cancelAllSkinDecodeReminders().catch((issue) => console.warn('[reminders] logout cancellation failed', issue));
      return;
    }

    // Native alarm actions are reconciled globally, even if Home is not the first screen opened.
    void syncPendingWaterLogs(userId).catch((issue) => console.warn('[water-tracker] native reminder sync failed', issue));

    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const [savedState, currentPermission, waterStyleDraft] = await Promise.all([loadReminderPreferenceState(userId), getReminderPermission(), loadWaterReminderStyleDraft(userId)]);
        if (generation.current !== current) return;
        const saved = currentPermission.granted
          ? await ensureGrantedPreferences(userId, waterStyleDraft ?? undefined)
          : savedState.preferences;
        if (currentPermission.granted && waterStyleDraft) await clearWaterReminderStyleDraft(userId);
        if (generation.current !== current) return;
        setPreferences(saved);
        const visibleWaterStyle = waterStyleDraft ?? saved.waterReminderStyle;
        setPromptWaterStyle(visibleWaterStyle);
        const presentedPreferences = visibleWaterStyle === saved.waterReminderStyle ? saved : { ...saved, waterReminderStyle: visibleWaterStyle };
        setPreferences(presentedPreferences);
        prefsRef.current = presentedPreferences;
        setPermission(currentPermission);
        await reconcileLocalReminders(userId, presentedPreferences, currentPermission);
      } catch (issue) {
        console.warn('[reminders] initialization failed', issue);
        if (generation.current === current) setError(issue instanceof Error ? issue.message : 'Reminders could not be loaded. Your settings are still safe on this device.');
      } finally {
        if (generation.current === current) setIsLoading(false);
      }
    })();
    return () => { generation.current += 1; };
  }, [ensureGrantedPreferences, userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void syncPendingWaterLogs(userId).catch((issue) => console.warn('[water-tracker] native reminder sync failed', issue));
      void getReminderPermission().then((next) => {
        if (userIdRef.current !== userId) return;
        setPermission(next);
        const current = next.granted
          ? ensureGrantedPreferences(userId)
          : Promise.resolve(prefsRef.current);
        return current.then((nextPreferences) => {
          if (userIdRef.current !== userId) return;
          prefsRef.current = nextPreferences;
          setPreferences(nextPreferences);
          if (returningFromSettings.current) {
            returningFromSettings.current = false;
            if (!next.granted) setIsPromptDismissed(false);
          }
          return reconcileLocalReminders(userId, nextPreferences, next);
        });
      }).catch((issue) => console.warn('[reminders] foreground refresh failed', issue));
    });
    return () => subscription.remove();
  }, [ensureGrantedPreferences, userId]);

  const requestPermissionFromPrompt = useCallback(async (waterReminderStyle: WaterReminderStyle) => {
    if (!userId) return;
    setIsRequestingPermission(true);
    setError(null);
    try {
      const nextPermission = await requestReminderPermission();
      if (userIdRef.current !== userId) return;
      setPermission(nextPermission);
      if (!nextPermission.granted) return;
      const nextPreferences = await ensureGrantedPreferences(userId, waterReminderStyle);
      if (waterReminderStyle === 'alarm' && nextPreferences.waterEnabled && deviceAlarm.supported()) {
        const alarmPermission = await deviceAlarm.requestPermission();
        if (!alarmPermission) setError('Allow alarm access in system settings to use the water alarm.');
      }
      if (userIdRef.current !== userId) return;
      await clearWaterReminderStyleDraft(userId);
      prefsRef.current = nextPreferences;
      setPreferences(nextPreferences);
      await reconcileLocalReminders(userId, nextPreferences, nextPermission);
      setIsPromptDismissed(true);
    } catch (issue) {
      console.warn('[reminders] permission request failed', issue);
      setError('We couldn’t enable reminders just now. Please try again.');
    } finally {
      setIsRequestingPermission(false);
    }
  }, [ensureGrantedPreferences, userId]);

  const changePromptWaterStyle = useCallback((style: WaterReminderStyle) => {
    setPromptWaterStyle(style);
    const next = { ...prefsRef.current, waterReminderStyle: style };
    prefsRef.current = next;
    setPreferences(next);
    if (userId) void saveWaterReminderStyleDraft(userId, style).catch((issue) => console.warn('[reminders] water mode choice save failed', issue));
  }, [userId]);

  const dismissPermissionPrompt = useCallback(() => setIsPromptDismissed(true), []);

  const updatePreferences = useCallback(async (next: ReminderPreferences) => {
    if (!userId) return;
    setError(null);
    const previous = prefsRef.current;
    const hasNewlyEnabledReminder = (!previous.morningEnabled && next.morningEnabled)
      || (!previous.eveningEnabled && next.eveningEnabled)
      || (!previous.skinCheckEnabled && next.skinCheckEnabled)
      || (!previous.waterEnabled && next.waterEnabled);
    try {
      let nextPermission = permission ?? await getReminderPermission();
      if (hasNewlyEnabledReminder && !nextPermission.granted && (nextPermission.status === 'undetermined' || nextPermission.canAskAgain)) {
        nextPermission = await requestReminderPermission();
      }
      if (userIdRef.current !== userId) return;
      if (next.waterEnabled && next.waterReminderStyle === 'alarm') {
        if (!deviceAlarm.supported()) throw new Error('True system alarms require an installed native build and, on iPhone, iOS 26 or later.');
        if (!deviceAlarm.hasPermission()) {
          const alarmPermission = await deviceAlarm.requestPermission();
          if (!alarmPermission && deviceAlarm.platform === 'ios') throw new Error('Alarm access was not granted. Choose notification mode or enable alarms in system settings.');
        }
      }
      let settingsToSave = next;
      if (nextPermission.granted) {
        const savedState = await loadReminderPreferenceState(userId);
        settingsToSave = savedState.hasSavedPreferences ? next : { ...BASELINE_REMINDER_PREFERENCES, waterReminderStyle: next.waterReminderStyle };
      }
      if (userIdRef.current !== userId) return;
      await saveReminderPreferences(userId, settingsToSave);
      await clearWaterReminderStyleDraft(userId);
      if (userIdRef.current !== userId) return;
      prefsRef.current = settingsToSave;
      setPreferences(settingsToSave);
      setPermission(nextPermission);
      await reconcileLocalReminders(userId, settingsToSave, nextPermission);
    } catch (issue) {
      console.warn('[reminders] settings update failed', issue);
      setError(issue instanceof Error ? issue.message : 'We couldn’t update reminders just now. Please try again.');
    }
  }, [permission, userId]);

  const openSystemSettings = useCallback(async () => {
    returningFromSettings.current = true;
    setIsPromptDismissed(true);
    try { await Linking.openSettings(); }
    catch { setError('Open this app’s system settings to enable notifications.'); }
  }, []);
  const permissionPromptVisible = Boolean(userId && !isLoading && permission && !permission.granted && !isPromptDismissed);
  const value = useMemo(() => ({ preferences, permission, isLoading, error, permissionPromptVisible, isRequestingPermission, updatePreferences, requestPermissionFromPrompt, dismissPermissionPrompt, refreshPermission, openSystemSettings }), [preferences, permission, isLoading, error, permissionPromptVisible, isRequestingPermission, updatePreferences, requestPermissionFromPrompt, dismissPermissionPrompt, refreshPermission, openSystemSettings]);
  return (
    <RemindersContext.Provider value={value}>
      {children}
      <ReminderPermissionPrompt
        visible={permissionPromptVisible}
        canAskAgain={Boolean(permission && (permission.status === 'undetermined' || permission.canAskAgain))}
        isRequesting={isRequestingPermission}
        waterReminderStyle={promptWaterStyle}
        onWaterReminderStyleChange={changePromptWaterStyle}
        onEnable={() => void requestPermissionFromPrompt(promptWaterStyle)}
        onOpenSettings={() => void openSystemSettings()}
        onDismiss={dismissPermissionPrompt}
      />
    </RemindersContext.Provider>
  );
}

export function useReminders() {
  const value = useContext(RemindersContext);
  if (!value) throw new Error('useReminders must be used within RemindersProvider');
  return value;
}
