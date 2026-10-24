import type { SensitivityLevel, SkinConcern, SkinGoal, SkinType } from '../onboarding/types';
import type { RoutineDraft, RoutinePeriod, RoutineStepDraft } from './models';
import { makeLocalId } from './models';

export type RoutineSkinProfile = {
  skin_type: SkinType;
  sensitivity: SensitivityLevel;
  skin_concerns: SkinConcern[];
  skin_goals: SkinGoal[];
};

function makeStep(
  userId: string,
  period: RoutinePeriod,
  position: number,
  title: string,
  kind: string,
  options: Partial<Pick<RoutineStepDraft, 'daysOfWeek' | 'frequencyPerWeek' | 'notes'>> = {},
): RoutineStepDraft {
  const days = options.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
  return {
    id: makeLocalId('step', userId),
    title,
    kind,
    period,
    daysOfWeek: days,
    frequencyPerWeek: options.frequencyPerWeek ?? days.length,
    notes: options.notes ?? null,
    position,
    enabled: true,
    productId: null,
    shelfItemId: null,
    sourceScanId: null,
    recommendationId: null,
    ingredientContext: null,
    conflictRefs: [],
  };
}

export function generateRoutineFromProfile(userId: string, profile: RoutineSkinProfile): RoutineDraft {
  const steps: RoutineStepDraft[] = [
    makeStep(userId, 'am', 0, 'Cleanse / rinse', 'cleanse', {
      notes: profile.skin_type === 'dry' || profile.sensitivity === 'high'
        ? 'A water rinse can be enough if your skin feels dry or sensitive.'
        : null,
    }),
    makeStep(userId, 'am', 1, 'Moisturizer', 'moisturizer', {
      notes: profile.sensitivity === 'high' ? 'Keep the formula gentle and fragrance-free.' : null,
    }),
    makeStep(userId, 'am', 2, 'SPF', 'spf', { notes: 'Use a broad-spectrum sunscreen as directed on its label.' }),
    makeStep(userId, 'pm', 3, 'Cleanser', 'cleanse'),
  ];

  const treatmentConcerns = new Set<SkinConcern>([
    'acne', 'dark_spots', 'redness', 'texture', 'pores', 'fine_lines', 'dullness',
  ]);
  const treatmentGoals = new Set<SkinGoal>([
    'clear_acne', 'even_tone', 'reduce_redness', 'smooth_texture', 'anti_aging',
  ]);
  const relevantConcerns = profile.skin_concerns.filter((concern) => treatmentConcerns.has(concern));
  const goalSuggestsTreatment = profile.skin_goals.some((goal) => treatmentGoals.has(goal));
  const treatmentIsSuitableToOffer = profile.sensitivity === 'low' || profile.sensitivity === 'moderate';

  if (treatmentIsSuitableToOffer && (relevantConcerns.length > 0 || goalSuggestsTreatment)) {
    const reason = relevantConcerns[0]?.replace('_', ' ') || 'your skin goals';
    const treatmentDays = profile.sensitivity === 'low' ? [1, 3, 5] : [1, 4];
    steps.push(makeStep(userId, 'pm', 4, 'Treatment', 'treatment', {
      daysOfWeek: treatmentDays,
      frequencyPerWeek: treatmentDays.length,
      notes: `Optional targeted step for ${reason}. Introduce one product at a time and follow its label.`,
    }));
  }

  steps.push(makeStep(userId, 'pm', steps.length, 'Moisturizer', 'moisturizer', {
    notes: profile.skin_type === 'dry' || profile.skin_concerns.includes('dryness')
      ? 'Choose a texture that leaves your skin comfortable.'
      : null,
  }));

  return { name: 'My skincare routine', steps };
}
