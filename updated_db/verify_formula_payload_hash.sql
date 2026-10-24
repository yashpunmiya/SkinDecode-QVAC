SELECT md5(string_agg(
    id::text || E'\t' || ingredient_ids_json || E'\t' || flag_ids_json || E'\t' || analysis_json,
    E'\n' ORDER BY id
 ) || E'\n') AS formula_payload_md5
FROM skindecode_catalog.catalog_formulas;
