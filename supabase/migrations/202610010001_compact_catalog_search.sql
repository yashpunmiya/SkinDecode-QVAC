-- App-facing search support for the imported read-only compact catalog.
-- Catalog contents remain read-only; this migration adds only indexes and a
-- SECURITY INVOKER search function that respects the catalog RLS policies.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS catalog_products_name_trgm_idx
  ON skindecode_catalog.catalog_products USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_category_trgm_idx
  ON skindecode_catalog.catalog_products USING gin (category extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_subcategory_trgm_idx
  ON skindecode_catalog.catalog_products USING gin (subcategory extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_description_trgm_idx
  ON skindecode_catalog.catalog_products USING gin (description extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_brands_name_trgm_idx
  ON skindecode_catalog.catalog_brands USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredients_name_trgm_idx
  ON skindecode_catalog.catalog_ingredients USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredients_inci_trgm_idx
  ON skindecode_catalog.catalog_ingredients USING gin (inci_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredients_inn_trgm_idx
  ON skindecode_catalog.catalog_ingredients USING gin (inn_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredients_ph_eur_trgm_idx
  ON skindecode_catalog.catalog_ingredients USING gin (ph_eur_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingredient_aliases_normalized_trgm_idx
  ON skindecode_catalog.catalog_ingredient_aliases USING gin (normalized_alias extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_formulas_ingredient_ids_gin_idx
  ON skindecode_catalog.catalog_formulas USING gin ((ingredient_ids_json::jsonb));

CREATE OR REPLACE FUNCTION skindecode_catalog.search_products(
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
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, skindecode_catalog, extensions
AS $function$
  WITH query_arg AS (
    SELECT left(trim(regexp_replace(coalesce(search_query, ''), '\s+', ' ', 'g')), 80) AS term
  ), ingredient_matches AS (
    SELECT DISTINCT i.id AS ingredient_id, coalesce(nullif(i.inci_name, ''), i.name) AS ingredient_name
    FROM skindecode_catalog.catalog_ingredients i
    CROSS JOIN query_arg q
    WHERE length(q.term) >= 2
      AND (i.name ILIKE '%' || q.term || '%'
        OR i.inci_name ILIKE '%' || q.term || '%'
        OR i.inn_name ILIKE '%' || q.term || '%'
        OR i.ph_eur_name ILIKE '%' || q.term || '%')
    UNION
    SELECT DISTINCT i.id AS ingredient_id, coalesce(nullif(i.inci_name, ''), i.name) AS ingredient_name
    FROM skindecode_catalog.catalog_ingredient_aliases a
    JOIN skindecode_catalog.catalog_ingredients i ON i.id = a.ingredient_id
    CROSS JOIN query_arg q
    WHERE length(q.term) >= 2
      AND (a.alias ILIKE '%' || q.term || '%' OR a.normalized_alias ILIKE '%' || q.term || '%')
  ), ingredient_products AS (
    SELECT f.product_id, array_agg(DISTINCT im.ingredient_name ORDER BY im.ingredient_name) AS matched_ingredients
    FROM skindecode_catalog.catalog_formulas f
    JOIN ingredient_matches im
      ON f.ingredient_ids_json::jsonb @> jsonb_build_array(im.ingredient_id)
    GROUP BY f.product_id
  ), ranked AS (
    SELECT p.id, p.brand_id, b.name AS brand_name, p.name,
      p.category, p.subcategory, p.image_url, p.description,
      ip.matched_ingredients,
      CASE
        WHEN p.id::text = q.term THEN 0
        WHEN lower(p.name) = lower(q.term) THEN 1
        WHEN p.name ILIKE q.term || '%' THEN 2
        WHEN lower(b.name) = lower(q.term) THEN 3
        WHEN b.name ILIKE q.term || '%' THEN 4
        WHEN coalesce(p.category, '') ILIKE q.term || '%' OR coalesce(p.subcategory, '') ILIKE q.term || '%' THEN 5
        WHEN ip.product_id IS NOT NULL THEN 6
        ELSE 7
      END AS relevance,
      count(*) OVER () AS total_count
    FROM skindecode_catalog.catalog_products p
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
    LEFT JOIN ingredient_products ip ON ip.product_id = p.id
    CROSS JOIN query_arg q
    WHERE length(q.term) >= 2
      AND (p.id::text = q.term
        OR p.name ILIKE '%' || q.term || '%'
        OR coalesce(p.category, '') ILIKE '%' || q.term || '%'
        OR coalesce(p.subcategory, '') ILIKE '%' || q.term || '%'
        OR coalesce(p.description, '') ILIKE '%' || q.term || '%'
        OR b.name ILIKE '%' || q.term || '%'
        OR ip.product_id IS NOT NULL)
  ), paged AS (
    SELECT * FROM ranked
    ORDER BY relevance, name, id
    LIMIT greatest(1, least(coalesce(page_size, 20), 40))
    OFFSET greatest(coalesce(page_offset, 0), 0)
  )
  SELECT page.id, page.brand_id, page.brand_name, page.name,
    page.category, page.subcategory, page.image_url, page.description,
    coalesce(page.matched_ingredients, ARRAY[]::text[]),
    coalesce(flags.product_flags, ARRAY[]::text[]), page.total_count
  FROM paged page
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT flag.label ORDER BY flag.label) AS product_flags
    FROM skindecode_catalog.catalog_formulas f
    CROSS JOIN LATERAL jsonb_array_elements_text(f.flag_ids_json::jsonb) flag_ref(flag_id)
    JOIN skindecode_catalog.catalog_flags flag ON flag.id = flag_ref.flag_id::smallint
    WHERE f.product_id = page.id
  ) flags ON true
  ORDER BY page.relevance, page.name, page.id;
$function$;

GRANT EXECUTE ON FUNCTION skindecode_catalog.search_products(text, integer, integer) TO anon, authenticated;
