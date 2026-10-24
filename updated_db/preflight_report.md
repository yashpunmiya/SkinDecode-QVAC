# Compact catalog replacement report

## Status

The approved `updated_db/csv` source was imported successfully into the linked Supabase database in a single transaction. The SQLite file was not used; the user explicitly approved the validated CSV source. No mobile-app files were changed.

## Source validation

| Table | CSV rows | Expected |
| --- | ---: | ---: |
| brands | 10,932 | 10,932 |
| products | 52,525 | 52,525 |
| formulas | 54,979 | 54,979 |
| ingredients | 34,288 | 34,288 |
| ingredient aliases | 492 | 492 |
| attributes | 66 | 66 |
| ingredient attributes | 21,405 | 21,405 |
| flags | 12 | 12 |
| ingredient references | 7,815 | 7,815 |
| analysis states | 5 | 5 |

CSV validation found no duplicate primary IDs, missing relational references, malformed formula JSON, missing formula ingredient/flag IDs, invalid analysis attribute/state IDs, or invalid ingredient IDs in analysis payloads.

## Preflight and protected data

- Existing catalog schema: `skindecode_catalog`; old tables were `brands`, `products`, `ingredients`, `formula_versions`, `product_ingredients`, `ingredient_name_map`, and `schema_migrations`.
- No views, triggers, or routines/RPCs referenced the old catalog tables. Only two user-table foreign keys referenced old products: `public.routine_steps.product_id` and `public.shelf_items.product_id`.
- Before import, `public.shelf_items` had zero rows. `public.routine_steps` had six rows and one distinct product reference, ID `25086`.
- Old ID `25086` meant CeraVe AM Facial Moisturizing Lotion SPF 30 (barcode `3606000537460`); compact ID `25086` is a shampoo. To avoid changing meaning, the old product snapshot is stored in `skindecode_catalog.catalog_legacy_product_refs`, and the routine FK now targets that snapshot. Routine step data itself was not changed. The empty shelf FK now targets the compact products table.
- The transaction locked and compared row counts and hashes for `user_profiles`, `routines`, `routine_steps`, `routine_logs`, and `shelf_items`; all before/after values matched. A mismatch would have rolled back the import.
- Supabase Auth tables were not referenced or modified by the import SQL.

## Changes made

### Removed

Removed the seven obsolete tables: `brands`, `products`, `ingredients`, `formula_versions`, `product_ingredients`, `ingredient_name_map`, and `schema_migrations`. Their table-owned indexes and constraints were removed with them. The preflight found no dependent catalog views, triggers, routines/RPCs, or other user-table dependencies.

### Created and imported

- Created 10 compact catalog tables: brands, products, ingredients, formulas, ingredient aliases, attributes, ingredient attributes, flags, analysis states, and ingredient references.
- Created `catalog_legacy_product_refs` with one snapshot for the existing routine product link.
- Imported all 10 CSV files with PostgreSQL `\copy` in the same transaction.
- Added six validated catalog foreign keys and nine lookup indexes, plus the primary/unique indexes declared in the schema.
- Enabled RLS on all 11 tables and created one SELECT policy per table for `anon` and `authenticated`. Those roles can read catalog rows, but cannot insert or update them. Future tables in the schema default to SELECT grants.
- Retargeted the two user-linked product FKs as described above and reloaded the PostgREST schema cache.

## Post-import verification

All checks passed.

| Catalog table | Imported rows | Expected |
| --- | ---: | ---: |
| brands | 10,932 | 10,932 |
| products | 52,525 | 52,525 |
| formulas | 54,979 | 54,979 |
| ingredients | 34,288 | 34,288 |
| ingredient aliases | 492 | 492 |
| attributes | 66 | 66 |
| ingredient attributes | 21,405 | 21,405 |
| flags | 12 | 12 |
| ingredient references | 7,815 | 7,815 |
| analysis states | 5 | 5 |

- Source-vs-database MD5 of all formula IDs and exact `ingredient_ids_json`, `flag_ids_json`, and `analysis_json` text matched: `ce69c6cd1c7e27bd2fa282c8a1b18681`.
- JSON relationship totals: 1,361,222 ordered ingredient references; 407,423 flag references; 746,397 analysis entries; 2,043,743 ingredient-analysis references.
- Broken references: **0** for product-brand, formula-product, formula ingredient, analysis attribute, analysis state, and analysis ingredient relationships. All six catalog foreign keys are validated.
- Access checks: 11 RLS-enabled tables and 11 SELECT policies; `anon` and `authenticated` can SELECT products; `anon` cannot INSERT and `authenticated` cannot UPDATE.
- Sample formula `2` resolves to `000Skin / Hydraplush Mini`: 11 ordered ingredients, 10 flags, and 10 analysis entries. Ordered ingredient names resolve against the imported ingredients table.
- All seven old catalog tables are absent.
- Protected public user row counts after import: 1 profile, 1 routine, 6 routine steps, 12 routine logs, and 0 shelf items. Their transaction-level before/after hashes matched.

## Backups and database size

- Old catalog schema backup: `updated_db/backups/old_catalog_schema.sql`.
- Old catalog data backup (PostgreSQL COPY format): `updated_db/backups/old_catalog_data.sql`.
- Database size before import: **144,854,163 bytes (138 MB)**.
- Database size after import: **94,235,795 bytes (90 MB)**, a reduction of **50,618,368 bytes**.

## Reproducible verification files

- `updated_db/postgres_schema.sql` defines the compact schema.
- `updated_db/install_compact_catalog.psql` is the transactional importer and safety checks.
- `updated_db/run_import.ps1` obtains a temporary linked connection and invokes psql without printing the credential.
- `updated_db/verify_compact_catalog.sql` reports counts, JSON relationships, referential integrity, RLS/access, old-object cleanup, protected user data, sample formula, and database size.
- `updated_db/verify_formula_payload_hash.sql` computes the imported formula payload hash for comparison with the CSV source.
- No mobile-app files were changed.
