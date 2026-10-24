export const ageRanges = ['under_18', '18_24', '25_34', '35_44', '45_plus'] as const;
export type AgeRange = (typeof ageRanges)[number];

export const skinTypes = ['oily', 'dry', 'combination', 'normal', 'not_sure'] as const;
export type SkinType = (typeof skinTypes)[number];

export const sensitivityLevels = ['low', 'moderate', 'high', 'not_sure'] as const;
export type SensitivityLevel = (typeof sensitivityLevels)[number];

export const skinConcerns = [
  'acne',
  'dark_spots',
  'redness',
  'dryness',
  'oiliness',
  'texture',
  'pores',
  'fine_lines',
  'dullness',
] as const;
export type SkinConcern = (typeof skinConcerns)[number];

export const skinGoals = [
  'clear_acne',
  'even_tone',
  'hydrate',
  'repair_barrier',
  'reduce_redness',
  'smooth_texture',
  'anti_aging',
  'maintain',
] as const;
export type SkinGoal = (typeof skinGoals)[number];

export const skinPreferences = [
  'fragrance_free',
  'vegan',
  'cruelty_free',
  'avoid_alcohol',
  'none',
] as const;
export type SkinPreference = (typeof skinPreferences)[number];

export type OnboardingAnswers = {
  ageRange: AgeRange | null;
  skinType: SkinType | null;
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  goals: SkinGoal[];
  preferences: SkinPreference[];
};

export type OnboardingDraft = {
  version: 1;
  step: number;
  answers: OnboardingAnswers;
};

export const emptyOnboardingAnswers: OnboardingAnswers = {
  ageRange: null,
  skinType: null,
  sensitivity: null,
  concerns: [],
  goals: [],
  preferences: [],
};

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}
