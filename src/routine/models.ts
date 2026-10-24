export type RoutinePeriod = 'am' | 'pm';
export type RoutineLogStatus = 'completed' | 'skipped';

export type Routine = {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  cloudVersion: number;
};

export type RoutineStep = {
  id: string;
  routineId: string;
  userId: string;
  title: string;
  kind: string;
  period: RoutinePeriod;
  daysOfWeek: number[];
  frequencyPerWeek: number;
  notes: string | null;
  position: number;
  enabled: boolean;
  productId: number | null;
  shelfItemId: string | null;
  sourceScanId: string | null;
  recommendationId: string | null;
  ingredientContext: Record<string, unknown> | null;
  conflictRefs: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  cloudVersion: number;
};

export type RoutineLog = {
  id: string;
  userId: string;
  routineId: string;
  stepId: string;
  logDate: string;
  period: RoutinePeriod;
  status: RoutineLogStatus;
  occurredAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  cloudVersion: number;
};

export type RoutineSnapshot = {
  routines: Routine[];
  steps: RoutineStep[];
  logs: RoutineLog[];
};

export type RoutineDraft = {
  routineId?: string;
  name: string;
  steps: RoutineStepDraft[];
};

export type RoutineStepDraft = Pick<
  RoutineStep,
  | 'id'
  | 'title'
  | 'kind'
  | 'period'
  | 'daysOfWeek'
  | 'frequencyPerWeek'
  | 'notes'
  | 'position'
  | 'enabled'
  | 'productId'
  | 'shelfItemId'
  | 'sourceScanId'
  | 'recommendationId'
  | 'ingredientContext'
  | 'conflictRefs'
>;

export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const WEEK_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function makeLocalId(prefix: string, userId: string) {
  const random = Math.random().toString(36).slice(2, 11);
  return `${prefix}_${userId}_${Date.now().toString(36)}_${random}`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isStepScheduled(step: RoutineStep, date: Date) {
  return step.enabled && step.daysOfWeek.includes(date.getDay());
}

export function getAdherence(logs: RoutineLog[], steps: RoutineStep[], from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let due = 0;
  let completed = 0;
  const completedStepsByDate = new Set(
    logs.filter((log) => log.status === 'completed' && !log.deletedAt)
      .map((log) => `${log.stepId}:${log.logDate}`),
  );

  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const date = localDateKey(day);
    for (const step of steps) {
      if (!isStepScheduled(step, day)) continue;
      due += 1;
      if (completedStepsByDate.has(`${step.id}:${date}`)) completed += 1;
    }
  }

  return { due, completed, percentage: due === 0 ? 0 : Math.round((completed / due) * 100) };
}

export function getStreak(logs: RoutineLog[], steps: RoutineStep[], period: RoutinePeriod, referenceDate = new Date()) {
  const scopedSteps = steps.filter((step) => step.period === period && step.enabled);
  if (!scopedSteps.length) return 0;

  const completedStepsByDate = new Set(
    logs.filter((log) => log.status === 'completed' && log.period === period && !log.deletedAt)
      .map((log) => `${log.stepId}:${log.logDate}`),
  );
  const cursor = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const todayDue = scopedSteps.filter((step) => isStepScheduled(step, cursor));
  if (todayDue.length && !todayDue.every((step) => completedStepsByDate.has(`${step.id}:${localDateKey(cursor)}`))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  for (let days = 0; days < 366; days += 1) {
    const due = scopedSteps.filter((step) => isStepScheduled(step, cursor));
    const date = localDateKey(cursor);
    if (due.length && due.every((step) => completedStepsByDate.has(`${step.id}:${date}`))) {
      streak += 1;
    } else if (due.length) {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
