-- routine_steps.product_id is retained only for legacy product snapshots.
-- Compact catalog product IDs can collide with the old product namespace, so
-- new routine links use shelf_item_id and resolve to catalog_products through
-- the user's shelf row instead.

alter table public.routine_steps
  drop constraint if exists routine_steps_product_id_fkey;

alter table public.routine_steps
  drop constraint if exists routine_steps_product_id_legacy_ref_fkey;

alter table public.routine_steps
  add constraint routine_steps_product_id_legacy_ref_fkey
  foreign key (product_id)
  references skindecode_catalog.catalog_legacy_product_refs (product_id)
  on delete set null;

create index if not exists routine_steps_product_idx
  on public.routine_steps (product_id) where product_id is not null;
