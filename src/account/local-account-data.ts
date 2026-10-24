import { clearOnboardingDraft } from '../onboarding/draft-storage';
import { deleteUserDailySkinData } from '../daily-skin-check/storage';
import { deleteUserRoutineData } from '../routine/routine-database';
import { deleteUserReminderData } from '../reminders/reminder-storage';
import { cancelAllSkinDecodeReminders } from '../reminders/reminder-service';
import { deleteUserWaterData } from '../water/water-tracker';
import { clearSkinAIHistory } from '../skin-ai/storage';
import { deleteUserShelfCache } from '../products/product-cache';
import { invalidateSkinProfileCache } from '../products/catalog-service';
import { deviceAlarm } from '../../modules/skindecode-alarm/src';

export async function clearLocalAccountData(userId: string) {
  const tasks = await Promise.allSettled([
    clearOnboardingDraft(userId),
    deleteUserDailySkinData(userId),
    deleteUserRoutineData(userId),
    deleteUserReminderData(userId),
    deleteUserWaterData(userId),
    clearSkinAIHistory(userId),
    deleteUserShelfCache(userId),
    cancelAllSkinDecodeReminders(),
    deviceAlarm.clearUserData(userId),
  ]);
  invalidateSkinProfileCache(userId);
  return tasks.some((task) => task.status === 'rejected');
}
