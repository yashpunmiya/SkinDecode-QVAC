-- Compact, indexed formula features for personalized product candidate lookup.
-- The materialized view is intentionally refreshed only after a catalog import;
-- app roles have SELECT only and cannot modify catalog or recommendation data.
CREATE MATERIALIZED VIEW IF NOT EXISTS skindecode_catalog.catalog_product_match_features AS
WITH source AS (
  SELECT
    f.id AS formula_id,
    f.product_id,
    p.category,
    p.subcategory,
    f.variant,
    f.formulation,
    f.region,
    jsonb_array_length(f.ingredient_ids_json::jsonb)::integer AS ingredient_count,
    jsonb_array_length(f.analysis_json::jsonb)::integer AS analysis_attribute_count,
    COALESCE((
      SELECT count(*)::integer
      FROM jsonb_array_elements(f.analysis_json::jsonb) AS analysis(value)
      JOIN skindecode_catalog.catalog_analysis_states state
        ON state.id = (analysis.value->>1)::smallint AND state.key = 'resolved_endpoint'
      WHERE jsonb_typeof(analysis.value->3) = 'array'
        AND jsonb_array_length(analysis.value->3) > 0
    ), 0) AS resolved_analysis_count,
    COALESCE((
      SELECT array_agg(DISTINCT (analysis.value->>0)::smallint ORDER BY (analysis.value->>0)::smallint)
      FROM jsonb_array_elements(f.analysis_json::jsonb) AS analysis(value)
      JOIN skindecode_catalog.catalog_analysis_states state
        ON state.id = (analysis.value->>1)::smallint AND state.key = 'resolved_endpoint'
      WHERE jsonb_typeof(analysis.value->3) = 'array'
        AND jsonb_array_length(analysis.value->3) > 0
    ), ARRAY[]::smallint[]) AS resolved_attribute_ids,
    COALESCE((
      SELECT array_agg(DISTINCT link.attribute_id ORDER BY link.attribute_id)
      FROM jsonb_array_elements_text(f.ingredient_ids_json::jsonb) ingredient(value)
      JOIN skindecode_catalog.catalog_ingredient_attributes link
        ON link.ingredient_id = ingredient.value::integer
    ), ARRAY[]::smallint[]) AS ingredient_attribute_ids,
    COALESCE(ARRAY(
      SELECT DISTINCT flag.value::smallint
      FROM jsonb_array_elements_text(f.flag_ids_json::jsonb) flag(value)
      ORDER BY flag.value::smallint
    ), ARRAY[]::smallint[]) AS flag_ids
  FROM skindecode_catalog.catalog_formulas f
  JOIN skindecode_catalog.catalog_products p ON p.id = f.product_id
), counted AS (
  SELECT source.*,
    GREATEST(analysis_attribute_count - resolved_analysis_count, 0)::integer AS unresolved_analysis_count
  FROM source
)
SELECT
  formula_id, product_id, category, subcategory, variant, formulation, region,
  resolved_attribute_ids, ingredient_attribute_ids, flag_ids,
  ingredient_count, analysis_attribute_count,
  resolved_analysis_count,
  unresolved_analysis_count,
  CASE
    WHEN ingredient_count = 0 THEN 'none'
    WHEN cardinality(resolved_attribute_ids) = 0 THEN 'low'
    WHEN unresolved_analysis_count = 0 THEN 'high'
    ELSE 'medium'
  END::text AS data_confidence
FROM counted
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_product_match_features_formula_uidx
  ON skindecode_catalog.catalog_product_match_features (formula_id);
CREATE INDEX IF NOT EXISTS catalog_product_match_features_category_idx
  ON skindecode_catalog.catalog_product_match_features (category, product_id);
CREATE INDEX IF NOT EXISTS catalog_product_match_features_product_idx
  ON skindecode_catalog.catalog_product_match_features (product_id);
CREATE INDEX IF NOT EXISTS catalog_product_match_features_resolved_gin_idx
  ON skindecode_catalog.catalog_product_match_features USING gin (resolved_attribute_ids);
CREATE INDEX IF NOT EXISTS catalog_product_match_features_ingredient_attrs_gin_idx
  ON skindecode_catalog.catalog_product_match_features USING gin (ingredient_attribute_ids);
CREATE INDEX IF NOT EXISTS catalog_product_match_features_flags_gin_idx
  ON skindecode_catalog.catalog_product_match_features USING gin (flag_ids);

COMMENT ON MATERIALIZED VIEW skindecode_catalog.catalog_product_match_features IS
  'Compact per-formula features for profile-aware candidate lookup. Refresh after each validated catalog import.';

GRANT SELECT ON skindecode_catalog.catalog_product_match_features TO authenticated;

CREATE OR REPLACE FUNCTION skindecode_catalog.better_match_candidates(
  p_current_product_id integer,
  p_category text,
  p_positive_rules jsonb DEFAULT '[]'::jsonb,
  p_warning_rules jsonb DEFAULT '[]'::jsonb,
  p_sensitive_attribute_ids smallint[] DEFAULT ARRAY[]::smallint[],
  p_sensitivity_multiplier real DEFAULT 1,
  p_flag_weights jsonb DEFAULT '[]'::jsonb,
  p_conflict_attribute_ids smallint[] DEFAULT ARRAY[]::smallint[],
  p_limit integer DEFAULT 24
)
RETURNS TABLE (
  product_id integer,
  formula_id integer,
  category text,
  subcategory text,
  data_confidence text,
  shortlist_score real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, skindecode_catalog
AS $function$
DECLARE
  result_limit integer := greatest(1, least(coalesce(p_limit, 24), 24));
  positive_ids smallint[];
  warning_ids smallint[];
  profile_flag_ids smallint[];
  candidate_attribute_ids smallint[];
BEGIN
  IF p_category IS NULL OR btrim(p_category) = '' THEN RETURN; END IF;

  SELECT coalesce(array_agg(attribute_id), ARRAY[]::smallint[])
    INTO positive_ids
  FROM jsonb_to_recordset(coalesce(p_positive_rules, '[]'::jsonb)) AS rule(attribute_id smallint, weight real);
  SELECT coalesce(array_agg(attribute_id), ARRAY[]::smallint[])
    INTO warning_ids
  FROM jsonb_to_recordset(coalesce(p_warning_rules, '[]'::jsonb)) AS rule(attribute_id smallint, weight real);
  SELECT coalesce(array_agg(flag_id), ARRAY[]::smallint[])
    INTO profile_flag_ids
  FROM jsonb_to_recordset(coalesce(p_flag_weights, '[]'::jsonb)) AS rule(flag_id smallint, weight real);

  candidate_attribute_ids := positive_ids || warning_ids || coalesce(p_conflict_attribute_ids, ARRAY[]::smallint[]);
  IF cardinality(candidate_attribute_ids) = 0 AND cardinality(profile_flag_ids) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH positive_rules AS MATERIALIZED (
    SELECT attribute_id, max(weight)::real AS weight
    FROM jsonb_to_recordset(coalesce(p_positive_rules, '[]'::jsonb)) AS rule(attribute_id smallint, weight real)
    GROUP BY attribute_id
  ), warning_rules AS MATERIALIZED (
    SELECT attribute_id, max(weight)::real AS weight
    FROM jsonb_to_recordset(coalesce(p_warning_rules, '[]'::jsonb)) AS rule(attribute_id smallint, weight real)
    GROUP BY attribute_id
  ), flag_rules AS MATERIALIZED (
    SELECT flag_id, max(weight)::real AS weight
    FROM jsonb_to_recordset(coalesce(p_flag_weights, '[]'::jsonb)) AS rule(flag_id smallint, weight real)
    GROUP BY flag_id
  ), relevant AS MATERIALIZED (
    SELECT feature.*
    FROM skindecode_catalog.catalog_product_match_features feature
    WHERE feature.category = p_category
      AND (p_current_product_id IS NULL OR feature.product_id <> p_current_product_id)
      AND (
        feature.resolved_attribute_ids && candidate_attribute_ids
        OR feature.ingredient_attribute_ids && candidate_attribute_ids
        OR feature.flag_ids && profile_flag_ids
      )
  ), scored AS (
    SELECT feature.*,
      (
      COALESCE((
        SELECT sum(rule.weight * 4.2)::real
        FROM unnest(feature.resolved_attribute_ids) AS candidate(attribute_id)
        JOIN positive_rules rule USING (attribute_id)
      ), 0)
      + COALESCE((
        SELECT sum(rule.weight * 1.5)::real
        FROM unnest(feature.ingredient_attribute_ids) AS candidate(attribute_id)
        JOIN positive_rules rule USING (attribute_id)
        WHERE NOT attribute_id = ANY(feature.resolved_attribute_ids)
      ), 0)
      - COALESCE((
        SELECT sum(rule.weight * 7.2 * CASE WHEN attribute_id = ANY(coalesce(p_sensitive_attribute_ids, ARRAY[]::smallint[])) THEN greatest(p_sensitivity_multiplier, 0.1) ELSE 1 END)::real
        FROM unnest(feature.resolved_attribute_ids) AS candidate(attribute_id)
        JOIN warning_rules rule USING (attribute_id)
      ), 0)
      - COALESCE((
        SELECT sum(rule.weight * 3.1 * CASE WHEN attribute_id = ANY(coalesce(p_sensitive_attribute_ids, ARRAY[]::smallint[])) THEN greatest(p_sensitivity_multiplier, 0.1) ELSE 1 END)::real
        FROM unnest(feature.ingredient_attribute_ids) AS candidate(attribute_id)
        JOIN warning_rules rule USING (attribute_id)
        WHERE NOT attribute_id = ANY(feature.resolved_attribute_ids)
      ), 0)
      + COALESCE((
        SELECT sum(rule.weight)::real
        FROM unnest(feature.flag_ids) AS candidate(flag_id)
        JOIN flag_rules rule USING (flag_id)
      ), 0)
      - COALESCE((
        SELECT count(*) * 5.5::real
        FROM unnest(coalesce(p_conflict_attribute_ids, ARRAY[]::smallint[])) AS candidate(attribute_id)
        WHERE attribute_id = ANY(p_conflict_attribute_ids)
          AND (attribute_id = ANY(feature.resolved_attribute_ids) OR attribute_id = ANY(feature.ingredient_attribute_ids))
      ), 0)
      )::real AS shortlist_score
    FROM relevant feature
  ), one_formula_per_product AS (
    SELECT scored.*,
      row_number() OVER (
        PARTITION BY scored.product_id
        ORDER BY scored.shortlist_score DESC,
          CASE scored.data_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
          scored.resolved_analysis_count DESC, scored.ingredient_count DESC, scored.formula_id
      ) AS formula_rank
    FROM scored
  )
  SELECT result.product_id, result.formula_id, result.category, result.subcategory,
    result.data_confidence, result.shortlist_score
  FROM one_formula_per_product result
  WHERE result.formula_rank = 1
  ORDER BY result.shortlist_score DESC,
    CASE result.data_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
    result.product_id
  LIMIT result_limit;
END;
$function$;

REVOKE ALL ON FUNCTION skindecode_catalog.better_match_candidates(integer, text, jsonb, jsonb, smallint[], real, jsonb, smallint[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION skindecode_catalog.better_match_candidates(integer, text, jsonb, jsonb, smallint[], real, jsonb, smallint[], integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
