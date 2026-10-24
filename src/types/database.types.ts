import type {
  AgeRange,
  SensitivityLevel,
  SkinConcern,
  SkinGoal,
  SkinPreference,
  SkinType,
} from '../onboarding/types';

export type UserProfileRow = {
  id: string;
  age_range: AgeRange;
  skin_type: SkinType;
  sensitivity: SensitivityLevel;
  skin_concerns: SkinConcern[];
  skin_goals: SkinGoal[];
  preferences: SkinPreference[];
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
};

export type UserProfileInsert = {
  id: string;
  age_range: AgeRange;
  skin_type: SkinType;
  sensitivity: SensitivityLevel;
  skin_concerns: SkinConcern[];
  skin_goals: SkinGoal[];
  preferences: SkinPreference[];
  onboarding_completed?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type RoutineRow = {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
  change_seq: number;
};

export type RoutineStepRow = {
  id: string;
  routine_id: string;
  user_id: string;
  title: string;
  kind: string;
  period: 'am' | 'pm';
  days_of_week: number[];
  frequency_per_week: number;
  notes: string | null;
  position: number;
  enabled: boolean;
  product_id: number | null;
  shelf_item_id: string | null;
  source_scan_id: string | null;
  recommendation_id: string | null;
  ingredient_context: Record<string, unknown> | null;
  conflict_refs: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
  change_seq: number;
};

export type RoutineLogRow = {
  id: string;
  user_id: string;
  routine_id: string;
  step_id: string;
  log_date: string;
  period: 'am' | 'pm';
  status: 'completed' | 'skipped';
  occurred_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
  change_seq: number;
};

export type ShelfItemRow = {
  id: string;
  user_id: string;
  product_id: number;
  notes: string | null;
  created_at: string;
};

export type CatalogProductRow = {
  id: number;
  brand_id: number;
  name: string;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  description: string | null;
};

export type CatalogBrandRow = { id: number; name: string };
export type CatalogFormulaRow = {
  id: number;
  product_id: number;
  region: string | null;
  formulation: string | null;
  variant: string | null;
  image_url: string | null;
  ingredient_ids_json: string;
  flag_ids_json: string;
  analysis_json: string;
};
export type CatalogIngredientRow = {
  id: number;
  name: string;
  inci_name: string | null;
  inn_name: string | null;
  ph_eur_name: string | null;
  description: string | null;
  functions_json: string | null;
  prevalence_label: string | null;
  prevalence_percent: number | null;
  common_categories_json: string | null;
  typical_list_position: string | null;
};
export type CatalogIngredientAliasRow = { ingredient_id: number; alias: string; normalized_alias: string | null };
export type CatalogAttributeRow = { id: number; key: string; label: string | null; description: string | null };
export type CatalogAnalysisStateRow = { id: number; key: string };
export type CatalogFlagRow = { id: number; key: string; label: string | null };
export type CatalogIngredientAttributeRow = { ingredient_id: number; attribute_id: number };
export type CatalogIngredientReferenceRow = { id: number; ingredient_id: number; url: string; domain: string | null; label: string | null };
export type CatalogLegacyProductRefRow = { product_id: number; product_snapshot: Record<string, unknown> };
export type CatalogSearchProductRow = {
  id: number;
  brand_name: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  product_flags: string[];
  has_more: boolean;
};

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: UserProfileRow;
        Insert: UserProfileInsert;
        Update: Partial<UserProfileInsert>;
        Relationships: [];
      };
      routines: {
        Row: RoutineRow;
        Insert: Omit<RoutineRow, 'created_at' | 'updated_at' | 'deleted_at' | 'is_active' | 'change_seq' | 'sync_version'>
          & Partial<Pick<RoutineRow, 'created_at' | 'updated_at' | 'deleted_at' | 'is_active' | 'change_seq'>>
          & Pick<RoutineRow, 'sync_version'>;
        Update: Partial<RoutineRow>;
        Relationships: [];
      };
      routine_steps: {
        Row: RoutineStepRow;
        Insert: Omit<RoutineStepRow, 'created_at' | 'updated_at' | 'deleted_at' | 'kind' | 'days_of_week' | 'frequency_per_week' | 'notes' | 'position' | 'enabled' | 'product_id' | 'shelf_item_id' | 'source_scan_id' | 'recommendation_id' | 'ingredient_context' | 'conflict_refs' | 'change_seq' | 'sync_version'>
          & Partial<Pick<RoutineStepRow, 'created_at' | 'updated_at' | 'deleted_at' | 'kind' | 'days_of_week' | 'frequency_per_week' | 'notes' | 'position' | 'enabled' | 'product_id' | 'shelf_item_id' | 'source_scan_id' | 'recommendation_id' | 'ingredient_context' | 'conflict_refs' | 'change_seq'>>
          & Pick<RoutineStepRow, 'sync_version'>;
        Update: Partial<RoutineStepRow>;
        Relationships: [];
      };
      routine_logs: {
        Row: RoutineLogRow;
        Insert: Omit<RoutineLogRow, 'created_at' | 'updated_at' | 'deleted_at' | 'occurred_at' | 'notes' | 'change_seq' | 'sync_version'>
          & Partial<Pick<RoutineLogRow, 'created_at' | 'updated_at' | 'deleted_at' | 'occurred_at' | 'notes' | 'change_seq'>>
          & Pick<RoutineLogRow, 'sync_version'>;
        Update: Partial<RoutineLogRow>;
        Relationships: [];
      };
      shelf_items: {
        Row: ShelfItemRow;
        Insert: Omit<ShelfItemRow, 'id' | 'created_at'> & Partial<Pick<ShelfItemRow, 'id' | 'created_at'>>;
        Update: Partial<ShelfItemRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
  skindecode_catalog: {
    Tables: {
      catalog_products: { Row: CatalogProductRow; Insert: never; Update: never; Relationships: [] };
      catalog_brands: { Row: CatalogBrandRow; Insert: never; Update: never; Relationships: [] };
      catalog_formulas: { Row: CatalogFormulaRow; Insert: never; Update: never; Relationships: [] };
      catalog_ingredients: { Row: CatalogIngredientRow; Insert: never; Update: never; Relationships: [] };
      catalog_ingredient_aliases: { Row: CatalogIngredientAliasRow; Insert: never; Update: never; Relationships: [] };
      catalog_attributes: { Row: CatalogAttributeRow; Insert: never; Update: never; Relationships: [] };
      catalog_analysis_states: { Row: CatalogAnalysisStateRow; Insert: never; Update: never; Relationships: [] };
      catalog_flags: { Row: CatalogFlagRow; Insert: never; Update: never; Relationships: [] };
      catalog_ingredient_attributes: { Row: CatalogIngredientAttributeRow; Insert: never; Update: never; Relationships: [] };
      catalog_ingredient_references: { Row: CatalogIngredientReferenceRow; Insert: never; Update: never; Relationships: [] };
      catalog_legacy_product_refs: { Row: CatalogLegacyProductRefRow; Insert: never; Update: never; Relationships: [] };
    };
    Functions: {
      search_products: {
        Args: { search_query: string; page_size?: number; page_offset?: number };
        Returns: CatalogSearchProductRow[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
