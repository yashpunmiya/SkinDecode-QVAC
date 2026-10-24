import type { CatalogFormulaRow } from '../types/database.types';

export type CompactAnalysisTuple = {
  attributeId: number;
  stateId: number;
  reportedCount: number | null;
  /** 1-based positions in the formula's ordered ingredient_ids_json array. */
  ingredientPositions: number[];
};

export type DecodedFormulaPayload = {
  ingredientIds: number[];
  flagIds: number[];
  analysis: CompactAnalysisTuple[];
  warnings: string[];
};

function parseJson(value: string, field: string, warnings: string[]): unknown {
  try {
    return JSON.parse(value);
  } catch {
    warnings.push(`${field} could not be decoded.`);
    return null;
  }
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || Number(item) < 1)) return null;
  return value as number[];
}

export function decodeCompactFormula(row: Pick<CatalogFormulaRow, 'ingredient_ids_json' | 'flag_ids_json' | 'analysis_json'>): DecodedFormulaPayload {
  const warnings: string[] = [];
  const rawIngredients = parseJson(row.ingredient_ids_json, 'Ingredient list', warnings);
  const rawFlags = parseJson(row.flag_ids_json, 'Product flags', warnings);
  const rawAnalysis = parseJson(row.analysis_json, 'Ingredient analysis', warnings);
  const ingredientIds = positiveIntegerArray(rawIngredients);
  const flagIds = positiveIntegerArray(rawFlags);

  if (rawIngredients !== null && !ingredientIds) warnings.push('Ingredient list has an unexpected structure.');
  if (rawFlags !== null && !flagIds) warnings.push('Product flags have an unexpected structure.');

  const analysis: CompactAnalysisTuple[] = [];
  if (Array.isArray(rawAnalysis)) {
    rawAnalysis.forEach((tuple, index) => {
      if (!Array.isArray(tuple) || tuple.length !== 4) {
        warnings.push(`Analysis item ${index + 1} has an unexpected structure.`);
        return;
      }
      const [attributeId, stateId, reportedCount, rawIngredientIds] = tuple as unknown[];
      const ingredientRefs = positiveIntegerArray(rawIngredientIds);
      if (!Number.isSafeInteger(attributeId) || Number(attributeId) < 1 || !Number.isSafeInteger(stateId) || Number(stateId) < 0 ||
        (reportedCount !== null && (!Number.isSafeInteger(reportedCount) || Number(reportedCount) < 0)) || !ingredientRefs) {
        warnings.push(`Analysis item ${index + 1} could not be fully decoded.`);
        return;
      }
      analysis.push({
        attributeId: Number(attributeId),
        stateId: Number(stateId),
        reportedCount: reportedCount === null ? null : Number(reportedCount),
        ingredientPositions: ingredientRefs,
      });
    });
  } else if (rawAnalysis !== null) {
    warnings.push('Ingredient analysis has an unexpected structure.');
  }

  return { ingredientIds: ingredientIds || [], flagIds: flagIds || [], analysis, warnings };
}
