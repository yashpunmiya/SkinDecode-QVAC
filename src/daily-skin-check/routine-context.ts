import { localDateKey, type RoutineSnapshot, type RoutinePeriod } from '../routine/models.ts';
import type { DailyRoutineContext } from './rules';

function periodCompleted(snapshot: RoutineSnapshot, activeRoutineIds: Set<string>, date: Date, period: RoutinePeriod) {
  const dateKey = localDateKey(date);
  const scheduledSteps = snapshot.steps.filter((step) => activeRoutineIds.has(step.routineId)
    && step.enabled && !step.deletedAt && step.period === period && step.daysOfWeek.includes(date.getDay()));

  // A rest day (or no routine yet) is not a missed routine.
  return scheduledSteps.length === 0 || scheduledSteps.every((step) => snapshot.logs.some((log) =>
    log.stepId === step.id && log.logDate === dateKey && log.status === 'completed' && !log.deletedAt,
  ));
}

export function buildDailyRoutineContext(snapshot: RoutineSnapshot, now = new Date()): DailyRoutineContext {
  const activeRoutineIds = new Set(snapshot.routines.filter((routine) => routine.isActive && !routine.deletedAt).map((routine) => routine.id));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();
  const newProductStarted = snapshot.steps.some((step) => {
    if (!activeRoutineIds.has(step.routineId) || !step.enabled || step.deletedAt
      || (step.productId === null && !step.shelfItemId)) return false;
    const lastChanged = Math.max(Date.parse(step.createdAt) || 0, Date.parse(step.updatedAt) || 0);
    return lastChanged >= yesterdayStart && lastChanged <= now.getTime();
  });

  return {
    yesterdayAmCompleted: periodCompleted(snapshot, activeRoutineIds, yesterday, 'am'),
    yesterdayPmCompleted: periodCompleted(snapshot, activeRoutineIds, yesterday, 'pm'),
    todayAmCompleted: periodCompleted(snapshot, activeRoutineIds, now, 'am'),
    todayPmCompleted: periodCompleted(snapshot, activeRoutineIds, now, 'pm'),
    newProductStarted,
  };
}
