import type { FormulaAnalysis, ProductFlag, ProductIngredient, ProfileMatch, SkinProfile } from './types';
import { CATALOG_ATTRIBUTE_KEYS, PREFERENCE_MAPPING, profileRuleSets, SENSITIVITY_MAPPING } from './intelligence-mapping.ts';

export function profileAttributeKeys(profile: SkinProfile): Set<string> {
  const requestedTerms = new Set<string>();
  for (const { map } of profileRuleSets(profile)) {
    if (!map) continue;
    for (const item of [...map.positive, ...map.negative]) requestedTerms.add(item.key);
  }
  for (const key of SENSITIVITY_MAPPING[profile.sensitivity || 'not_sure'].attributes) requestedTerms.add(key);
  for (const preference of profile.preferences) PREFERENCE_MAPPING[preference].conflictAttributes.forEach((key) => requestedTerms.add(key));
  for (const key of [...requestedTerms]) if (!(CATALOG_ATTRIBUTE_KEYS as readonly string[]).includes(key)) requestedTerms.delete(key);
  return requestedTerms;
}

export function analysisKind(key: string): FormulaAnalysis['kind'] {
  // Positive phrasing must win before the generic irritation/skin terms below:
  // e.g. `reduces_irritation` is a benefit, while `may_cause_irritation` is a concern.
  if (/^(helps_with_|good_for_|reduces_|hydrating$|brightening$|acne_fighter$|uv_protection|antioxidant|vitamin_c|peptide)/i.test(key)) return 'benefit';
  if (/(^bad_for_|^can_worsen_|^may_|irritat|allergen|essential_oil|synthetic_fragrance|^fragrance$|dry_skin)/i.test(key)) return 'concern';
  if (/barrier_repair/i.test(key)) return 'benefit';
  return 'property';
}

export function profileMatches(profile: SkinProfile | null, analyses: FormulaAnalysis[], ingredients: ProductIngredient[] = []): ProfileMatch[] {
  if (!profile) return [];
  const requestedTerms = profileAttributeKeys(profile);

  const matches = new Map<string, ProfileMatch>();
  for (const analysis of analyses) {
    if (!analysis.resolved || !analysis.key || !analysis.responsibleIngredients.length) continue;
    if (!requestedTerms.has(analysis.key)) continue;
    const kind = analysis.kind === 'concern' ? 'concern' : 'benefit';
    const existing = matches.get(analysis.key);
    const names = analysis.responsibleIngredients.map((ingredient) => ingredient.inciName || ingredient.name);
    matches.set(analysis.key, {
      label: analysis.label,
      kind,
      ingredientNames: [...new Set([...(existing?.ingredientNames || []), ...names])],
    });
  }
  for (const ingredient of ingredients) {
    for (const attribute of ingredient.attributes) {
      if (!requestedTerms.has(attribute.key)) continue;
      const kind = attribute.kind === 'concern' ? 'concern' : 'benefit';
      const existing = matches.get(attribute.key);
      const ingredientName = ingredient.inciName || ingredient.name;
      matches.set(attribute.key, {
        label: attribute.label,
        kind,
        ingredientNames: [...new Set([...(existing?.ingredientNames || []), ingredientName])],
      });
    }
  }
  return [...matches.values()].slice(0, 8);
}

export function profileFlagMatches(profile: SkinProfile | null, flags: ProductFlag[]): ProfileMatch[] {
  if (!profile) return [];
  const preferenceLabels: Record<string, string> = {
    fragrance_free: 'Fragrance-free',
    vegan: 'Vegan',
    cruelty_free: 'Cruelty-free',
    avoid_alcohol: 'Alcohol-free',
  };
  const flagByKey = new Map(flags.map((flag) => [flag.key, flag]));
  return profile.preferences.flatMap((preference) => {
    if (preference === 'none') return [];
    const key = preference === 'avoid_alcohol' ? 'alcohol_free' : preference;
    const flag = flagByKey.get(key);
    return flag ? [{ label: preferenceLabels[preference] || flag.label, kind: 'benefit' as const, ingredientNames: [] }] : [];
  });
}
