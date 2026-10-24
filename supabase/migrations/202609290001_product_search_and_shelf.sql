-- The production catalog already lives in skindecode_catalog. Keep it read-only
-- for app roles and store only user-owned references in the shelf.
grant usage on schema skindecode_catalog to anon, authenticated;
grant select on table
  skindecode_catalog.catalog_products,
  skindecode_catalog.catalog_brands,
  skindecode_catalog.catalog_formulas,
  skindecode_catalog.catalog_ingredients,
  skindecode_catalog.catalog_ingredient_aliases,
  skindecode_catalog.catalog_attributes,
  skindecode_catalog.catalog_analysis_states,
  skindecode_catalog.catalog_flags,
  skindecode_catalog.catalog_ingredient_attributes,
  skindecode_catalog.catalog_ingredient_references,
  skindecode_catalog.catalog_legacy_product_refs
to anon, authenticated;

-- The live Data API currently exposes public and graphql_public only. Preserve
-- both and add the production catalog schema so schema('skindecode_catalog') works.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, skindecode_catalog';
notify pgrst, 'reload config';

create table if not exists public.shelf_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id bigint not null references skindecode_catalog.catalog_products (id) on delete restrict,
  notes varchar(280),
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists shelf_items_user_created_idx
  on public.shelf_items (user_id, created_at desc);

alter table public.shelf_items enable row level security;

drop policy if exists "Users read their own shelf" on public.shelf_items;
create policy "Users read their own shelf"
  on public.shelf_items for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add to their own shelf" on public.shelf_items;
create policy "Users add to their own shelf"
  on public.shelf_items for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own shelf" on public.shelf_items;
create policy "Users update their own shelf"
  on public.shelf_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users remove from their own shelf" on public.shelf_items;
create policy "Users remove from their own shelf"
  on public.shelf_items for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.shelf_items to authenticated;

-- The catalog uses bigint product_id. The Routine V1 placeholder was UUID and
-- has no populated references yet (verified before migration).
alter table public.routine_steps
  alter column product_id type bigint using product_id::text::bigint;

alter table public.routine_steps
  add column if not exists shelf_item_id uuid references public.shelf_items (id) on delete set null;

drop policy if exists "Users manage their own routine steps" on public.routine_steps;
create policy "Users manage their own routine steps"
  on public.routine_steps for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.routines
      where routines.id = routine_id and routines.user_id = (select auth.uid())
    )
    and (
      shelf_item_id is null or exists (
        select 1 from public.shelf_items
        where shelf_items.id = shelf_item_id and shelf_items.user_id = (select auth.uid())
      )
    )
  );

alter table public.routine_steps
  add constraint routine_steps_product_id_fkey
  foreign key (product_id) references skindecode_catalog.catalog_products (id) on delete set null;

create index if not exists routine_steps_product_idx
  on public.routine_steps (product_id) where product_id is not null;
create index if not exists routine_steps_shelf_item_idx
  on public.routine_steps (shelf_item_id) where shelf_item_id is not null;
