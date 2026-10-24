"""Create a deterministic, compact calibration sample from validated catalog CSVs.

Usage: python tests/calibration/build-catalog-fixture.py updated_db/csv
The generated fixture contains representative production rows only, not catalog data in bulk.
"""
import collections
import csv
import json
import pathlib
import random
import sys

SOURCE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "updated_db/csv")
OUTPUT = pathlib.Path("tests/fixtures/product-intelligence-catalog.json")
SEED = 20261004
TARGET = 80
CATEGORIES = {
    "Face Cleansers": 10,
    "General Moisturizers": 12,
    "Serums": 12,
    "Sunscreens": 10,
    "Foundations": 8,
    "Concealers": 6,
    "Eye Moisturizers": 6,
    "Facial Treatments": 8,
    "Oils": 7,
}


def rows(name):
    with (SOURCE / name).open("r", encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def json_value(value, fallback):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def main():
    products = list(rows("catalog_products.csv"))
    formulas_by_product = collections.defaultdict(list)
    for row in rows("catalog_formulas.csv"):
        formulas_by_product[int(row["product_id"])].append(row)
    ingredient_rows = {int(row["id"]): row for row in rows("catalog_ingredients.csv")}
    attribute_rows = {int(row["id"]): row for row in rows("catalog_attributes.csv")}
    flag_rows = {int(row["id"]): row for row in rows("catalog_flags.csv")}
    state_rows = {int(row["id"]): row["key"] for row in rows("catalog_analysis_states.csv")}
    ingredient_attrs = collections.defaultdict(list)
    for row in rows("catalog_ingredient_attributes.csv"):
        ingredient_attrs[int(row["ingredient_id"])].append(int(row["attribute_id"]))
    brand_names = {int(row["id"]): row["name"] for row in rows("catalog_brands.csv")}

    products_by_category = collections.defaultdict(list)
    for product in products:
        category = product["category"] or ""
        if category in CATEGORIES:
            products_by_category[category].append(product)

    rng = random.Random(SEED)
    selected = []
    reasons = collections.Counter()
    used = set()
    by_id = {int(product["id"]): product for product in products}

    # Anchor named real products used for product-intelligence validation.
    for product_id, label in [(442, "A.N.D. sunscreen"), (6, "unresolved analysis"), (19, "no INCI")]:
        if product_id in by_id and product_id not in used:
            selected.append(by_id[product_id])
            used.add(product_id)
            reasons[label] += 1

    # Deliberately include several skincare products without a parsed INCI list.
    for category in CATEGORIES:
        if sum(1 for item in selected if item["category"] == category) >= CATEGORIES[category]:
            continue
        no_inci = [
            product for product in products_by_category[category]
            if int(product["id"]) not in used
            and formulas_by_product[int(product["id"])]
            and all(not json_value(formula["ingredient_ids_json"], []) for formula in formulas_by_product[int(product["id"])])
        ]
        if no_inci and reasons["extra no-INCI"] < 4:
            product = rng.choice(no_inci)
            selected.append(product)
            used.add(int(product["id"]))
            reasons["extra no-INCI"] += 1
            reasons[category] += 1

    def formula_quality(product):
        formulas = formulas_by_product[int(product["id"])]
        resolved = 0
        inci = 0
        for formula in formulas:
            ingredients = json_value(formula["ingredient_ids_json"], [])
            inci += len(ingredients)
            resolved += sum(
                1 for item in json_value(formula["analysis_json"], [])
                if isinstance(item, list) and len(item) >= 4 and state_rows.get(int(item[1])) == "resolved_endpoint" and item[3]
            )
        return resolved, inci, len(formulas)

    # Stable seeded samples from each main category, including both rich and sparse evidence.
    for category, quota in CATEGORIES.items():
        already_selected = sum(1 for item in selected if item["category"] == category)
        needed = quota - already_selected
        if needed <= 0:
            continue
        options = [p for p in products_by_category[category] if int(p["id"]) not in used and formulas_by_product[int(p["id"])]]
        rich = [p for p in options if formula_quality(p)[0] > 0 and formula_quality(p)[1] > 0]
        sparse = [p for p in options if formula_quality(p)[0] == 0 or formula_quality(p)[1] == 0]
        multi = [p for p in options if formula_quality(p)[2] > 1]
        chosen = []
        if rich:
            chosen.extend(rng.sample(rich, min(max(0, needed - 2), len(rich))))
        special_pools = [sparse, multi]
        for pool in special_pools:
            available = [p for p in pool if p not in chosen]
            if available and len(chosen) < needed:
                item = rng.choice(available)
                chosen.append(item)
                reasons["sparse or multi-formula"] += 1
        remaining = [p for p in options if p not in chosen]
        if len(chosen) < needed and remaining:
            chosen.extend(rng.sample(remaining, min(needed - len(chosen), len(remaining))))
        for product in chosen:
            if int(product["id"]) in used:
                continue
            selected.append(product)
            used.add(int(product["id"]))
            reasons[category] += 1

    if len(selected) != TARGET:
        raise SystemExit(f"Selected {len(selected)} products; expected exactly {TARGET}.")

    output_products = []
    for product in selected:
        product_id = int(product["id"])
        formula_output = []
        for formula in formulas_by_product[product_id]:
            ids = json_value(formula["ingredient_ids_json"], [])
            ingredients = []
            for position, ingredient_id in enumerate(ids):
                ingredient_id = int(ingredient_id)
                ingredient = ingredient_rows.get(ingredient_id, {})
                attrs = []
                for attribute_id in ingredient_attrs.get(ingredient_id, []):
                    attr = attribute_rows.get(attribute_id)
                    if not attr:
                        continue
                    key = attr["key"]
                    kind = "concern" if any(term in key for term in ("irrit", "worsen", "fragrance", "acne", "allergen", "dry_skin", "oily_skin")) else "benefit"
                    attrs.append({"id": attribute_id, "key": key, "label": attr["label"] or key, "kind": kind})
                ingredients.append({
                    "id": ingredient_id, "position": position,
                    "name": ingredient.get("name") or f"Ingredient {ingredient_id}",
                    "inciName": ingredient.get("inci_name") or None,
                    "attributes": attrs,
                })
            analysis = []
            for item in json_value(formula["analysis_json"], []):
                if not isinstance(item, list) or len(item) < 4:
                    continue
                attr_id, state_id, count, positions = item[:4]
                attr = attribute_rows.get(int(attr_id))
                if not attr:
                    continue
                analysis.append({
                    "attributeId": int(attr_id), "stateId": int(state_id),
                    "reportedCount": count, "ingredientIds": [], "key": attr["key"],
                    "label": attr["label"] or attr["key"],
                    "state": state_rows.get(int(state_id), "unknown"),
                    "resolved": state_rows.get(int(state_id)) == "resolved_endpoint" and bool(positions),
                    "ingredientPositions": [int(value) for value in positions],
                    "responsibleIngredients": [],
                    "kind": "concern" if any(term in attr["key"] for term in ("irrit", "worsen", "fragrance", "acne", "allergen", "dry_skin", "oily_skin")) else "benefit",
                })
            flag_ids = [int(value) for value in json_value(formula["flag_ids_json"], [])]
            formula_output.append({
                "id": int(formula["id"]), "region": formula["region"], "formulation": formula["formulation"],
                "variant": formula["variant"], "imageUrl": formula["image_url"],
                "ingredients": ingredients,
                "flags": [{"id": flag_id, "key": flag_rows[flag_id]["key"], "label": flag_rows[flag_id]["label"] or flag_rows[flag_id]["key"]} for flag_id in flag_ids if flag_id in flag_rows],
                "analysis": analysis, "decodeWarnings": [],
            })
        output_products.append({
            "productId": product_id, "brandId": int(product["brand_id"]),
            "brand": brand_names.get(int(product["brand_id"]), "Brand not listed"),
            "name": product["name"], "category": product["category"], "subcategory": product["subcategory"],
            "imageUrl": product["image_url"],
            "flags": formula_output[0]["flags"] if formula_output else [], "matchedIngredients": [],
            "formulas": formula_output,
            "hasParsedFormula": any(bool(item["ingredients"]) for item in formula_output),
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"source": "validated compact catalog CSV", "seed": SEED, "products": output_products}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    categories = collections.Counter(product["category"] for product in output_products)
    print(json.dumps({
        "fixture": str(OUTPUT), "products": len(output_products), "formulas": sum(len(p["formulas"]) for p in output_products),
        "categories": categories, "multiFormulaProducts": sum(len(p["formulas"]) > 1 for p in output_products),
        "noIngredientProducts": sum(not p["hasParsedFormula"] for p in output_products),
        "unresolvedFormulaCount": sum(sum(not a["resolved"] for a in f["analysis"]) for p in output_products for f in p["formulas"]),
    }, default=lambda value: dict(value), indent=2))


if __name__ == "__main__":
    main()
