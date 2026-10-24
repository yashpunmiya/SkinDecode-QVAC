import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCompactFormula } from '../src/products/compact-formula.ts';
import { analysisKind, profileFlagMatches, profileMatches } from '../src/products/personalization.ts';

const row = (ingredientIds, flagIds, analysis) => ({
  ingredient_ids_json: JSON.stringify(ingredientIds),
  flag_ids_json: JSON.stringify(flagIds),
  analysis_json: JSON.stringify(analysis),
});

test('compact decoder preserves ordered and repeated ingredient and flag IDs', () => {
  const decoded = decodeCompactFormula(row([9, 2, 9], [4, 1], []));
  assert.deepEqual(decoded.ingredientIds, [9, 2, 9]);
  assert.deepEqual(decoded.flagIds, [4, 1]);
  assert.deepEqual(decoded.warnings, []);
});

test('compact decoder preserves analysis states, counts, and 1-based ingredient positions', () => {
  const decoded = decodeCompactFormula(row([9, 2], [4], [[43, 1, 2, [2, 9]], [6, 3, null, []]]));
  assert.deepEqual(decoded.analysis, [
    { attributeId: 43, stateId: 1, reportedCount: 2, ingredientPositions: [2, 9] },
    { attributeId: 6, stateId: 3, reportedCount: null, ingredientPositions: [] },
  ]);
});

test('analysis positions resolve through ordered formula ingredient IDs, not as ingredient IDs', () => {
  const orderedIngredientIds = [33923, 19914, 23304, 34206];
  const decoded = decodeCompactFormula(row(orderedIngredientIds, [], [[25, 1, 2, [2, 4]]]));
  const linkedIngredientIds = decoded.analysis[0].ingredientPositions.map((position) => orderedIngredientIds[position - 1]);
  assert.deepEqual(linkedIngredientIds, [19914, 34206]);
});

test('malformed compact payload fields degrade to empty values and report warnings', () => {
  const decoded = decodeCompactFormula({ ingredient_ids_json: '{', flag_ids_json: '["x"]', analysis_json: '[]' });
  assert.deepEqual(decoded.ingredientIds, []);
  assert.deepEqual(decoded.flagIds, []);
  assert.equal(decoded.warnings.length, 2);
});

test('analysis categories and skin profile matches use only resolved stored relationships', () => {
  assert.equal(analysisKind('may_cause_irritation'), 'concern');
  assert.equal(analysisKind('helps_with_barrier_repair'), 'benefit');
  const profile = { ageRange: '25_34', skinType: 'dry', sensitivity: 'moderate', concerns: ['dryness'], goals: ['repair_barrier'], preferences: [] };
  const ingredients = [{ id: 2, name: 'Glycerin', inciName: 'Glycerin', attributes: [] }];
  const resolved = [{ attributeId: 43, stateId: 1, reportedCount: 1, ingredientPositions: [2], key: 'helps_with_barrier_repair', label: 'Helps With Barrier Repair', description: null, state: 'resolved_endpoint', resolved: true, responsibleIngredients: ingredients, kind: 'benefit' }];
  const unresolved = [{ ...resolved[0], state: 'unresolved_lazy', resolved: false }];
  assert.deepEqual(profileMatches(profile, resolved).map((match) => match.ingredientNames), [['Glycerin']]);
  assert.deepEqual(profileMatches(profile, unresolved), []);
});

test('profile preference matches are based on flags present on the selected formula', () => {
  const profile = { ageRange: null, skinType: null, sensitivity: null, concerns: [], goals: [], preferences: ['fragrance_free', 'vegan', 'none'] };
  assert.deepEqual(profileFlagMatches(profile, [{ id: 4, key: 'fragrance_free', label: 'Fragrance-free' }]).map((item) => item.label), ['Fragrance-free']);
});
