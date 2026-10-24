-- Unified, accent-insensitive, typo-tolerant product search.
-- The RPC returns one lightweight page; product formulas remain a detail-screen request.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION skindecode_catalog.catalog_search_norm(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, extensions
AS $function$
  SELECT btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, value)),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$function$;

REVOKE ALL ON FUNCTION skindecode_catalog.catalog_search_norm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION skindecode_catalog.catalog_search_norm(text) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS catalog_products_search_name_trgm_idx
  ON skindecode_catalog.catalog_products USING gin
    (skindecode_catalog.catalog_search_norm(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_search_name_prefix_idx
  ON skindecode_catalog.catalog_products
    (skindecode_catalog.catalog_search_norm(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS catalog_products_search_doc_trgm_idx
  ON skindecode_catalog.catalog_products USING gin
    (skindecode_catalog.catalog_search_norm(coalesce(name, '') || ' ' || coalesce(category, '') || ' ' || coalesce(subcategory, '')) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_search_doc_fts_idx
  ON skindecode_catalog.catalog_products USING gin
    (to_tsvector('simple'::regconfig,
      skindecode_catalog.catalog_search_norm(coalesce(name, '') || ' ' || coalesce(category, '') || ' ' || coalesce(subcategory, ''))));

CREATE INDEX IF NOT EXISTS catalog_brands_search_name_trgm_idx
  ON skindecode_catalog.catalog_brands USING gin
    (skindecode_catalog.catalog_search_norm(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_brands_search_name_prefix_idx
  ON skindecode_catalog.catalog_brands
    (skindecode_catalog.catalog_search_norm(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS catalog_brands_search_doc_fts_idx
  ON skindecode_catalog.catalog_brands USING gin
    (to_tsvector('simple'::regconfig, skindecode_catalog.catalog_search_norm(name)));

ANALYZE skindecode_catalog.catalog_products;
ANALYZE skindecode_catalog.catalog_brands;

DROP FUNCTION IF EXISTS skindecode_catalog.search_products(text, integer, integer);

CREATE FUNCTION skindecode_catalog.search_products(
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, skindecode_catalog, extensions
AS $function$
  WITH input AS MATERIALIZED (
    SELECT skindecode_catalog.catalog_search_norm(left(coalesce(search_query, ''), 80)) AS term
  ), query_tokens AS MATERIALIZED (
    SELECT token
    FROM (
      SELECT split.token, min(split.ordinality) AS first_position
      FROM input i
      CROSS JOIN LATERAL regexp_split_to_table(i.term, '\s+') WITH ORDINALITY AS split(token, ordinality)
      WHERE char_length(split.token) >= 2
      GROUP BY split.token
    ) distinct_tokens
    ORDER BY first_position
    LIMIT 8
  ), whole_query_matches AS (
    SELECT p.id AS product_id, 0 AS priority, true AS product_exact
    FROM input q
    JOIN skindecode_catalog.catalog_products p
      ON skindecode_catalog.catalog_search_norm(p.name) = q.term
    WHERE char_length(q.term) >= 2
    UNION ALL
    SELECT p.id, 0, false
    FROM input q
    JOIN skindecode_catalog.catalog_brands b
      ON skindecode_catalog.catalog_search_norm(b.name) = q.term
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    WHERE char_length(q.term) >= 2
    UNION ALL
    SELECT p.id, 1, true
    FROM input q
    JOIN skindecode_catalog.catalog_products p
      ON skindecode_catalog.catalog_search_norm(p.name) LIKE q.term || '%'
    WHERE char_length(q.term) >= 2
    UNION ALL
    SELECT p.id, 1, false
    FROM input q
    JOIN skindecode_catalog.catalog_brands b
      ON skindecode_catalog.catalog_search_norm(b.name) LIKE q.term || '%'
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    WHERE char_length(q.term) >= 2
    UNION ALL
    SELECT p.id, 4, false
    FROM input q
    JOIN skindecode_catalog.catalog_products p
      ON char_length(q.term) >= 4
      AND q.term <% skindecode_catalog.catalog_search_norm(p.name)
    UNION ALL
    SELECT p.id, 4, false
    FROM input q
    JOIN skindecode_catalog.catalog_brands b
      ON char_length(q.term) >= 4
      AND q.term <% skindecode_catalog.catalog_search_norm(b.name)
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
  ), token_matches AS (
    -- Full-text prefix search covers whole words and word starts. The separate
    -- trigram branches catch misspellings and partial words through GIN indexes.
    SELECT p.id AS product_id, t.token, 3 AS quality, 1.0::real AS match_score
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON to_tsvector('simple'::regconfig,
        skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, '')))
        @@ to_tsquery('simple'::regconfig, t.token || ':*')
    UNION ALL
    SELECT p.id, t.token, 2, 1.0::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON skindecode_catalog.catalog_search_norm(p.name) LIKE t.token || '%'
    UNION ALL
    SELECT p.id, t.token, 1,
      word_similarity(t.token, skindecode_catalog.catalog_search_norm(p.name))::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(p.name)
    UNION ALL
    SELECT p.id, t.token, 1,
      word_similarity(t.token,
        skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, '')))::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(coalesce(p.name, '') || ' ' || coalesce(p.category, '') || ' ' || coalesce(p.subcategory, ''))
    UNION ALL
    SELECT p.id, t.token, 3, 1.0::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_brands b
      ON to_tsvector('simple'::regconfig, skindecode_catalog.catalog_search_norm(b.name))
        @@ to_tsquery('simple'::regconfig, t.token || ':*')
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    UNION ALL
    SELECT p.id, t.token, 2, 1.0::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_brands b
      ON skindecode_catalog.catalog_search_norm(b.name) LIKE t.token || '%'
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    UNION ALL
    SELECT p.id, t.token, 1,
      word_similarity(t.token, skindecode_catalog.catalog_search_norm(b.name))::real
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_brands b
      ON char_length(t.token) >= 4
      AND t.token <% skindecode_catalog.catalog_search_norm(b.name)
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
  ), token_best AS (
    SELECT product_id, token, max(quality) AS quality, max(match_score) AS match_score
    FROM token_matches
    GROUP BY product_id, token
  ), token_rollup AS (
    SELECT product_id,
      count(*)::integer AS matched_token_count,
      count(*) FILTER (WHERE quality >= 2)::integer AS strong_token_count,
      sum(match_score)::real AS match_score
    FROM token_best
    GROUP BY product_id
  ), whole_rollup AS (
    SELECT product_id, min(priority) AS whole_priority,
      bool_or(product_exact AND priority = 0) AS exact_product
    FROM whole_query_matches
    GROUP BY product_id
  ), candidate_ids AS (
    SELECT product_id FROM token_rollup
    UNION
    SELECT product_id FROM whole_rollup
  ), ranked AS (
    SELECT p.id, b.name AS brand_name, p.name, p.category, p.subcategory, p.image_url,
      coalesce(tr.matched_token_count, 0) AS matched_token_count,
      coalesce(tr.strong_token_count, 0) AS strong_token_count,
      coalesce(tr.match_score, 0)::real AS match_score,
      wr.whole_priority,
      coalesce(wr.exact_product, false) AS exact_product,
      CASE
        WHEN wr.whole_priority = 0 THEN 0
        WHEN wr.whole_priority = 1 THEN 1
        WHEN tr.matched_token_count = (SELECT count(*) FROM query_tokens)
          AND tr.strong_token_count = tr.matched_token_count THEN 2
        WHEN tr.matched_token_count = (SELECT count(*) FROM query_tokens) THEN 3
        WHEN tr.strong_token_count > 0 THEN 4
        ELSE 5
      END AS rank_group
    FROM candidate_ids c
    JOIN skindecode_catalog.catalog_products p ON p.id = c.product_id
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
    LEFT JOIN token_rollup tr ON tr.product_id = p.id
    LEFT JOIN whole_rollup wr ON wr.product_id = p.id
  ), candidate_page AS MATERIALIZED (
    SELECT r.*
    FROM ranked r
    ORDER BY r.rank_group, r.exact_product DESC, r.strong_token_count DESC,
      r.matched_token_count DESC, r.match_score DESC, r.name, r.id
    LIMIT greatest(1, least(coalesce(page_size, 20), 30)) + 1
    OFFSET greatest(coalesce(page_offset, 0), 0)
  ), numbered_page AS (
    SELECT cp.*,
      row_number() OVER (ORDER BY cp.rank_group, cp.exact_product DESC,
        cp.strong_token_count DESC, cp.matched_token_count DESC,
        cp.match_score DESC, cp.name, cp.id) AS page_row,
      count(*) OVER () > greatest(1, least(coalesce(page_size, 20), 30)) AS has_more
    FROM candidate_page cp
  ), page AS (
    SELECT * FROM numbered_page
    WHERE page_row <= greatest(1, least(coalesce(page_size, 20), 30))
  )
  SELECT pg.id, pg.brand_name, pg.name, pg.category, pg.subcategory, pg.image_url,
    coalesce(flags.product_flags, ARRAY[]::text[]), pg.has_more
  FROM page pg
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT flag.label ORDER BY flag.label) AS product_flags
    FROM skindecode_catalog.catalog_formulas f
    CROSS JOIN LATERAL jsonb_array_elements_text(f.flag_ids_json::jsonb) flag_ref(flag_id)
    JOIN skindecode_catalog.catalog_flags flag ON flag.id = flag_ref.flag_id::smallint
    WHERE f.product_id = pg.id
  ) flags ON true
  ORDER BY pg.page_row;
$function$;

GRANT EXECUTE ON FUNCTION skindecode_catalog.search_products(text, integer, integer) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
