import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type AlarmNative = {
  addListener?(eventName: 'waterLogRecorded', listener: (event: { pending: boolean }) => void): { remove(): void };
  isAvailable(): boolean;
  hasPermission(): boolean;
  requestPermission(): Promise<boolean>;
  openPermissionSettings(): Promise<void>;
  updateWaterSnapshot?(userId: string, localDate: string, glasses: number, goal: number): Promise<void>;
  setWaterReminderOwner?(userId: string): Promise<void>;
  clearUserData?(userId: string): Promise<void>;
  getPendingWaterLogs?(userId: string): string[];
  acknowledgeWaterLogIds?(userId: string, localDate: string, ids: string[]): Promise<void>;
  scheduleDaily(hours: number[], minutes: number[]): Promise<void>;
  scheduleSnooze?(minutes: number): Promise<void>;
  cancelAll(): Promise<void>;
};

let nativeAlarm: AlarmNative | null = null;
try {
  nativeAlarm = requireNativeModule<AlarmNative>('SkinDecodeAlarm');
} catch {
  // Expo Go and older installed binaries don't contain the native alarm module.
}

export const deviceAlarm = {
  supported: () => Boolean(nativeAlarm?.isAvailable()),
  hasPermission: () => nativeAlarm?.hasPermission() ?? false,
  requestPermission: () => nativeAlarm?.requestPermission() ?? Promise.resolve(false),
  openPermissionSettings: () => nativeAlarm?.openPermissionSettings() ?? Promise.resolve(),
  updateWaterSnapshot: (userId: string, localDate: string, glasses: number, goal: number) => nativeAlarm?.updateWaterSnapshot?.(userId, localDate, glasses, goal) ?? Promise.resolve(),
  getPendingWaterLogs: (userId: string) => nativeAlarm?.getPendingWaterLogs?.(userId) ?? [],
  onWaterLogRecorded: (listener: () => void) => nativeAlarm?.addListener?.('waterLogRecorded', listener) ?? { remove() {} },
  acknowledgeWaterLogIds: (userId: string, localDate: string, ids: string[]) => nativeAlarm?.acknowledgeWaterLogIds?.(userId, localDate, ids) ?? Promise.resolve(),
  scheduleDaily: async (minutesOfDay: number[], userId: string) => {
    if (!nativeAlarm || !nativeAlarm.isAvailable()) return Promise.reject(new Error('Device alarms are not supported in this app build.'));
    const sorted = [...new Set(minutesOfDay)].sort((a, b) => a - b);
    await nativeAlarm.setWaterReminderOwner?.(userId);
    return nativeAlarm.scheduleDaily(sorted.map((m) => Math.floor(m / 60)), sorted.map((m) => m % 60));
  },
  scheduleSnooze: (minutes: number) => nativeAlarm?.scheduleSnooze?.(minutes) ?? Promise.reject(new Error('Alarm snooze is not supported in this app build.')),
  cancelAll: () => nativeAlarm?.cancelAll() ?? Promise.resolve(),
  clearUserData: (userId: string) => {
    if (!nativeAlarm) return Promise.resolve();
    if (!nativeAlarm.clearUserData) return Promise.reject(new Error('Update the app to clear its local water alarm data.'));
    return nativeAlarm.clearUserData(userId);
  },
  platform: Platform.OS,
};
