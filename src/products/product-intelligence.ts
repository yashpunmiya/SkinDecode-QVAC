import type { FormulaAnalysis, ProductDetail, ProductFlag, ProductFormula, ProductSummary, SkinProfile } from './types';
import { PREFERENCE_MAPPING, PROFILE_FLAG_MAPPING, profileRuleSets, SENSITIVITY_MAPPING, type RelevanceRule } from './intelligence-mapping.ts';
import { ageRanges, sensitivityLevels, skinConcerns, skinGoals, skinPreferences, skinTypes } from '../onboarding/types.ts';

export type IntelligenceDimension = 'skin_type' | 'concerns' | 'goals' | 'sensitivity' | 'preferences';
export type IntelligenceEvidence = {
  key: string;
  label: string;
  kind: 'benefit' | 'concern';
  dimension: IntelligenceDimension;
  source: 'formula' | 'ingredient' | 'preference' | 'product_flag';
  ingredientNames: string[];
  ingredientIds: number[];
  positions: number[];
  matchedProfileOptions: string[];
  /** Signed change to this dimension's 0–100 sub-score before its safety cap. */
  points: number;
};
export type PreferenceResult = { preference: string; status: 'match' | 'conflict' | 'unknown'; evidence: string[] };
export type ProductIntelligence = {
  /** Null means the catalog does not provide enough relevant evidence for a Skin Match. */
  score: number | null;
  subScores: Record<IntelligenceDimension, number | null>;
  matchLevel: 'excellent' | 'good' | 'mixed' | 'low' | 'insufficient_data';
  scoreStatus: 'complete' | 'partial' | 'insufficient_data';
  confidence: 'high' | 'medium' | 'low' | 'none';
  coverage: { activeDimensions: number; supportedDimensions: number; exactSignals: number; genericSignals: number; knownPreferences: number; selectedPreferences: number };
  evidenceCounts: { exactFormula: number; ingredientAttributes: number; preference: number; productFlags: number; unresolvedFormula: number };
  strongestPositives: IntelligenceEvidence[];
  strongestConcerns: IntelligenceEvidence[];
  exactIngredientEvidence: IntelligenceEvidence[];
  matchedConcerns: string[];
  matchedGoals: string[];
  preferenceResults: PreferenceResult[];
  dataLimitations: string[];
};

const DIMENSION_WEIGHTS: Record<IntelligenceDimension, number> = {
  skin_type: 15,
  concerns: 25,
  goals: 20,
  sensitivity: 30,
  preferences: 10,
};
const EXACT_POSITIVE = 13;
const EXACT_WARNING = 25;
const GENERIC_POSITIVE = 3.5;
const GENERIC_WARNING = 8;
const POSITIVE_EXACT_CAP = 28;
const POSITIVE_GENERIC_CAP = 12;
const POSITIVE_OTHER_CAP = 16;
const NEGATIVE_EXACT_CAP = 42;
const NEGATIVE_GENERIC_CAP = 24;
const NEGATIVE_OTHER_CAP = 22;
const POSITION_BONUS_CAP = 0.05;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const unique = <T,>(items: T[]) => [...new Set(items)];
const allowed = (values: readonly string[], value: unknown): value is string => typeof value === 'string' && values.includes(value);
const nameOf = (ingredient: { inciName: string | null; name: string }) => ingredient.inciName?.trim() || ingredient.name;
const DIMENSION_ORDER: IntelligenceDimension[] = ['skin_type', 'concerns', 'goals', 'sensitivity', 'preferences'];

type ActiveRule = RelevanceRule & { dimension: IntelligenceDimension; profileOption: string; polarity: 'positive' | 'negative' };
type RulesForKey = { positive: ActiveRule[]; negative: ActiveRule[] };
type EvidenceBucket = {
  exactPositive: number; genericPositive: number; otherPositive: number;
  exactNegative: number; genericNegative: number; otherNegative: number;
  sensitivityRisk: number; evidence: IntelligenceEvidence[]; keys: Set<string>;
};

function normalizeProfile(profile: SkinProfile): SkinProfile {
  return {
    ageRange: allowed(ageRanges, profile.ageRange) ? profile.ageRange : null,
    skinType: allowed(skinTypes, profile.skinType) ? profile.skinType : null,
    sensitivity: allowed(sensitivityLevels, profile.sensitivity) ? profile.sensitivity : null,
    concerns: Array.isArray(profile.concerns) ? profile.concerns.filter((value) => allowed(skinConcerns, value)) : [],
    goals: Array.isArray(profile.goals) ? profile.goals.filter((value) => allowed(skinGoals, value)) : [],
    preferences: Array.isArray(profile.preferences) ? profile.preferences.filter((value) => allowed(skinPreferences, value)) : [],
  };
}

function collectRules(profile: SkinProfile): Map<IntelligenceDimension, Map<string, RulesForKey>> {
  const result = new Map<IntelligenceDimension, Map<string, RulesForKey>>();
  const add = (dimension: IntelligenceDimension, value: string, rules: { positive: readonly RelevanceRule[]; negative: readonly RelevanceRule[] }) => {
    const byKey = result.get(dimension) || new Map<string, RulesForKey>();
    for (const [polarity, list] of [['positive', rules.positive], ['negative', rules.negative]] as const) {
      for (const item of list) {
        const entry = byKey.get(item.key) || { positive: [], negative: [] };
        entry[polarity].push({ ...item, dimension, profileOption: value, polarity });
        byKey.set(item.key, entry);
      }
    }
    result.set(dimension, byKey);
  };

  for (const { source, value, map } of profileRuleSets(profile)) {
    if (!map || !value) continue;
    const dimension: IntelligenceDimension = source === 'skin_type' ? 'skin_type' : source === 'concern' ? 'concerns' : 'goals';
    add(dimension, value, map);
  }

  if (profile.sensitivity && profile.sensitivity !== 'not_sure') {
    const attributes = SENSITIVITY_MAPPING[profile.sensitivity].attributes;
    const byKey = result.get('sensitivity') || new Map<string, RulesForKey>();
    for (const key of attributes) {
      const entry = byKey.get(key) || { positive: [], negative: [] };
      entry.negative.push({ key, weight: 1, reason: 'irritation-risk evidence', dimension: 'sensitivity', profileOption: profile.sensitivity, polarity: 'negative' });
      byKey.set(key, entry);
    }
    result.set('sensitivity', byKey);
  }
  return result;
}

function maxRuleWeight(rules: ActiveRule[]) {
  return rules.length ? Math.max(...rules.map((entry) => entry.weight)) : 0;
}

function positionMultiplier(ingredients: ProductFormula['ingredients'], linked: ProductFormula['ingredients']) {
  if (!ingredients.length || !linked.length) return 1;
  const last = Math.max(1, ingredients.length - 1);
  const averageFrontness = linked.reduce((sum, ingredient) => sum + 1 - clamp(ingredient.position, 0, last) / last, 0) / linked.length;
  return 1 + POSITION_BONUS_CAP * averageFrontness;
}

function makeEvidence(input: Omit<IntelligenceEvidence, 'points'>, points: number): IntelligenceEvidence {
  return {
    ...input,
    label: input.key === 'may_cause_acne' ? 'Potential acne-related ingredient signal' : input.label,
    points: Number(points.toFixed(2)),
  };
}

function addSignal(
  buckets: Map<IntelligenceDimension, EvidenceBucket>,
  evidence: IntelligenceEvidence,
  polarity: 'positive' | 'negative',
  signalKey: string,
  sensitivityRisk = 0,
) {
  const bucket = buckets.get(evidence.dimension) || {
    exactPositive: 0, genericPositive: 0, otherPositive: 0,
    exactNegative: 0, genericNegative: 0, otherNegative: 0,
    sensitivityRisk: 0, evidence: [], keys: new Set<string>(),
  };
  const evidenceStrength = evidence.source === 'formula' ? 'exact' : evidence.source === 'ingredient' ? 'generic' : 'other';
  if (polarity === 'positive') {
    if (evidenceStrength === 'exact') bucket.exactPositive += Math.abs(evidence.points);
    else if (evidenceStrength === 'generic') bucket.genericPositive += Math.abs(evidence.points);
    else bucket.otherPositive += Math.abs(evidence.points);
  } else if (evidenceStrength === 'exact') bucket.exactNegative += Math.abs(evidence.points);
  else if (evidenceStrength === 'generic') bucket.genericNegative += Math.abs(evidence.points);
  else bucket.otherNegative += Math.abs(evidence.points);
  bucket.sensitivityRisk += sensitivityRisk;
  bucket.evidence.push(evidence);
  bucket.keys.add(signalKey);
  buckets.set(evidence.dimension, bucket);
}

function sensitivityMultiplier(profile: SkinProfile) {
  if (!profile.sensitivity || profile.sensitivity === 'not_sure') return 1;
  return SENSITIVITY_MAPPING[profile.sensitivity].riskMultiplier;
}

function conflictEvidence(
  preference: string,
  key: string,
  flags: ProductFlag[],
  analyses: FormulaAnalysis[],
  ingredients: ProductFormula['ingredients'],
) {
  const exact = analyses.find((item) => item.resolved && item.key === key && item.responsibleIngredients.length > 0);
  if (exact) return { source: 'formula' as const, linked: exact.responsibleIngredients };
  const linked = ingredients.filter((ingredient) => ingredient.attributes.some((attribute) => attribute.key === key));
  if (linked.length) return { source: 'ingredient' as const, linked };
  return null;
}

/**
 * Produces one auditable sub-score per profile dimension. Exact formula links
 * carry the strongest signal; generic ingredient attributes support them at a
 * lower level. Ingredient order is capped at a 5% multiplier and never implies
 * concentration. Unknown catalog fields contribute zero evidence.
 */
export function scoreProductMatch(product: ProductSummary | ProductDetail, profile: SkinProfile, selectedFormula?: ProductFormula | null): ProductIntelligence {
  const resolvedProfile = normalizeProfile(profile);
  const formulas = 'formulas' in product ? product.formulas : [];
  const formula = selectedFormula === undefined ? formulas[0] || null : selectedFormula;
  const ingredients = formula?.ingredients || [];
  const analyses = formula?.analysis || [];
  const flags = formula ? formula.flags : product.flags;
  const rules = collectRules(resolvedProfile);
  const buckets = new Map<IntelligenceDimension, EvidenceBucket>();
  const exactLinks = new Set<string>();
  const exactKeys = new Set<string>();
  const genericKeys = new Set<string>();
  const exactIngredientEvidence: IntelligenceEvidence[] = [];
  const preferenceResults: PreferenceResult[] = [];

  for (const analysis of analyses) {
    if (!analysis.resolved || !analysis.key || analysis.responsibleIngredients.length === 0) continue;
    const linked = [...new Map(analysis.responsibleIngredients.map((ingredient) => [`${analysis.key}:${ingredient.id ?? ingredient.position}`, ingredient])).values()];
    for (const ingredient of linked) exactLinks.add(`${analysis.key}:${ingredient.id ?? ingredient.position}`);
    for (const dimension of DIMENSION_ORDER) {
      const matched = rules.get(dimension)?.get(analysis.key);
      if (!matched) continue;
      const common = {
        key: analysis.key, label: analysis.label, dimension,
        ingredientNames: unique(linked.map(nameOf)),
        ingredientIds: unique(linked.flatMap((ingredient) => ingredient.id === null ? [] : [ingredient.id])),
        positions: unique(linked.map((ingredient) => ingredient.position + 1)),
        matchedProfileOptions: unique([...matched.positive, ...matched.negative].map((item) => `${dimension}:${item.profileOption}`)),
      };
      const order = positionMultiplier(ingredients, linked);
      const riskScale = dimension === 'sensitivity' ? sensitivityMultiplier(resolvedProfile) : 1;
      const positiveWeight = maxRuleWeight(matched.positive);
      const negativeWeight = maxRuleWeight(matched.negative);
      if (positiveWeight > 0) {
        const evidence = makeEvidence({ ...common, kind: 'benefit', source: 'formula' }, positiveWeight * EXACT_POSITIVE * order);
        addSignal(buckets, evidence, 'positive', `${dimension}:formula:${analysis.key}:positive`);
        exactIngredientEvidence.push(evidence);
        exactKeys.add(`${analysis.key}:positive`);
      }
      if (negativeWeight > 0) {
        const baseRisk = negativeWeight * EXACT_WARNING * order;
        const evidence = makeEvidence({ ...common, kind: 'concern', source: 'formula' }, -baseRisk * riskScale);
        addSignal(buckets, evidence, 'negative', `${dimension}:formula:${analysis.key}:negative`, dimension === 'sensitivity' ? baseRisk : 0);
        exactIngredientEvidence.push(evidence);
        exactKeys.add(`${analysis.key}:negative`);
      }
    }
  }

  const genericSignals = new Map<string, { attribute: ProductFormula['ingredients'][number]['attributes'][number]; ingredients: ProductFormula['ingredients'] }>();
  for (const ingredient of ingredients) {
    for (const attribute of ingredient.attributes) {
      if (exactLinks.has(`${attribute.key}:${ingredient.id ?? ingredient.position}`)) continue;
      const entry = genericSignals.get(attribute.key) || { attribute, ingredients: [] };
      if (!entry.ingredients.some((item) => item.id === ingredient.id && item.position === ingredient.position)) entry.ingredients.push(ingredient);
      genericSignals.set(attribute.key, entry);
    }
  }

  for (const [key, group] of genericSignals) {
    for (const dimension of DIMENSION_ORDER) {
      const matched = rules.get(dimension)?.get(key);
      if (!matched) continue;
      const linked = group.ingredients;
      const common = {
        key, label: group.attribute.label, dimension,
        ingredientNames: unique(linked.map(nameOf)),
        ingredientIds: unique(linked.flatMap((ingredient) => ingredient.id === null ? [] : [ingredient.id])),
        positions: unique(linked.map((ingredient) => ingredient.position + 1)),
        matchedProfileOptions: unique([...matched.positive, ...matched.negative].map((item) => `${dimension}:${item.profileOption}`)),
      };
      const order = positionMultiplier(ingredients, linked);
      const riskScale = dimension === 'sensitivity' ? sensitivityMultiplier(resolvedProfile) : 1;
      const positiveWeight = maxRuleWeight(matched.positive);
      const negativeWeight = maxRuleWeight(matched.negative);
      if (positiveWeight > 0) {
        addSignal(buckets, makeEvidence({ ...common, kind: 'benefit', source: 'ingredient' }, positiveWeight * GENERIC_POSITIVE * order), 'positive', `${dimension}:ingredient:${key}:positive`);
        genericKeys.add(key);
      }
      if (negativeWeight > 0) {
        const baseRisk = negativeWeight * GENERIC_WARNING * order;
        addSignal(buckets, makeEvidence({ ...common, kind: 'concern', source: 'ingredient' }, -baseRisk * riskScale), 'negative', `${dimension}:ingredient:${key}:negative`, dimension === 'sensitivity' ? baseRisk : 0);
        genericKeys.add(key);
      }
    }
  }

  // Preference compatibility is scored only from explicit product flags or
  // explicit mapped ingredient conflicts. An absent flag stays unknown.
  const flagKeys = new Set(flags.map((flag) => flag.key));
  for (const preference of resolvedProfile.preferences.filter((item) => item !== 'none')) {
    const mapping = PREFERENCE_MAPPING[preference];
    const explicitMatches = mapping.matchFlags.filter((key) => flagKeys.has(key));
    const conflicts = mapping.conflictAttributes.flatMap((key) => conflictEvidence(preference, key, flags, analyses, ingredients) ? [key] : []);
    const status: PreferenceResult['status'] = conflicts.length ? 'conflict' : explicitMatches.length ? 'match' : 'unknown';
    const evidenceKeys = unique([...explicitMatches, ...conflicts]);
    preferenceResults.push({ preference, status, evidence: evidenceKeys });
    if (status === 'unknown') continue;
    const point = status === 'conflict' ? -22 : 16;
    const linkedConflict = conflicts.flatMap((key) => conflictEvidence(preference, key, flags, analyses, ingredients)?.linked || []);
    const evidence = makeEvidence({
      key: evidenceKeys[0] || preference,
      label: status === 'conflict' ? `${preference.replaceAll('_', ' ')} conflict` : `${preference.replaceAll('_', ' ')} flag`,
      kind: status === 'conflict' ? 'concern' : 'benefit', dimension: 'preferences',
      source: status === 'conflict' ? conflicts.some((key) => analyses.some((item) => item.key === key && item.resolved)) ? 'formula' : 'ingredient' : 'preference',
      ingredientNames: unique(linkedConflict.map(nameOf)),
      ingredientIds: unique(linkedConflict.flatMap((ingredient) => ingredient.id === null ? [] : [ingredient.id])),
      positions: unique(linkedConflict.map((ingredient) => ingredient.position + 1)),
      matchedProfileOptions: [`preference:${preference}`],
    }, point);
    addSignal(buckets, evidence, status === 'match' ? 'positive' : 'negative', `preferences:${preference}:${status}`);
  }

  // Only these catalog flags state an explicit fit for a supported skin type
  // or concern. Missing flags are not treated as a mismatch.
  let productFlagCount = 0;
  for (const [key, mapping] of Object.entries(PROFILE_FLAG_MAPPING)) {
    const flag = flags.find((candidate) => candidate.key === key);
    if (!flag) continue;
    const contexts: Array<{ dimension: IntelligenceDimension; option: string }> = [
      ...mapping.skinTypes.filter((value) => value === resolvedProfile.skinType).map((option) => ({ dimension: 'skin_type' as const, option })),
      ...mapping.concerns.filter((value) => resolvedProfile.concerns.includes(value)).map((option) => ({ dimension: 'concerns' as const, option })),
      ...mapping.goals.filter((value) => resolvedProfile.goals.includes(value)).map((option) => ({ dimension: 'goals' as const, option })),
    ];
    for (const context of contexts) {
      const evidence = makeEvidence({
        key, label: flag.label, kind: 'benefit', dimension: context.dimension, source: 'product_flag',
        ingredientNames: [], ingredientIds: [], positions: [], matchedProfileOptions: [`${context.dimension}:${context.option}`],
      }, mapping.weight * 4);
      addSignal(buckets, evidence, 'positive', `${context.dimension}:flag:${key}`);
      productFlagCount += 1;
    }
  }

  const unresolvedFormula = analyses.filter((item) => !item.resolved && !!item.key && DIMENSION_ORDER.some((dimension) => rules.get(dimension)?.has(item.key!))).length;
  const activeDimensions = [
    resolvedProfile.skinType && resolvedProfile.skinType !== 'not_sure' ? 'skin_type' : null,
    resolvedProfile.concerns.length ? 'concerns' : null,
    resolvedProfile.goals.length ? 'goals' : null,
    resolvedProfile.sensitivity && resolvedProfile.sensitivity !== 'not_sure' ? 'sensitivity' : null,
    resolvedProfile.preferences.some((value) => value !== 'none') ? 'preferences' : null,
  ].filter((item): item is IntelligenceDimension => item !== null);
  const subScores = Object.fromEntries(DIMENSION_ORDER.map((dimension) => {
    const bucket = buckets.get(dimension);
    if (!bucket || !(
      bucket.exactPositive || bucket.genericPositive || bucket.otherPositive ||
      bucket.exactNegative || bucket.genericNegative || bucket.otherNegative || bucket.sensitivityRisk
    )) return [dimension, null];
    const positive = Math.min(POSITIVE_EXACT_CAP, bucket.exactPositive)
      + Math.min(POSITIVE_GENERIC_CAP, bucket.genericPositive)
      + Math.min(POSITIVE_OTHER_CAP, bucket.otherPositive);
    const risk = dimension === 'sensitivity'
      // Overlapping fragrance/allergen/irritation tags often describe the same
      // underlying ingredient. Diminishing returns keep those aliases from
      // multiplying into a zero score while preserving stronger risk for users
      // who report higher sensitivity.
      ? 30 * (1 - Math.exp(-(bucket.sensitivityRisk * sensitivityMultiplier(resolvedProfile)) / 60))
      : Math.min(NEGATIVE_EXACT_CAP, bucket.exactNegative)
        + Math.min(NEGATIVE_GENERIC_CAP, bucket.genericNegative)
        + Math.min(NEGATIVE_OTHER_CAP, bucket.otherNegative);
    const value = Math.round(clamp(50 + positive - risk, 0, 100));
    // A zero is a failed component score, not additional evidence to average
    // into the final Skin Match. Keep the actual concern in the explanation.
    return [dimension, value === 0 ? null : value];
  })) as Record<IntelligenceDimension, number | null>;

  // Catalog flags can populate transparent sub-scores, but without linked
  // formula/ingredient evidence they do not establish a numeric Skin Match.
  const formulaProfileEvidence = exactKeys.size > 0 || genericKeys.size > 0;
  const parsedFormula = !!formula && ingredients.length > 0;
  const supportedDimensions = DIMENSION_ORDER.filter((dimension) => subScores[dimension] !== null).length;
  const scoreWeight = DIMENSION_ORDER.reduce((sum, dimension) => sum + (subScores[dimension] === null ? 0 : DIMENSION_WEIGHTS[dimension]), 0);
  const score = parsedFormula && formulaProfileEvidence && scoreWeight > 0
    ? Math.round(DIMENSION_ORDER.reduce((sum, dimension) => {
      const component = subScores[dimension];
      return component === null ? sum : sum + component * DIMENSION_WEIGHTS[dimension];
    }, 0) / scoreWeight)
    : null;

  const exactCount = exactKeys.size;
  const genericCount = genericKeys.size;
  const hasAnyKnownEvidence = buckets.size > 0;
  let confidence: ProductIntelligence['confidence'] = score === null ? hasAnyKnownEvidence ? 'low' : 'none'
    : exactCount >= 5 && supportedDimensions >= 3 ? 'high'
      : (exactCount >= 2 || genericCount >= 4) && supportedDimensions >= 2 ? 'medium' : 'low';
  if (confidence === 'high' && (unresolvedFormula > 0 || formula?.decodeWarnings.length)) confidence = 'medium';
  else if (confidence === 'medium' && (unresolvedFormula > 0 || formula?.decodeWarnings.length)) confidence = 'low';

  const scoreStatus: ProductIntelligence['scoreStatus'] = score === null ? hasAnyKnownEvidence ? 'partial' : 'insufficient_data'
    : confidence === 'low' || unresolvedFormula > 0 || !!formula?.decodeWarnings.length ? 'partial' : 'complete';
  const matchLevel: ProductIntelligence['matchLevel'] = score === null ? 'insufficient_data'
    : score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'mixed' : 'low';
  const evidenceAll = [...buckets.values()].flatMap((bucket) => bucket.evidence);
  const sortEvidence = (items: IntelligenceEvidence[]) => {
    const grouped = new Map<string, IntelligenceEvidence>();
    for (const item of items) {
      const identity = `${item.dimension}:${item.kind}:${item.key}`;
      const previous = grouped.get(identity);
      if (!previous) {
        grouped.set(identity, item);
        continue;
      }
      grouped.set(identity, {
        ...previous,
        source: previous.source === 'formula' || item.source === 'formula' ? 'formula' : previous.source,
        ingredientNames: unique([...previous.ingredientNames, ...item.ingredientNames]),
        ingredientIds: unique([...previous.ingredientIds, ...item.ingredientIds]),
        positions: unique([...previous.positions, ...item.positions]),
        matchedProfileOptions: unique([...previous.matchedProfileOptions, ...item.matchedProfileOptions]),
        points: Number((previous.points + item.points).toFixed(2)),
      });
    }
    return [...grouped.values()].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 5);
  };
  const matchedTopics = (dimension: 'concerns' | 'goals') => unique(evidenceAll
    .filter((item) => item.dimension === dimension && item.kind === 'benefit')
    .flatMap((item) => item.matchedProfileOptions.filter((value) => value.startsWith(`${dimension}:`)).map((value) => value.slice(dimension.length + 1))));

  const dataLimitations: string[] = [];
  if (!formula) dataLimitations.push('No selected formula is available, so a Skin Match cannot be calculated.');
  else if (!ingredients.length) dataLimitations.push('This formula has no parsed ingredient list.');
  if (unresolvedFormula) dataLimitations.push(`${unresolvedFormula} relevant formula relationship(s) are unresolved and were excluded from scoring.`);
  if (score === null && formula && ingredients.length) dataLimitations.push('No linked catalog evidence currently matches the selected skin profile. This is unknown, not a negative match.');
  if (resolvedProfile.skinType === 'normal') dataLimitations.push('The catalog has no direct suitability attribute for normal skin, so skin type is not scored.');
  if (resolvedProfile.skinType === 'not_sure') dataLimitations.push('Skin type is not scored because no skin type was selected.');
  if (resolvedProfile.sensitivity === 'not_sure') dataLimitations.push('Sensitivity risk is not scored because sensitivity is not known.');
  if (resolvedProfile.goals.includes('maintain')) dataLimitations.push('The catalog has no direct maintenance goal attribute, so that goal is not scored.');
  if (resolvedProfile.preferences.some((value) => value !== 'none') && preferenceResults.some((item) => item.status === 'unknown')) {
    dataLimitations.push('An absent preference flag is unknown, not a match or conflict.');
  }
  if (formula?.decodeWarnings.length) dataLimitations.push('Some compact formula fields could not be decoded; confidence is reduced.');

  return {
    score, subScores, matchLevel, scoreStatus, confidence,
    coverage: {
      activeDimensions: activeDimensions.length, supportedDimensions,
      exactSignals: exactCount, genericSignals: genericCount,
      knownPreferences: preferenceResults.filter((item) => item.status !== 'unknown').length,
      selectedPreferences: preferenceResults.length,
    },
    evidenceCounts: { exactFormula: exactCount, ingredientAttributes: genericCount, preference: preferenceResults.filter((item) => item.status !== 'unknown').length, productFlags: productFlagCount, unresolvedFormula },
    strongestPositives: sortEvidence(evidenceAll.filter((item) => item.kind === 'benefit')),
    strongestConcerns: sortEvidence(evidenceAll.filter((item) => item.kind === 'concern')),
    exactIngredientEvidence: exactIngredientEvidence.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    matchedConcerns: matchedTopics('concerns'), matchedGoals: matchedTopics('goals'), preferenceResults, dataLimitations,
  };
}

export function scoreFormulaForProfile(product: ProductDetail, formulaId: number | null, profile: SkinProfile) {
  return scoreProductMatch(product, profile, product.formulas.find((item) => item.id === formulaId) || null);
}

export function scoreSummaryForProfile(product: ProductSummary, profile: SkinProfile) {
  return scoreProductMatch(product, profile, null);
}

export function productIntelligenceSummary(result: ProductIntelligence): string | null {
  if (result.score === null || result.scoreStatus === 'insufficient_data') return null;
  return `${result.score} Skin Match`;
}
