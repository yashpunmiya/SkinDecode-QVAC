import type { CompactAnalysisTuple } from './compact-formula';
import type { FormulaAnalysis, ProductIngredient } from './types';
import { analysisKind } from './personalization.ts';

export type CatalogAnalysisAttribute = { key: string; label: string | null; description: string | null };
export type CatalogAnalysisState = { key: string };

/** Resolves the compact formula's 1-based ordinal links against that formula's
 * ordered ingredient array. The tuple's final values are positions, never IDs. */
export function resolveFormulaAnalysis(
  entries: CompactAnalysisTuple[],
  attributes: ReadonlyMap<number, CatalogAnalysisAttribute>,
  states: ReadonlyMap<number, CatalogAnalysisState>,
  orderedIngredients: ProductIngredient[],
): FormulaAnalysis[] {
  return entries.map((entry) => {
    const attribute = attributes.get(entry.attributeId);
    const state = states.get(entry.stateId);
    const key = attribute?.key || null;
    const responsibleIngredients = entry.ingredientPositions.flatMap((position) => {
      const ingredient = orderedIngredients[position - 1];
      return ingredient ? [ingredient] : [];
    });
    return {
      attributeId: entry.attributeId,
      stateId: entry.stateId,
      reportedCount: entry.reportedCount,
      ingredientIds: responsibleIngredients.flatMap((ingredient) => ingredient.id === null ? [] : [ingredient.id]),
      key,
      label: attribute?.label || key?.replaceAll('_', ' ') || `Catalog attribute ${entry.attributeId}`,
      description: attribute?.description || null,
      state: state?.key || 'unknown',
      resolved: state?.key === 'resolved_endpoint',
      ingredientPositions: entry.ingredientPositions,
      responsibleIngredients,
      kind: analysisKind(key || ''),
    };
  });
}
