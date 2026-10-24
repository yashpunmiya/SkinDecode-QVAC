import type { Href } from 'expo-router';

export function reminderTapDestination(
  data: Record<string, unknown> | undefined,
  activeUserId: string | null | undefined,
): Href | null {
  if (!activeUserId || data?.skindecodeLocalReminder !== true || data.userId !== activeUserId) return null;
  const key = data.reminderKey;
  if (key === 'morning' || key === 'evening') return '/routine';
  if (key === 'skin-check') return '/home';
  return null;
}
