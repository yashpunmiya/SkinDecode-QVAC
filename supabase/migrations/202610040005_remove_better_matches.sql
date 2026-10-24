-- Better Matches was deployed, but recommendations are paused. Remove only
-- its RPC and compact materialized view. No catalog or user table is changed.
-- Deliberately omit CASCADE so PostgreSQL rejects this migration if another
-- object has started to depend on either recommendation object.
DROP FUNCTION IF EXISTS skindecode_catalog.better_match_candidates(
  integer,
  text,
  jsonb,
  jsonb,
  smallint[],
  real,
  jsonb,
  smallint[],
  integer
);

DROP MATERIALIZED VIEW IF EXISTS skindecode_catalog.catalog_product_match_features;

NOTIFY pgrst, 'reload schema';
