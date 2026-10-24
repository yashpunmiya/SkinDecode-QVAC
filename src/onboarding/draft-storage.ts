import * as SecureStore from 'expo-secure-store';
import {
  ageRanges,
  emptyOnboardingAnswers,
  isOneOf,
  sensitivityLevels,
  skinConcerns,
  skinGoals,
  skinPreferences,
  skinTypes,
  type OnboardingAnswers,
  type OnboardingDraft,
  type SkinPreference,
} from './types';

const DRAFT_KEY_PREFIX = 'skindecode:onboarding-draft:v1:';
const LAST_STEP = 7;

function filterOptions<T extends readonly string[]>(values: T, input: unknown, limit?: number): T[number][] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter((value): value is T[number] => isOneOf(values, value));
  return [...new Set(valid)].slice(0, limit ?? valid.length);
}

function sanitizePreferences(values: SkinPreference[]): SkinPreference[] {
  if (values.includes('none')) return ['none'];
  return values;
}

export async function loadOnboardingDraft(userId: string): Promise<OnboardingDraft | null> {
  const serialized = await SecureStore.getItemAsync(`${DRAFT_KEY_PREFIX}${userId}`);
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as Partial<OnboardingDraft>;
    if (draft.version !== 1 || !draft.answers || typeof draft.answers !== 'object') return null;

    const raw = draft.answers as Partial<OnboardingAnswers>;
    const answers: OnboardingAnswers = {
      ageRange: isOneOf(ageRanges, raw.ageRange) ? raw.ageRange : null,
      skinType: isOneOf(skinTypes, raw.skinType) ? raw.skinType : null,
      sensitivity: isOneOf(sensitivityLevels, raw.sensitivity) ? raw.sensitivity : null,
      concerns: filterOptions(skinConcerns, raw.concerns, 3),
      goals: filterOptions(skinGoals, raw.goals, 3),
      preferences: sanitizePreferences(filterOptions(skinPreferences, raw.preferences)),
    };

    const step = typeof draft.step === 'number' && Number.isInteger(draft.step)
      ? Math.max(0, Math.min(LAST_STEP, draft.step))
      : 0;

    return { version: 1, step, answers };
  } catch {
    return { version: 1, step: 0, answers: emptyOnboardingAnswers };
  }
}

export async function saveOnboardingDraft(userId: string, draft: OnboardingDraft): Promise<void> {
  await SecureStore.setItemAsync(`${DRAFT_KEY_PREFIX}${userId}`, JSON.stringify(draft));
}

export async function clearOnboardingDraft(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${DRAFT_KEY_PREFIX}${userId}`);
}
