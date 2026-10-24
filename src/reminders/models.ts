export type WaterReminderInterval = 2 | 3;
export type WaterReminderStyle = 'alarm' | 'notification';

export type ReminderPreferences = {
  morningEnabled: boolean;
  morningTimeMinutes: number;
  eveningEnabled: boolean;
  eveningTimeMinutes: number;
  skinCheckEnabled: boolean;
  skinCheckTimeMinutes: number;
  waterEnabled: boolean;
  waterStartMinutes: number;
  waterEndMinutes: number;
  waterIntervalHours: WaterReminderInterval;
  waterReminderStyle: WaterReminderStyle;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  morningEnabled: false,
  morningTimeMinutes: 8 * 60,
  eveningEnabled: false,
  eveningTimeMinutes: 20 * 60,
  skinCheckEnabled: false,
  skinCheckTimeMinutes: 20 * 60 + 30,
  waterEnabled: false,
  waterStartMinutes: 9 * 60,
  waterEndMinutes: 21 * 60,
  waterIntervalHours: 3,
  waterReminderStyle: 'alarm',
};

export const BASELINE_REMINDER_PREFERENCES: ReminderPreferences = {
  morningEnabled: true,
  morningTimeMinutes: 9 * 60,
  eveningEnabled: true,
  eveningTimeMinutes: 19 * 60,
  skinCheckEnabled: true,
  skinCheckTimeMinutes: 20 * 60 + 30,
  waterEnabled: true,
  waterStartMinutes: 8 * 60,
  waterEndMinutes: 22 * 60,
  waterIntervalHours: 2,
  waterReminderStyle: 'alarm',
};

export type PlannedReminder = {
  key: string;
  title: string;
  body: string;
  channelId: 'routine-reminders-v2' | 'skin-reminders-v2' | 'water-reminders-v2';
  sound: boolean;
  hour: number;
  minute: number;
};

function toClock(minutes: number) {
  const safe = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return { hour: Math.floor(safe / 60), minute: safe % 60 };
}

export function planLocalReminders(preferences: ReminderPreferences): PlannedReminder[] {
  const reminders: PlannedReminder[] = [];
  const add = (key: string, title: string, body: string, channelId: PlannedReminder['channelId'], minutes: number, sound = true) => {
    reminders.push({ key, title, body, channelId, sound, ...toClock(minutes) });
  };

  if (preferences.morningEnabled) add('morning', 'Morning routine', 'A moment for your morning routine.', 'routine-reminders-v2', preferences.morningTimeMinutes);
  if (preferences.eveningEnabled) add('evening', 'Evening routine', 'Your evening routine is ready.', 'routine-reminders-v2', preferences.eveningTimeMinutes);
  if (preferences.skinCheckEnabled) add('skin-check', 'Daily skin check', 'Take a moment to compare yesterday and today.', 'skin-reminders-v2', preferences.skinCheckTimeMinutes);

  const start = Math.max(0, Math.min(1439, Math.floor(preferences.waterStartMinutes)));
  const end = Math.max(0, Math.min(1439, Math.floor(preferences.waterEndMinutes)));
  const interval = preferences.waterIntervalHours === 2 ? 120 : 180;
  if (preferences.waterEnabled && end > start) {
    // Same-day window only. This guarantees no reminders spill into the next day.
    for (let at = start; at <= end && reminders.length < 20; at += interval) {
      const clock = toClock(at);
      add(
        `water-${String(clock.hour).padStart(2, '0')}${String(clock.minute).padStart(2, '0')}`,
        'Water reminder',
        'A little water break, if you’d like.',
        'water-reminders-v2',
        at,
        true,
      );
    }
  }
  return reminders;
}

export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; }
  catch { return 'local'; }
}

export function reminderScheduleSignature(preferences: ReminderPreferences, timeZone = localTimeZone()) {
  const reminders = planLocalReminders(preferences).map(({ key, title, body, channelId, hour, minute, sound }) => `${key}@${hour}:${minute}:${title}:${body}:${channelId}:${sound}`);
  return `${timeZone}|water-mode:${preferences.waterReminderStyle}|${reminders.join('|')}`;
}

export function reminderPlanMatchesPending(plan: PlannedReminder[], pendingKeys: string[]) {
  const expected = plan.map((item) => item.key).sort();
  const actual = [...pendingKeys].sort();
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

export function shouldSkipReminderReschedule(input: {
  permissionGranted: boolean;
  sameAccount: boolean;
  savedSignature: string | null;
  currentSignature: string;
  plan: PlannedReminder[];
  pendingKeys: string[];
}) {
  return input.permissionGranted
    && input.sameAccount
    && input.savedSignature === input.currentSignature
    && reminderPlanMatchesPending(input.plan, input.pendingKeys);
}
