import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { localTimeZone, planLocalReminders, reminderScheduleSignature, shouldSkipReminderReschedule, type ReminderPreferences } from './models';
import { loadScheduleSignature, saveScheduleSignature } from './reminder-storage';
import { deviceAlarm } from '../../modules/skindecode-alarm/src';

const MANAGED_FLAG = 'skindecodeLocalReminder';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

export type ReminderPermission = { granted: boolean; canAskAgain: boolean; status: string };

export async function configureReminderChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    // Omit `sound` to use Android's default notification sound. Passing the
    // string "default" here is interpreted as a custom resource filename.
    Notifications.setNotificationChannelAsync('routine-reminders-v2', { name: 'Routine reminders', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 180], lightColor: '#315d48' }),
    Notifications.setNotificationChannelAsync('skin-reminders-v2', { name: 'Skin check reminders', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 180], lightColor: '#315d48' }),
    Notifications.setNotificationChannelAsync('water-reminders-v2', { name: 'Water reminders', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 120], lightColor: '#315d48' }),
  ]);
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  const permissions = await Notifications.getPermissionsAsync();
  const status = String(permissions.status);
  const iosStatus = Platform.OS === 'ios' ? permissions.ios?.status : undefined;
  const granted = Platform.OS === 'ios'
    ? iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
    : permissions.granted;
  return { granted, canAskAgain: permissions.canAskAgain, status };
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  await configureReminderChannels();
  const current = await getReminderPermission();
  if (current.granted || (current.status !== 'undetermined' && !current.canAskAgain)) return current;
  const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
  const iosStatus = Platform.OS === 'ios' ? requested.ios?.status : undefined;
  return {
    granted: Platform.OS === 'ios'
      ? iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
      : requested.granted,
    canAskAgain: requested.canAskAgain,
    status: String(requested.status),
  };
}

let reconcileQueue: Promise<void> = Promise.resolve();
let activeReminderOwner: string | null = null;

export function setActiveReminderOwner(userId: string | null) {
  activeReminderOwner = userId;
}

export function cancelAllSkinDecodeReminders() {
  reconcileQueue = reconcileQueue.catch(() => undefined).then(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const owned = scheduled.filter((item) => item.content.data?.[MANAGED_FLAG] === true);
    await Promise.all(owned.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
    await deviceAlarm.cancelAll();
  });
  return reconcileQueue;
}

export function reconcileLocalReminders(userId: string, preferences: ReminderPreferences, permission: ReminderPermission) {
  reconcileQueue = reconcileQueue.catch(() => undefined).then(async () => {
    if (activeReminderOwner !== userId) return;
    await configureReminderChannels();
    const signature = reminderScheduleSignature(preferences, localTimeZone());
    const fullPlan = planLocalReminders(preferences);
    const useNativeWaterAlarm = preferences.waterEnabled && preferences.waterReminderStyle === 'alarm';
    const plan = useNativeWaterAlarm ? fullPlan.filter((item) => !item.key.startsWith('water-')) : fullPlan;
    if (plan.length > 20) throw new Error('Reminder schedule exceeds the safe app limit.');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const owned = scheduled.filter((item) => item.content.data?.[MANAGED_FLAG] === true);
    const userOwned = owned.filter((item) => item.content.data?.userId === userId);
    const pendingKeys = userOwned.map((item) => String(item.content.data?.reminderKey ?? ''));
      const savedSignature = await loadScheduleSignature(userId);
    const ownedByOther = owned.some((item) => item.content.data?.userId !== userId);
    if (!useNativeWaterAlarm && shouldSkipReminderReschedule({ permissionGranted: permission.granted, sameAccount: !ownedByOther, savedSignature, currentSignature: signature, plan, pendingKeys })) return;

    await Promise.all(owned.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
    if (permission.granted && activeReminderOwner === userId) {
      for (const reminder of plan) {
        if (activeReminderOwner !== userId) break;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: reminder.body,
            sound: reminder.sound,
            data: {
              [MANAGED_FLAG]: true,
              userId,
              reminderKey: reminder.key,
              ...(reminder.key.startsWith('water-') ? { waterReminderStyle: preferences.waterReminderStyle } : {}),
            },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: reminder.hour, minute: reminder.minute, channelId: reminder.channelId },
        });
      }
    }
    if (useNativeWaterAlarm && !deviceAlarm.supported()) {
      throw new Error('True system alarms require an installed native build and, on iPhone, iOS 26 or later.');
    }
    if (useNativeWaterAlarm) {
      if (deviceAlarm.hasPermission()) {
        const waterTimes = fullPlan.filter((item) => item.key.startsWith('water-')).map((item) => item.hour * 60 + item.minute);
        await deviceAlarm.scheduleDaily(waterTimes, userId);
      } else {
        await deviceAlarm.cancelAll();
        throw new Error('Allow alarm access in system settings to use the water alarm.');
      }
    } else {
      await deviceAlarm.cancelAll();
    }
    await saveScheduleSignature(userId, signature);
  });
  return reconcileQueue;
}
