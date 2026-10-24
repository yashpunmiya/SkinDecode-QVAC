import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_REMINDER_PREFERENCES, DEFAULT_REMINDER_PREFERENCES, planLocalReminders, reminderPlanMatchesPending, reminderScheduleSignature, shouldSkipReminderReschedule } from '../src/reminders/models.ts';
import { reminderTapDestination } from '../src/reminders/notification-navigation.ts';

test('disabled reminders schedule nothing', () => {
  assert.deepEqual(planLocalReminders(DEFAULT_REMINDER_PREFERENCES), []);
});

test('first-grant baseline uses the requested local schedule', () => {
  const plan = planLocalReminders(BASELINE_REMINDER_PREFERENCES);
  assert.deepEqual(plan.slice(0, 3).map(({ key, hour, minute }) => [key, hour, minute]), [
    ['morning', 9, 0], ['evening', 19, 0], ['skin-check', 20, 30],
  ]);
  assert.deepEqual(plan.slice(3).map(({ hour, minute }) => [hour, minute]), [
    [8, 0], [10, 0], [12, 0], [14, 0], [16, 0], [18, 0], [20, 0], [22, 0],
  ]);
});

test('real alarm mode and notification mode keep a distinct deterministic schedule', () => {
  const alarmPlan = planLocalReminders(BASELINE_REMINDER_PREFERENCES).filter(({ key }) => key.startsWith('water-'));
  assert.equal(alarmPlan.length, 8);
  assert.ok(alarmPlan.every((item) => item.sound === true && item.channelId === 'water-reminders-v2'));

  const notificationPreferences = { ...BASELINE_REMINDER_PREFERENCES, waterReminderStyle: 'notification' };
  const notificationPlan = planLocalReminders(notificationPreferences).filter(({ key }) => key.startsWith('water-'));
  assert.ok(notificationPlan.every((item) => item.sound === true && item.channelId === 'water-reminders-v2'));
  assert.deepEqual(alarmPlan.map(({ key }) => key), notificationPlan.map(({ key }) => key));
  assert.notEqual(reminderScheduleSignature(BASELINE_REMINDER_PREFERENCES), reminderScheduleSignature(notificationPreferences));
});

test('water reminders begin at start and stay inside the selected daily window', () => {
  const plan = planLocalReminders({ ...DEFAULT_REMINDER_PREFERENCES, waterEnabled: true, waterStartMinutes: 9 * 60, waterEndMinutes: 16 * 60, waterIntervalHours: 3 });
  assert.deepEqual(plan.map(({ hour, minute }) => `${hour}:${String(minute).padStart(2, '0')}`), ['9:00', '12:00', '15:00']);
});

test('two-hour schedule includes only times through the end boundary', () => {
  const plan = planLocalReminders({ ...DEFAULT_REMINDER_PREFERENCES, waterEnabled: true, waterStartMinutes: 8 * 60 + 30, waterEndMinutes: 14 * 60 + 30, waterIntervalHours: 2 });
  assert.deepEqual(plan.map(({ hour, minute }) => [hour, minute]), [[8, 30], [10, 30], [12, 30], [14, 30]]);
});

test('invalid or overnight water windows do not leak reminders into another day', () => {
  const plan = planLocalReminders({ ...DEFAULT_REMINDER_PREFERENCES, waterEnabled: true, waterStartMinutes: 21 * 60, waterEndMinutes: 8 * 60, waterIntervalHours: 2 });
  assert.equal(plan.length, 0);
});

test('enabled reminders produce unique stable keys and stay within a conservative limit', () => {
  const preferences = { ...DEFAULT_REMINDER_PREFERENCES, morningEnabled: true, eveningEnabled: true, skinCheckEnabled: true, waterEnabled: true, waterIntervalHours: 2 };
  const first = planLocalReminders(preferences);
  const second = planLocalReminders(preferences);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((item) => item.key)).size, first.length);
  assert.ok(first.length <= 15);
});

test('pending notification identity prevents duplicates, while changed settings reschedule', () => {
  const preferences = { ...DEFAULT_REMINDER_PREFERENCES, morningEnabled: true };
  const plan = planLocalReminders(preferences);
  const signature = reminderScheduleSignature(preferences, 'Asia/Kolkata');
  assert.equal(shouldSkipReminderReschedule({ permissionGranted: true, sameAccount: true, savedSignature: signature, currentSignature: signature, plan, pendingKeys: ['morning'] }), true);
  assert.equal(shouldSkipReminderReschedule({ permissionGranted: true, sameAccount: true, savedSignature: signature, currentSignature: `${signature}changed`, plan, pendingKeys: ['morning'] }), false);
  assert.equal(shouldSkipReminderReschedule({ permissionGranted: true, sameAccount: true, savedSignature: signature, currentSignature: signature, plan, pendingKeys: [] }), false);
});

test('permission denial, account changes, and timezone changes trigger reconciliation', () => {
  const prefs = { ...DEFAULT_REMINDER_PREFERENCES, skinCheckEnabled: true };
  const plan = planLocalReminders(prefs);
  const saved = reminderScheduleSignature(prefs, 'Asia/Kolkata');
  const base = { savedSignature: saved, currentSignature: saved, plan, pendingKeys: ['skin-check'] };
  assert.equal(shouldSkipReminderReschedule({ ...base, permissionGranted: false, sameAccount: true }), false);
  assert.equal(shouldSkipReminderReschedule({ ...base, permissionGranted: true, sameAccount: false }), false);
  assert.equal(shouldSkipReminderReschedule({ ...base, permissionGranted: true, sameAccount: true, currentSignature: reminderScheduleSignature(prefs, 'Europe/London') }), false);
});

test('a missing app-owned notification forces safe recreation after restart', () => {
  const prefs = { ...DEFAULT_REMINDER_PREFERENCES, morningEnabled: true, eveningEnabled: true };
  const plan = planLocalReminders(prefs);
  assert.equal(reminderPlanMatchesPending(plan, ['morning']), false);
  assert.equal(reminderPlanMatchesPending(plan, ['morning', 'evening']), true);
});

test('notification taps route by reminder and never cross user accounts', () => {
  const data = { skindecodeLocalReminder: true, userId: 'user-a', reminderKey: 'morning' };
  assert.equal(reminderTapDestination(data, 'user-a'), '/routine');
  assert.equal(reminderTapDestination({ ...data, reminderKey: 'skin-check' }, 'user-a'), '/home');
  assert.equal(reminderTapDestination({ ...data, reminderKey: 'water-0800' }, 'user-a'), null);
  assert.equal(reminderTapDestination(data, 'user-b'), null);
  assert.equal(reminderTapDestination(data, null), null);
  assert.equal(reminderTapDestination({ ...data, skindecodeLocalReminder: false }, 'user-a'), null);
});
