-- Correct the RPC score result cast found during live verification.
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
