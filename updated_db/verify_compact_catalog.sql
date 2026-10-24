-- One-row post-import verification report for Supabase's SQL query endpoint.
WITH row_counts AS (
    SELECT jsonb_build_object(
        'brands', (SELECT count(*) FROM skindecode_catalog.catalog_brands),
        'products', (SELECT count(*) FROM skindecode_catalog.catalog_products),
        'formulas', (SELECT count(*) FROM skindecode_catalog.catalog_formulas),
        'ingredients', (SELECT count(*) FROM skindecode_catalog.catalog_ingredients),
        'ingredient_aliases', (SELECT count(*) FROM skindecode_catalog.catalog_ingredient_aliases),
        'attributes', (SELECT count(*) FROM skindecode_catalog.catalog_attributes),
        'ingredient_attributes', (SELECT count(*) FROM skindecode_catalog.catalog_ingredient_attributes),
        'flags', (SELECT count(*) FROM skindecode_catalog.catalog_flags),
        'ingredient_references', (SELECT count(*) FROM skindecode_catalog.catalog_ingredient_references),
        'analysis_states', (SELECT count(*) FROM skindecode_catalog.catalog_analysis_states),
        'legacy_product_refs', (SELECT count(*) FROM skindecode_catalog.catalog_legacy_product_refs)
    ) AS value
), relation_counts AS (
    SELECT jsonb_build_object(
        'ordered_ingredient_refs', (
            SELECT sum(jsonb_array_length(ingredient_ids_json::jsonb))
            FROM skindecode_catalog.catalog_formulas
        ),
        'flag_refs', (
            SELECT sum(jsonb_array_length(flag_ids_json::jsonb))
            FROM skindecode_catalog.catalog_formulas
        ),
        'analysis_entries', (
            SELECT sum(jsonb_array_length(analysis_json::jsonb))
            FROM skindecode_catalog.catalog_formulas
        ),
        'analysis_ingredient_refs', (
            SELECT count(*)
            FROM skindecode_catalog.catalog_formulas f
            CROSS JOIN LATERAL jsonb_array_elements(f.analysis_json::jsonb) entry(value)
            CROSS JOIN LATERAL jsonb_array_elements(entry.value -> 3) ingredient(value)
        ),
        'broken_product_brand_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_products p
            LEFT JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
            WHERE b.id IS NULL
        ),
        'broken_formula_product_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_formulas f
            LEFT JOIN skindecode_catalog.catalog_products p ON p.id = f.product_id
            WHERE p.id IS NULL
        ),
        'broken_formula_ingredient_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_formulas f
            CROSS JOIN LATERAL jsonb_array_elements_text(f.ingredient_ids_json::jsonb) ref(id)
            LEFT JOIN skindecode_catalog.catalog_ingredients i ON i.id = ref.id::integer
            WHERE i.id IS NULL
        ),
        'broken_analysis_attribute_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_formulas f
            CROSS JOIN LATERAL jsonb_array_elements(f.analysis_json::jsonb) entry(value)
            LEFT JOIN skindecode_catalog.catalog_attributes a ON a.id = (entry.value ->> 0)::smallint
            WHERE a.id IS NULL
        ),
        'broken_analysis_state_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_formulas f
            CROSS JOIN LATERAL jsonb_array_elements(f.analysis_json::jsonb) entry(value)
            LEFT JOIN skindecode_catalog.catalog_analysis_states s ON s.id = (entry.value ->> 1)::smallint
            WHERE s.id IS NULL
        ),
        'broken_analysis_ingredient_refs', (
            SELECT count(*) FROM skindecode_catalog.catalog_formulas f
            CROSS JOIN LATERAL jsonb_array_elements(f.analysis_json::jsonb) entry(value)
            CROSS JOIN LATERAL jsonb_array_elements(entry.value -> 3) ref(id)
            LEFT JOIN skindecode_catalog.catalog_ingredients i ON i.id = (ref.id #>> '{}')::integer
            WHERE i.id IS NULL
        )
    ) AS value
), security AS (
    SELECT jsonb_build_object(
        'rls_tables_enabled', (
            SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'skindecode_catalog' AND c.relkind = 'r' AND c.relrowsecurity
        ),
        'select_policies', (
            SELECT count(*) FROM pg_policies WHERE schemaname = 'skindecode_catalog' AND cmd = 'SELECT'
        ),
        'anon_can_select_products', has_table_privilege('anon', 'skindecode_catalog.catalog_products', 'SELECT'),
        'anon_can_insert_products', has_table_privilege('anon', 'skindecode_catalog.catalog_products', 'INSERT'),
        'authenticated_can_select_products', has_table_privilege('authenticated', 'skindecode_catalog.catalog_products', 'SELECT'),
        'authenticated_can_update_products', has_table_privilege('authenticated', 'skindecode_catalog.catalog_products', 'UPDATE'),
        'old_products_table_removed', to_regclass('skindecode_catalog.products') IS NULL,
        'old_brands_table_removed', to_regclass('skindecode_catalog.brands') IS NULL,
        'old_ingredients_table_removed', to_regclass('skindecode_catalog.ingredients') IS NULL,
        'old_formula_versions_table_removed', to_regclass('skindecode_catalog.formula_versions') IS NULL,
        'old_product_ingredients_table_removed', to_regclass('skindecode_catalog.product_ingredients') IS NULL,
        'old_ingredient_name_map_table_removed', to_regclass('skindecode_catalog.ingredient_name_map') IS NULL,
        'old_schema_migrations_table_removed', to_regclass('skindecode_catalog.schema_migrations') IS NULL,
        'catalog_foreign_keys_validated', (
            SELECT count(*) FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'skindecode_catalog' AND c.contype = 'f' AND c.convalidated
        ),
        'routine_step_product_fk_target', (
            SELECT confrelid::regclass::text FROM pg_constraint
            WHERE conrelid = 'public.routine_steps'::regclass AND conname = 'routine_steps_product_id_legacy_ref_fkey'
        ),
        'shelf_item_product_fk_target', (
            SELECT confrelid::regclass::text FROM pg_constraint
            WHERE conrelid = 'public.shelf_items'::regclass AND conname = 'shelf_items_product_id_fkey'
        )
    ) AS value
), users AS (
    SELECT jsonb_build_object(
        'user_profiles', (SELECT count(*) FROM public.user_profiles),
        'routines', (SELECT count(*) FROM public.routines),
        'routine_steps', (SELECT count(*) FROM public.routine_steps),
        'routine_logs', (SELECT count(*) FROM public.routine_logs),
        'shelf_items', (SELECT count(*) FROM public.shelf_items),
        'preserved_product_links', (
            SELECT count(*) FROM public.routine_steps rs
            JOIN skindecode_catalog.catalog_legacy_product_refs l ON l.product_id = rs.product_id
        ),
        'legacy_product_snapshot', (
            SELECT jsonb_build_object('id', product_id, 'name', product_snapshot ->> 'name', 'barcode', product_snapshot ->> 'barcode')
            FROM skindecode_catalog.catalog_legacy_product_refs ORDER BY product_id LIMIT 1
        )
    ) AS value
), sample AS (
    SELECT jsonb_build_object(
        'product_id', p.id,
        'product_name', p.name,
        'brand_name', b.name,
        'formula_id', f.id,
        'ordered_ingredient_count', jsonb_array_length(f.ingredient_ids_json::jsonb),
        'flag_count', jsonb_array_length(f.flag_ids_json::jsonb),
        'analysis_entry_count', jsonb_array_length(f.analysis_json::jsonb),
        'ordered_ingredient_names', (
            SELECT jsonb_agg(i.name ORDER BY refs.ordinality)
            FROM jsonb_array_elements_text(f.ingredient_ids_json::jsonb)
                WITH ORDINALITY refs(ingredient_id, ordinality)
            JOIN skindecode_catalog.catalog_ingredients i ON i.id = refs.ingredient_id::integer
        )
    ) AS value
    FROM skindecode_catalog.catalog_formulas f
    JOIN skindecode_catalog.catalog_products p ON p.id = f.product_id
    JOIN skindecode_catalog.catalog_brands b ON b.id = p.brand_id
    WHERE f.id = 2
)
SELECT jsonb_build_object(
    'row_counts', row_counts.value,
    'json_relationships_and_integrity', relation_counts.value,
    'security_and_cleanup', security.value,
    'protected_user_data', users.value,
    'sample_formula', sample.value,
    'database_size_bytes', pg_database_size(current_database()),
    'database_size_pretty', pg_size_pretty(pg_database_size(current_database()))
) AS verification_report
FROM row_counts, relation_counts, security, users, sample;
