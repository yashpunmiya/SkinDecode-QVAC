import type { AgeRange, SensitivityLevel, SkinConcern, SkinGoal, SkinPreference, SkinType } from '../onboarding/types';

export type ProductFlag = { id: number; key: string; label: string };

export type ProductSummary = {
  productId: number;
  barcode?: string | null;
  brandId: number | null;
  brand: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  quantity?: string | null;
  imageUrl: string | null;
  description: string | null;
  flags: ProductFlag[];
  matchedIngredients: string[];
  isLegacySnapshot?: boolean;
};

export type ProductIngredient = {
  id: number | null;
  position: number;
  name: string;
  inciName: string | null;
  rawToken: string | null;
  functions: string[];
  description: string | null;
  attributes: IngredientAttribute[];
};

export type FormulaAnalysis = {
  attributeId: number;
  stateId: number;
  reportedCount: number | null;
  ingredientIds: number[];
  key: string | null;
  label: string;
  description: string | null;
  state: string;
  resolved: boolean;
  ingredientPositions: number[];
  responsibleIngredients: ProductIngredient[];
  kind: 'benefit' | 'concern' | 'property';
};

export type ProductFormula = {
  id: number;
  region: string | null;
  formulation: string | null;
  variant: string | null;
  imageUrl: string | null;
  ingredients: ProductIngredient[];
  flags: ProductFlag[];
  analysis: FormulaAnalysis[];
  decodeWarnings: string[];
};

export type ProductDetail = ProductSummary & {
  rawIngredientText?: string | null;
  formulas: ProductFormula[];
  hasParsedFormula: boolean;
};

export type IngredientAttribute = {
  id: number;
  key: string;
  label: string;
  description: string | null;
  kind: 'benefit' | 'concern' | 'property';
};

export type IngredientReference = {
  id: number;
  url: string;
  domain: string | null;
  label: string | null;
};

export type IngredientDetail = {
  id: number;
  name: string;
  inciName: string | null;
  innName: string | null;
  phEurName: string | null;
  description: string | null;
  functions: string[];
  aliases: string[];
  attributes: IngredientAttribute[];
  prevalenceLabel: string | null;
  prevalencePercent: number | null;
  commonCategories: string[];
  typicalListPosition: string | null;
  references: IngredientReference[];
};

export type ShelfItem = {
  id: string;
  productId: number;
  notes: string | null;
  createdAt: string;
  product: ProductSummary | null;
};

export type ProductSearchResult = { items: ProductSummary[]; offline: boolean; hasMore: boolean };

export type SkinProfile = {
  ageRange: AgeRange | null;
  skinType: SkinType | null;
  sensitivity: SensitivityLevel | null;
  concerns: SkinConcern[];
  goals: SkinGoal[];
  preferences: SkinPreference[];
};

export type ProfileMatch = { label: string; ingredientNames: string[]; kind: 'benefit' | 'concern' };
