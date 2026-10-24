-- Short-circuit exact/prefix matches and run trigram fallback only for tokens
-- that do not have an indexed full-text word/prefix match.
CREATE OR REPLACE FUNCTION skindecode_catalog.search_products(
  search_query text,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  id integer,
  brand_name text,
  name text,
  category text,
  subcategory text,
  image_url text,
  product_flags text[],
  has_more boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, skindecode_catalog, extensions
AS $function$
DECLARE
  normalized_query text := skindecode_catalog.catalog_search_norm(left(coalesce(search_query, ''), 80));
  query_tokens text[];
  token_count integer;
  result_limit integer := greatest(1, least(coalesce(page_size, 20), 30));
  result_offset integer := greatest(coalesce(page_offset, 0), 0);
BEGIN
  IF char_length(normalized_query) < 2 THEN
    RETURN;
  END IF;

  SELECT array_agg(token ORDER BY first_position)
  INTO query_tokens
  FROM (
    SELECT split.token, min(split.ordinality) AS first_position
    FROM regexp_split_to_table(normalized_query, '\s+') WITH ORDINALITY AS split(token, ordinality)
    WHERE char_length(split.token) >= 2
    GROUP BY split.token
    ORDER BY first_position
    LIMIT 8
  ) AS distinct_tokens;

  token_count := coalesce(cardinality(query_tokens), 0);
  IF token_count = 0 THEN
    RETURN;
  END IF;

  -- Exact and starts-with product/brand matches avoid the typo and token paths.
  RETURN QUERY
  WITH fast_source AS MATERIALIZED (
    SELECT p.id AS product_id, 0 AS priority, true AS exact_product
    FROM skindecode_catalog.catalog_products p
    WHERE skindecode_catalog.catalog_search_norm(p.name) = normalized_query
    UNION ALL
    SELECT p.id, 0, false
    FROM skindecode_catalog.catalog_brands b
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    WHERE skindecode_catalog.catalog_search_norm(b.name) = normalized_query
    UNION ALL
    SELECT p.id, 1, true
    FROM skindecode_catalog.catalog_products p
    WHERE skindecode_catalog.catalog_search_norm(p.name) LIKE normalized_query || '%'
    UNION ALL
    SELECT p.id, 1, false
    FROM skindecode_catalog.catalog_brands b
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    WHERE skindecode_catalog.catalog_search_norm(b.name) LIKE normalized_query || '%'
  ), fast_ranked AS (
    SELECT p.id, b.name AS brand_name, p.name, p.category, p.subcategory, p.image_url,
      min(fs.priority) AS priority,
      bool_or(fs.exact_product AND fs.priority = 0) AS exact_product
    FROM fast_source fs
    JOIN skindecode_catalog.catalog_products p ON p.id = fs.product_id
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
    GROUP BY p.id, b.name, p.name, p.category, p.subcategory, p.image_url
  ), fast_page AS MATERIALIZED (
    SELECT * FROM fast_ranked
    ORDER BY priority, exact_product DESC, name, id
    LIMIT result_limit + 1 OFFSET result_offset
  ), fast_numbered AS (
    SELECT fp.*,
      row_number() OVER (ORDER BY fp.priority, fp.exact_product DESC, fp.name, fp.id) AS page_row,
      count(*) OVER () > result_limit AS has_more
    FROM fast_page fp
  ), fast_final_page AS (
    SELECT * FROM fast_numbered WHERE page_row <= result_limit
  )
  SELECT fp.id, fp.brand_name, fp.name, fp.category, fp.subcategory, fp.image_url,
    coalesce(flags.product_flags, ARRAY[]::text[]), fp.has_more
  FROM fast_final_page fp
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT flag.label ORDER BY flag.label) AS product_flags
    FROM skindecode_catalog.catalog_formulas f
    CROSS JOIN LATERAL jsonb_array_elements_text(f.flag_ids_json::jsonb) flag_ref(flag_id)
    JOIN skindecode_catalog.catalog_flags flag ON flag.id = flag_ref.flag_id::smallint
    WHERE f.product_id = fp.id
  ) flags ON true
  ORDER BY fp.page_row;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Full-text prefix matches are gathered first. Trigrams are evaluated only
  -- for misspelled tokens absent from both product and brand word indexes.
  RETURN QUERY
  WITH query_token_set AS MATERIALIZED (
    SELECT unnest(query_tokens) AS token
  ), strong_product AS MATERIALIZED (
    SELECT DISTINCT p.id AS product_id, t.token, 3 AS quality, 1.0::real AS match_score
    FROM query_token_set t
    JOIN skindecode_catalog.catalog_products p
      ON to_tsvector('simple'::regconfig,
        skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, '')))
        @@ to_tsquery('simple'::regconfig, t.token || ':*')
  ), strong_brand AS MATERIALIZED (
    SELECT DISTINCT p.id AS product_id, t.token, 3 AS quality, 1.0::real AS match_score
    FROM query_token_set t
    JOIN skindecode_catalog.catalog_brands b
      ON to_tsvector('simple'::regconfig, skindecode_catalog.catalog_search_norm(b.name))
        @@ to_tsquery('simple'::regconfig, t.token || ':*')
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
  ), known_tokens AS MATERIALIZED (
    SELECT token FROM strong_product
    UNION
    SELECT token FROM strong_brand
  ), fuzzy_product AS MATERIALIZED (
    SELECT p.id AS product_id, t.token, 1 AS quality,
      word_similarity(t.token, skindecode_catalog.catalog_search_norm(p.name))::real AS match_score
    FROM query_token_set t
    JOIN skindecode_catalog.catalog_products p
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(p.name)
    WHERE NOT EXISTS (SELECT 1 FROM known_tokens k WHERE k.token = t.token)
    UNION ALL
    SELECT p.id, t.token, 1,
      word_similarity(t.token,
        skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, '')))::real
    FROM query_token_set t
    JOIN skindecode_catalog.catalog_products p
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, ''))
    WHERE NOT EXISTS (SELECT 1 FROM known_tokens k WHERE k.token = t.token)
    UNION ALL
    SELECT p.id, t.token, 1,
      word_similarity(t.token, skindecode_catalog.catalog_search_norm(b.name))::real
    FROM query_token_set t
    JOIN skindecode_catalog.catalog_brands b
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(b.name)
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    WHERE NOT EXISTS (SELECT 1 FROM known_tokens k WHERE k.token = t.token)
  ), token_best AS (
    SELECT product_id, token, max(quality) AS quality, max(match_score) AS match_score
    FROM (
      SELECT * FROM strong_product
      UNION ALL SELECT * FROM strong_brand
      UNION ALL SELECT * FROM fuzzy_product
    ) matches
    GROUP BY product_id, token
  ), token_rollup AS MATERIALIZED (
    SELECT product_id,
      count(*)::integer AS matched_token_count,
      count(*) FILTER (WHERE quality >= 2)::integer AS strong_token_count,
      sum(match_score)::real AS match_score
    FROM token_best
    GROUP BY product_id
  ), ranked AS (
    SELECT p.id, b.name AS brand_name, p.name, p.category, p.subcategory, p.image_url,
      tr.matched_token_count, tr.strong_token_count, tr.match_score,
      CASE
        WHEN tr.matched_token_count = token_count
          AND tr.strong_token_count = tr.matched_token_count THEN 2
        WHEN tr.matched_token_count = token_count THEN 3
        WHEN tr.strong_token_count > 0 THEN 4
        ELSE 5
      END AS rank_group
    FROM token_rollup tr
    JOIN skindecode_catalog.catalog_products p ON p.id = tr.product_id
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
  ), candidate_page AS MATERIALIZED (
    SELECT * FROM ranked
    ORDER BY rank_group, strong_token_count DESC, matched_token_count DESC,
      match_score DESC, name, id
    LIMIT result_limit + 1 OFFSET result_offset
  ), numbered_page AS (
    SELECT cp.*,
      row_number() OVER (ORDER BY cp.rank_group, cp.strong_token_count DESC,
        cp.matched_token_count DESC, cp.match_score DESC, cp.name, cp.id) AS page_row,
      count(*) OVER () > result_limit AS has_more
    FROM candidate_page cp
  ), final_page AS (
    SELECT * FROM numbered_page WHERE page_row <= result_limit
  )
  SELECT fp.id, fp.brand_name, fp.name, fp.category, fp.subcategory, fp.image_url,
    coalesce(flags.product_flags, ARRAY[]::text[]), fp.has_more
  FROM final_page fp
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT flag.label ORDER BY flag.label) AS product_flags
    FROM skindecode_catalog.catalog_formulas f
    CROSS JOIN LATERAL jsonb_array_elements_text(f.flag_ids_json::jsonb) flag_ref(flag_id)
    JOIN skindecode_catalog.catalog_flags flag ON flag.id = flag_ref.flag_id::smallint
    WHERE f.product_id = fp.id
  ) flags ON true
  ORDER BY fp.page_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION skindecode_catalog.search_products(text, integer, integer) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
