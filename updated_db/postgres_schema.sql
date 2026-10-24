-- SkinDecode compact catalog for Supabase/PostgreSQL.
-- JSON payloads stay as TEXT so the ordered ingredient, flag, and analysis
-- relationships are imported byte-for-byte from the compact source.

CREATE SCHEMA IF NOT EXISTS skindecode_catalog;

CREATE TABLE skindecode_catalog.catalog_brands (
    id integer PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE skindecode_catalog.catalog_products (
    id integer PRIMARY KEY,
    brand_id integer NOT NULL,
    name text NOT NULL,
    category text,
    subcategory text,
    image_url text,
    description text
);

CREATE TABLE skindecode_catalog.catalog_ingredients (
    id integer PRIMARY KEY,
    name text NOT NULL,
    inci_name text,
    inn_name text,
    ph_eur_name text,
    description text,
    functions_json text,
    prevalence_label text,
    prevalence_percent real,
    common_categories_json text,
    typical_list_position text
);

CREATE TABLE skindecode_catalog.catalog_ingredient_aliases (
    ingredient_id integer NOT NULL,
    alias text NOT NULL,
    normalized_alias text
);

CREATE TABLE skindecode_catalog.catalog_attributes (
    id smallint PRIMARY KEY,
    key text NOT NULL UNIQUE,
    label text,
    description text
);

CREATE TABLE skindecode_catalog.catalog_ingredient_attributes (
    ingredient_id integer NOT NULL,
    attribute_id smallint NOT NULL,
    PRIMARY KEY (ingredient_id, attribute_id)
);

CREATE TABLE skindecode_catalog.catalog_flags (
    id smallint PRIMARY KEY,
    key text NOT NULL UNIQUE,
    label text
);

CREATE TABLE skindecode_catalog.catalog_analysis_states (
    id smallint PRIMARY KEY,
    key text NOT NULL UNIQUE
);

CREATE TABLE skindecode_catalog.catalog_formulas (
    id integer PRIMARY KEY,
    product_id integer NOT NULL,
    region text,
    formulation text,
    variant text,
    image_url text,
    ingredient_ids_json text NOT NULL DEFAULT '[]',
    flag_ids_json text NOT NULL DEFAULT '[]',
    analysis_json text NOT NULL DEFAULT '[]'
);

CREATE TABLE skindecode_catalog.catalog_ingredient_references (
    id integer PRIMARY KEY,
    ingredient_id integer NOT NULL,
    url text NOT NULL,
    domain text,
    label text
);


