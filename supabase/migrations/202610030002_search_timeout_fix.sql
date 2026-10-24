-- Fast token-aware search for the compact read-only catalog.
-- Searchable fields use trigram indexes. The function returns one bounded page
-- plus has_more, avoiding an exact COUNT over every matching catalog row.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS catalog_ingredient_aliases_alias_trgm_idx
  ON skindecode_catalog.catalog_ingredient_aliases USING gin (alias extensions.gin_trgm_ops);

DROP FUNCTION IF EXISTS skindecode_catalog.search_products(text, integer, integer);

CREATE FUNCTION skindecode_catalog.search_products(
  search_query text,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  id integer,
  brand_id integer,
  brand_name text,
  name text,
  category text,
  subcategory text,
  image_url text,
  description text,
  matched_ingredients text[],
  product_flags text[],
  has_more boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, skindecode_catalog, extensions
AS $function$
  WITH query_arg AS MATERIALIZED (
    SELECT lower(left(trim(regexp_replace(coalesce(search_query, ''), '[^[:alnum:]]+', ' ', 'g')), 80)) AS term
  ), query_tokens AS MATERIALIZED (
    SELECT token
    FROM (
      SELECT DISTINCT split.token
      FROM query_arg q
      CROSS JOIN LATERAL regexp_split_to_table(q.term, '\s+') AS split(token)
      WHERE char_length(split.token) >= 3
        AND split.token NOT IN ('the', 'and', 'with', 'for', 'from', 'a', 'an', 'of', 'in', 'to', 'by')
    ) tokens
    ORDER BY char_length(token) DESC, token
    LIMIT 8
  ), product_matches AS (
    -- Keep each searchable catalog field as its own branch so PostgreSQL can
    -- use the corresponding trigram index instead of scanning the full table
    -- through a wide OR expression.
    SELECT p.id AS product_id, t.token,
      CASE WHEN lower(p.name) = t.token THEN 3 WHEN p.name ILIKE t.token || '%' THEN 2 ELSE 1 END AS quality,
      NULL::text AS ingredient_name
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON p.name ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND p.name % t.token)
    UNION ALL
    SELECT p.id, t.token, 1, NULL::text
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON p.category ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND p.category % t.token)
    UNION ALL
    SELECT p.id, t.token, 1, NULL::text
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON p.subcategory ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND p.subcategory % t.token)
    UNION ALL
    SELECT p.id, t.token, 1, NULL::text
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p
      ON p.description ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND p.description % t.token)
    UNION ALL
    SELECT p.id, t.token,
      CASE WHEN lower(b.name) = t.token THEN 3 WHEN b.name ILIKE t.token || '%' THEN 2 ELSE 1 END,
      NULL::text
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_brands b
      ON b.name ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND b.name % t.token)
    JOIN skindecode_catalog.catalog_products p ON p.brand_id = b.id
    UNION ALL
    SELECT p.id, t.token, 3, NULL::text
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_products p ON p.id::text = t.token
  ), ingredient_matches AS (
    SELECT DISTINCT t.token, i.id AS ingredient_id,
      coalesce(nullif(i.inci_name, ''), i.name) AS ingredient_name,
      CASE WHEN i.name ILIKE '%' || t.token || '%'
          OR i.inci_name ILIKE '%' || t.token || '%'
          OR i.inn_name ILIKE '%' || t.token || '%'
          OR i.ph_eur_name ILIKE '%' || t.token || '%' THEN 2 ELSE 1 END AS quality
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_ingredients i
      ON i.name ILIKE '%' || t.token || '%'
      OR i.inci_name ILIKE '%' || t.token || '%'
      OR i.inn_name ILIKE '%' || t.token || '%'
      OR i.ph_eur_name ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND (i.name % t.token OR i.inci_name % t.token
        OR i.inn_name % t.token OR i.ph_eur_name % t.token))
    UNION
    SELECT DISTINCT t.token, i.id,
      coalesce(nullif(i.inci_name, ''), i.name), 2
    FROM query_tokens t
    JOIN skindecode_catalog.catalog_ingredient_aliases a
      ON a.alias ILIKE '%' || t.token || '%'
      OR a.normalized_alias ILIKE '%' || t.token || '%'
      OR (char_length(t.token) >= 4 AND (a.alias % t.token OR a.normalized_alias % t.token))
    JOIN skindecode_catalog.catalog_ingredients i ON i.id = a.ingredient_id
  ), ingredient_product_matches AS (
    SELECT DISTINCT im.token, f.product_id::integer AS product_id,
      im.ingredient_name, im.quality
    FROM ingredient_matches im
    JOIN skindecode_catalog.catalog_formulas f
      ON f.ingredient_ids_json::jsonb @> jsonb_build_array(im.ingredient_id)
  ), all_matches AS (
    SELECT product_id, token, quality, ingredient_name FROM product_matches
    UNION ALL
    SELECT product_id, token, quality, ingredient_name FROM ingredient_product_matches
  ), match_rollup AS (
    SELECT product_id,
      count(DISTINCT token)::integer AS matched_token_count,
      count(DISTINCT token) FILTER (WHERE quality >= 2)::integer AS strong_token_count
    FROM all_matches
    GROUP BY product_id
  ), ranked AS (
    SELECT p.id, p.brand_id, b.name AS brand_name, p.name,
      p.category, p.subcategory, p.image_url, p.description,
      mr.matched_token_count, mr.strong_token_count,
      CASE
        WHEN lower(regexp_replace(p.name, '[^[:alnum:]]+', ' ', 'g')) = q.term THEN 0
        WHEN p.name ILIKE q.term || '%' THEN 1
        WHEN lower(b.name) = q.term THEN 2
        WHEN mr.matched_token_count = (SELECT count(*) FROM query_tokens)
          AND mr.strong_token_count = mr.matched_token_count THEN 3
        WHEN mr.matched_token_count = (SELECT count(*) FROM query_tokens) THEN 4
        ELSE 5
      END AS relevance
    FROM match_rollup mr
    JOIN skindecode_catalog.catalog_products p ON p.id = mr.product_id
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
    CROSS JOIN query_arg q
  ), candidate_page AS MATERIALIZED (
    SELECT r.*
    FROM ranked r
    ORDER BY r.relevance, r.matched_token_count DESC,
      r.strong_token_count DESC, r.name, r.id
    LIMIT greatest(1, least(coalesce(page_size, 20), 40)) + 1
    OFFSET greatest(coalesce(page_offset, 0), 0)
  ), page_candidates AS (
    SELECT cp.*,
      row_number() OVER (ORDER BY cp.relevance, cp.matched_token_count DESC,
        cp.strong_token_count DESC, cp.name, cp.id) AS page_row,
      count(*) OVER () > greatest(1, least(coalesce(page_size, 20), 40)) AS has_more
    FROM candidate_page cp
  ), page AS (
    SELECT * FROM page_candidates
    WHERE page_row <= greatest(1, least(coalesce(page_size, 20), 40))
  ), page_ingredients AS (
    SELECT ip.product_id,
      array_agg(DISTINCT ip.ingredient_name ORDER BY ip.ingredient_name) AS matched_ingredients
    FROM ingredient_product_matches ip
    JOIN page pg ON pg.id = ip.product_id
    GROUP BY ip.product_id
  )
  SELECT pg.id, pg.brand_id, pg.brand_name, pg.name, pg.category,
    pg.subcategory, pg.image_url, pg.description,
    coalesce(pi.matched_ingredients, ARRAY[]::text[]),
    coalesce(flags.product_flags, ARRAY[]::text[]), pg.has_more
  FROM page pg
  LEFT JOIN page_ingredients pi ON pi.product_id = pg.id
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
