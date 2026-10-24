--
-- PostgreSQL database dump
--

\restrict yOZGAbl5QoCqr9VdjeacMiW0dQD3GzvOFo9TNqZjxnHScLMJZNFfgNcO9PD7MRi

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: skindecode_catalog; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA skindecode_catalog;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: brands; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.brands (
    brand_id bigint NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL
);


--
-- Name: formula_versions; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.formula_versions (
    formula_id bigint NOT NULL,
    product_id bigint NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    region text,
    formula_hash text,
    source text,
    status text
);


--
-- Name: ingredient_name_map; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.ingredient_name_map (
    normalized_raw text NOT NULL,
    example_raw text,
    ingredient_id bigint,
    canonical_inci text,
    method text,
    confidence double precision,
    occurrence_count bigint DEFAULT 0 NOT NULL
);


--
-- Name: ingredients; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.ingredients (
    ingredient_id bigint NOT NULL,
    inci_name text NOT NULL,
    normalized_inci text NOT NULL,
    cosing_ref_no text,
    cas_no text,
    ec_no text,
    description text,
    functions text,
    restriction_ref text,
    update_date text,
    source text
);


--
-- Name: product_ingredients; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.product_ingredients (
    formula_id bigint NOT NULL,
    position_index integer NOT NULL,
    ingredient_id bigint,
    raw_token text,
    normalized_raw text,
    match_method text,
    match_confidence double precision,
    declared_percent double precision,
    formula_section text,
    status text
);


--
-- Name: products; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.products (
    product_id bigint NOT NULL,
    barcode text NOT NULL,
    brand_id bigint,
    brand_raw text,
    name text,
    generic_name text,
    category text,
    categories_raw text,
    category_tags text,
    quantity text,
    countries text,
    image_url text,
    raw_ingredient_text text,
    source text,
    source_url text,
    last_modified_t bigint,
    completeness double precision,
    product_status text,
    formula_status text,
    formula_match_rate double precision,
    parsed_ingredient_count integer,
    matched_ingredient_count integer,
    formula_flags text,
    countries_tags text,
    labels_raw text,
    labels_tags text,
    packaging_raw text,
    packaging_tags text,
    stores_raw text,
    purchase_places_raw text,
    image_ingredients_url text,
    image_small_url text,
    ingredients_text_source text,
    created_t bigint,
    has_name boolean DEFAULT false NOT NULL,
    has_brand boolean DEFAULT false NOT NULL,
    has_front_image boolean DEFAULT false NOT NULL,
    has_ingredients_image boolean DEFAULT false NOT NULL,
    has_formula boolean DEFAULT false NOT NULL,
    has_ingredient_tags boolean DEFAULT false NOT NULL,
    has_category boolean DEFAULT false NOT NULL,
    has_quantity boolean DEFAULT false NOT NULL,
    app_scope text
);


--
-- Name: schema_migrations; Type: TABLE; Schema: skindecode_catalog; Owner: -
--

CREATE TABLE skindecode_catalog.schema_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    checksum text NOT NULL
);


--
-- Name: brands brands_normalized_name_key; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.brands
    ADD CONSTRAINT brands_normalized_name_key UNIQUE (normalized_name);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (brand_id);


--
-- Name: formula_versions formula_versions_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.formula_versions
    ADD CONSTRAINT formula_versions_pkey PRIMARY KEY (formula_id);


--
-- Name: formula_versions formula_versions_product_id_version_no_key; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.formula_versions
    ADD CONSTRAINT formula_versions_product_id_version_no_key UNIQUE (product_id, version_no);


--
-- Name: ingredient_name_map ingredient_name_map_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.ingredient_name_map
    ADD CONSTRAINT ingredient_name_map_pkey PRIMARY KEY (normalized_raw);


--
-- Name: ingredients ingredients_inci_name_key; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.ingredients
    ADD CONSTRAINT ingredients_inci_name_key UNIQUE (inci_name);


--
-- Name: ingredients ingredients_normalized_inci_key; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.ingredients
    ADD CONSTRAINT ingredients_normalized_inci_key UNIQUE (normalized_inci);


--
-- Name: ingredients ingredients_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (ingredient_id);


--
-- Name: product_ingredients product_ingredients_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.product_ingredients
    ADD CONSTRAINT product_ingredients_pkey PRIMARY KEY (formula_id, position_index);


--
-- Name: products products_barcode_key; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.products
    ADD CONSTRAINT products_barcode_key UNIQUE (barcode);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (product_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: formula_versions_product_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX formula_versions_product_idx ON skindecode_catalog.formula_versions USING btree (product_id);


--
-- Name: ingredient_name_map_ingredient_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX ingredient_name_map_ingredient_idx ON skindecode_catalog.ingredient_name_map USING btree (ingredient_id);


--
-- Name: product_ingredients_ingredient_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX product_ingredients_ingredient_idx ON skindecode_catalog.product_ingredients USING btree (ingredient_id);


--
-- Name: products_brand_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX products_brand_idx ON skindecode_catalog.products USING btree (brand_id);


--
-- Name: products_category_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX products_category_idx ON skindecode_catalog.products USING btree (category);


--
-- Name: products_generic_name_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX products_generic_name_idx ON skindecode_catalog.products USING btree (generic_name);


--
-- Name: products_name_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX products_name_idx ON skindecode_catalog.products USING btree (name);


--
-- Name: products_scope_idx; Type: INDEX; Schema: skindecode_catalog; Owner: -
--

CREATE INDEX products_scope_idx ON skindecode_catalog.products USING btree (app_scope);


--
-- Name: formula_versions formula_versions_product_id_fkey; Type: FK CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.formula_versions
    ADD CONSTRAINT formula_versions_product_id_fkey FOREIGN KEY (product_id) REFERENCES skindecode_catalog.products(product_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ingredient_name_map ingredient_name_map_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.ingredient_name_map
    ADD CONSTRAINT ingredient_name_map_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES skindecode_catalog.ingredients(ingredient_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: product_ingredients product_ingredients_formula_id_fkey; Type: FK CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.product_ingredients
    ADD CONSTRAINT product_ingredients_formula_id_fkey FOREIGN KEY (formula_id) REFERENCES skindecode_catalog.formula_versions(formula_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: product_ingredients product_ingredients_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.product_ingredients
    ADD CONSTRAINT product_ingredients_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES skindecode_catalog.ingredients(ingredient_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: skindecode_catalog; Owner: -
--

ALTER TABLE ONLY skindecode_catalog.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES skindecode_catalog.brands(brand_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict yOZGAbl5QoCqr9VdjeacMiW0dQD3GzvOFo9TNqZjxnHScLMJZNFfgNcO9PD7MRi

