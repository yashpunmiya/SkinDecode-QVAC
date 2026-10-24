import type { SkinConcern, SkinGoal, SkinPreference, SkinType } from '../onboarding/types';
import type { SkinProfile } from './types';

/** Snapshot of the live skindecode_catalog.catalog_attributes keys (IDs 1–66). */
export const CATALOG_ATTRIBUTE_KEYS = [
  'synthetic_fragrance', 'fragrance', 'hydrating', 'exfoliant', 'peptide', 'antioxidant',
  'may_cause_irritation', 'preservative', 'can_worsen_eczema', 'silicon', 'helps_with_dark_spots',
  'vitamin_c', 'brightening', 'reduces_large_pores', 'good_for_texture', 'helps_with_anti_aging',
  'bad_for_coral_reefs', 'reduces_redness', 'eu_allergen', 'good_for_scar_healing', 'rucinol',
  'uv_protection', 'chemical_uv_filter', 'reduces_irritation', 'acne_fighter', 'oil', 'essential_oil',
  'can_worsen_perioral_dermatitis', 'can_worsen_psoriasis', 'can_worsen_seborrheic_dermatitis',
  'may_feed_fungal_acne', 'ceramide', 'hyaluronic_acid', 'coconut_derived', 'can_worsen_oily_skin',
  'may_cause_acne', 'can_worsen_keratosis_pilaris', 'retinoid', 'good_for_oily_skin', 'can_worsen_rosacea',
  'alcohol', 'can_worsen_dry_skin', 'helps_with_barrier_repair', 'arbutin', 'sulfate', 'aha',
  'fatty_alcohol', 'azelaic_acid', 'bakuchiol', 'benzoyl_peroxide', 'may_irritate_lips', 'paraben',
  'bha', 'niacinamide', 'spf_booster', 'ectoin', 'pha', 'thiamidol', 'kojic_acid', 'propolis',
  'snail_mucin', 'mineral_uv_filter', 'vitamin_e', 'tranexamic_acid', 'urea', 'zinc',
] as const;

/** The exact 46 attribute IDs referenced by live compact formula analysis payloads. */
export const FORMULA_ATTRIBUTE_IDS = [3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15, 16, 18, 20, 21, 23, 24, 25, 32, 33, 35, 36, 38, 39, 40, 42, 43, 44, 46, 48, 49, 50, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66] as const;

export const CATALOG_FLAG_KEYS = [
  'alcohol_free', 'cruelty_free', 'eu_allergen_free', 'fragrance_free', 'fungal_acne_safe', 'oil_free',
  'paraben_free', 'pore_clogger_free', 'reef_safe', 'silicone_free', 'sulfate_free', 'vegan',
] as const;

export type RelevanceRule = { key: string; weight: number; reason: string };
export type ProfileOptionMapping = { positive: readonly RelevanceRule[]; negative: readonly RelevanceRule[]; note?: string };

const rule = (key: string, weight = 1, reason?: string): RelevanceRule => ({ key, weight, reason: reason || key.replaceAll('_', ' ') });
const mapping = (positive: RelevanceRule[] = [], negative: RelevanceRule[] = [], note?: string): ProfileOptionMapping => ({ positive, negative, note });

/** Only semantically direct keys are mapped. Related but unsupported conditions are not inferred. */
export const SKIN_TYPE_MAPPING: Record<SkinType, ProfileOptionMapping> = {
  oily: mapping([rule('good_for_oily_skin'), rule('niacinamide', 0.4)], [
    rule('can_worsen_oily_skin', 0.65),
    rule('may_cause_acne', 0.3, 'ingredient-level acne potential; not a finished-product outcome'),
  ]),
  dry: mapping([rule('hydrating'), rule('helps_with_barrier_repair'), rule('ceramide', 0.45), rule('hyaluronic_acid', 0.45), rule('urea', 0.45)], [rule('can_worsen_dry_skin')]),
  combination: mapping([rule('good_for_oily_skin', 0.55), rule('hydrating', 0.55), rule('helps_with_barrier_repair', 0.45)], [rule('can_worsen_oily_skin', 0.4), rule('can_worsen_dry_skin', 0.55), rule('may_cause_acne', 0.25, 'ingredient-level acne potential; not a finished-product outcome')]),
  normal: mapping([], [], 'The catalog has no direct “normal skin” suitability attribute.'),
  not_sure: mapping([], [], 'No skin-type assumption is made.'),
};

export const CONCERN_MAPPING: Record<SkinConcern, ProfileOptionMapping> = {
  acne: mapping([rule('acne_fighter'), rule('benzoyl_peroxide', 0.65), rule('azelaic_acid', 0.55), rule('bha', 0.45), rule('niacinamide', 0.45), rule('zinc', 0.35)], [rule('may_cause_acne', 0.4, 'ingredient-level acne potential; not a finished-product outcome'), rule('may_cause_irritation', 0.45)]),
  dark_spots: mapping([rule('helps_with_dark_spots'), rule('brightening'), rule('vitamin_c', 0.7), rule('arbutin', 0.7), rule('rucinol', 0.7), rule('thiamidol', 0.7), rule('kojic_acid', 0.7), rule('tranexamic_acid', 0.7), rule('vitamin_e', 0.35)]),
  redness: mapping([rule('reduces_redness'), rule('reduces_irritation'), rule('propolis', 0.35)], [rule('may_cause_irritation'), rule('fragrance', 0.6), rule('synthetic_fragrance', 0.6), rule('essential_oil', 0.6), rule('eu_allergen', 0.45)]),
  dryness: mapping([rule('hydrating'), rule('helps_with_barrier_repair'), rule('ceramide', 0.45), rule('hyaluronic_acid', 0.45), rule('snail_mucin', 0.35), rule('ectoin', 0.35), rule('urea', 0.35)], [rule('can_worsen_dry_skin')]),
  oiliness: mapping([rule('good_for_oily_skin')], [rule('can_worsen_oily_skin')]),
  texture: mapping([rule('good_for_texture'), rule('exfoliant', 0.6), rule('aha', 0.4), rule('bha', 0.4), rule('pha', 0.4), rule('urea', 0.3)], [rule('may_cause_irritation', 0.35)]),
  pores: mapping([rule('reduces_large_pores'), rule('bha', 0.35)], [rule('may_cause_acne', 0.25, 'ingredient-level acne potential; not a finished-product outcome'), rule('can_worsen_oily_skin', 0.3)]),
  fine_lines: mapping([rule('helps_with_anti_aging'), rule('peptide', 0.65), rule('retinoid', 0.65), rule('bakuchiol', 0.65), rule('antioxidant', 0.4), rule('vitamin_c', 0.35)], [rule('may_cause_irritation', 0.35)]),
  dullness: mapping([rule('brightening'), rule('antioxidant', 0.55), rule('vitamin_c', 0.55), rule('helps_with_dark_spots', 0.4)]),
};

export const GOAL_MAPPING: Record<SkinGoal, ProfileOptionMapping> = {
  clear_acne: CONCERN_MAPPING.acne,
  even_tone: mapping([rule('helps_with_dark_spots'), rule('brightening'), rule('vitamin_c', 0.65), rule('arbutin', 0.65), rule('rucinol', 0.65), rule('thiamidol', 0.65), rule('kojic_acid', 0.65), rule('tranexamic_acid', 0.65)], [rule('may_cause_irritation', 0.25)]),
  hydrate: mapping([rule('hydrating'), rule('hyaluronic_acid', 0.55), rule('urea', 0.4), rule('snail_mucin', 0.4), rule('ectoin', 0.35)], [rule('can_worsen_dry_skin', 0.65)]),
  repair_barrier: mapping([rule('helps_with_barrier_repair'), rule('reduces_irritation', 0.65), rule('ceramide', 0.55), rule('niacinamide', 0.45), rule('ectoin', 0.4)], [rule('may_cause_irritation', 0.55), rule('fragrance', 0.35), rule('synthetic_fragrance', 0.35)]),
  reduce_redness: CONCERN_MAPPING.redness,
  smooth_texture: CONCERN_MAPPING.texture,
  anti_aging: CONCERN_MAPPING.fine_lines,
  maintain: mapping([], [], 'The catalog does not contain a direct maintenance goal attribute.'),
};

export type PreferenceMapping = { matchFlags: readonly string[]; conflictAttributes: readonly string[]; note?: string };
export const PREFERENCE_MAPPING: Record<SkinPreference, PreferenceMapping> = {
  fragrance_free: { matchFlags: ['fragrance_free'], conflictAttributes: ['synthetic_fragrance', 'fragrance', 'essential_oil'] },
  vegan: { matchFlags: ['vegan'], conflictAttributes: [] },
  cruelty_free: { matchFlags: ['cruelty_free'], conflictAttributes: [] },
  avoid_alcohol: { matchFlags: ['alcohol_free'], conflictAttributes: ['alcohol'], note: 'The catalog distinguishes drying alcohol from fatty alcohol.' },
  none: { matchFlags: [], conflictAttributes: [], note: 'No preference requested.' },
};

/** Non-preference catalog flags with direct fit to supported profile options. */
export const PROFILE_FLAG_MAPPING = {
  oil_free: { skinTypes: ['oily', 'combination'] as const, concerns: ['oiliness'] as const, goals: [] as const, sensitivity: [] as const, weight: 2.2 },
  pore_clogger_free: { skinTypes: [] as const, concerns: ['acne', 'pores'] as const, goals: ['clear_acne'] as const, sensitivity: [] as const, weight: 2.5 },
} as const;

export const SENSITIVITY_MAPPING = {
  low: { riskMultiplier: 0.8, attributes: ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen', 'alcohol'] },
  moderate: { riskMultiplier: 1.35, attributes: ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen', 'alcohol'] },
  high: { riskMultiplier: 1.9, attributes: ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen', 'alcohol'] },
  not_sure: { riskMultiplier: 1, attributes: ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen', 'alcohol'] },
} as const;

export function profileRuleSets(profile: SkinProfile) {
  return [
    { source: 'skin_type' as const, value: profile.skinType, map: profile.skinType ? SKIN_TYPE_MAPPING[profile.skinType] : null },
    ...profile.concerns.map((value) => ({ source: 'concern' as const, value, map: CONCERN_MAPPING[value] })),
    ...profile.goals.map((value) => ({ source: 'goal' as const, value, map: GOAL_MAPPING[value] })),
  ].filter((entry) => entry.map !== null);
}

export function mappedAttributeKeys(): Set<string> {
  const keys = new Set<string>();
  const groups: ProfileOptionMapping[] = [...Object.values(SKIN_TYPE_MAPPING), ...Object.values(CONCERN_MAPPING), ...Object.values(GOAL_MAPPING)];
  for (const group of groups) for (const item of [...group.positive, ...group.negative]) keys.add(item.key);
  for (const preference of Object.values(PREFERENCE_MAPPING)) preference.conflictAttributes.forEach((key) => keys.add(key));
  SENSITIVITY_MAPPING.high.attributes.forEach((key) => keys.add(key));
  return keys;
}

export function auditCatalogMapping() {
  const attributeKeys = mappedAttributeKeys();
  const flagKeys = new Set<string>([
    ...Object.values(PREFERENCE_MAPPING).flatMap((preference) => preference.matchFlags),
    ...Object.keys(PROFILE_FLAG_MAPPING),
  ]);
  return {
    supportedOptions: {
      skinTypes: Object.keys(SKIN_TYPE_MAPPING).length,
      sensitivity: Object.keys(SENSITIVITY_MAPPING).length,
      concerns: Object.keys(CONCERN_MAPPING).length,
      goals: Object.keys(GOAL_MAPPING).length,
      preferences: Object.keys(PREFERENCE_MAPPING).length,
    },
    catalogAttributeCount: CATALOG_ATTRIBUTE_KEYS.length,
    mappedAttributeCount: attributeKeys.size,
    mappingKeysMissingFromCatalog: [...attributeKeys].filter((key) => !(CATALOG_ATTRIBUTE_KEYS as readonly string[]).includes(key)).sort(),
    catalogAttributesUnusedByProfile: CATALOG_ATTRIBUTE_KEYS.filter((key) => !attributeKeys.has(key)),
    formulaAttributeCount: FORMULA_ATTRIBUTE_IDS.length,
    formulaAttributesUnmappedToCatalog: FORMULA_ATTRIBUTE_IDS.filter((id) => !CATALOG_ATTRIBUTE_KEYS[id - 1]),
    formulaAttributesWithoutProfileRule: FORMULA_ATTRIBUTE_IDS.map((id) => CATALOG_ATTRIBUTE_KEYS[id - 1]).filter((key) => key && !attributeKeys.has(key)),
    catalogFlagCount: CATALOG_FLAG_KEYS.length,
    mappedFlagCount: flagKeys.size,
    mappingFlagsMissingFromCatalog: [...flagKeys].filter((key) => !(CATALOG_FLAG_KEYS as readonly string[]).includes(key)).sort(),
    catalogFlagsUnusedByProfile: CATALOG_FLAG_KEYS.filter((key) => !flagKeys.has(key)),
  };
}
