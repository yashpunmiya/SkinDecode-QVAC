import * as SQLite from 'expo-sqlite';
import type { IngredientDetail, ProductDetail, ProductSummary } from './types';

const CACHE_VERSION = 3;
const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function openCatalogCache() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync('skindecode-products.db');
      await database.execAsync('PRAGMA journal_mode = WAL;');
      const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if ((version?.user_version || 0) < CACHE_VERSION) {
        // Product identifiers were reassigned by the compact catalog. Drop only
        // the public catalog cache; retain the authenticated user's shelf cache.
        await database.execAsync('DROP TABLE IF EXISTS catalog_products;');
        await database.execAsync(`
          CREATE TABLE catalog_products (
            product_id INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            brand TEXT NOT NULL,
            category TEXT,
            summary_json TEXT NOT NULL,
            detail_json TEXT,
            cached_at TEXT NOT NULL
          );
          CREATE INDEX catalog_products_name_idx ON catalog_products(name COLLATE NOCASE);
          CREATE INDEX catalog_products_brand_idx ON catalog_products(brand COLLATE NOCASE);
          CREATE TABLE IF NOT EXISTS catalog_ingredients (
            ingredient_id INTEGER PRIMARY KEY NOT NULL,
            detail_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_legacy_products (
            product_id INTEGER PRIMARY KEY NOT NULL,
            detail_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_shelf_cache (
            user_id TEXT PRIMARY KEY NOT NULL,
            items_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_search_cache (
            query_key TEXT NOT NULL,
            page_offset INTEGER NOT NULL,
            items_json TEXT NOT NULL,
            has_more INTEGER NOT NULL,
            cached_at TEXT NOT NULL,
            PRIMARY KEY(query_key,page_offset)
          );
          CREATE INDEX IF NOT EXISTS catalog_search_cache_recent_idx ON catalog_search_cache(cached_at DESC);
        `);
      } else {
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS catalog_ingredients (
            ingredient_id INTEGER PRIMARY KEY NOT NULL,
            detail_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_legacy_products (
            product_id INTEGER PRIMARY KEY NOT NULL,
            detail_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_shelf_cache (
            user_id TEXT PRIMARY KEY NOT NULL,
            items_json TEXT NOT NULL,
            cached_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS catalog_search_cache (
            query_key TEXT NOT NULL,
            page_offset INTEGER NOT NULL,
            items_json TEXT NOT NULL,
            has_more INTEGER NOT NULL,
            cached_at TEXT NOT NULL,
            PRIMARY KEY(query_key,page_offset)
          );
          CREATE INDEX IF NOT EXISTS catalog_search_cache_recent_idx ON catalog_search_cache(cached_at DESC);
        `);
      }
      if ((version?.user_version || 0) < CACHE_VERSION) {
        await database.execAsync('DROP TABLE IF EXISTS catalog_better_match_cache;');
        await database.execAsync(`PRAGMA user_version = ${CACHE_VERSION};`);
      }
      return database;
    })().catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

type ProductCacheRow = {
  product_id: number;
  name: string;
  brand: string;
  category: string | null;
  summary_json: string;
  detail_json: string | null;
  cached_at: string;
};

export type CachedProductSearch = {
  items: ProductSummary[];
  hasMore: boolean;
  cachedAt: string;
  fresh: boolean;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function getCachedProducts(query: string, offset: number, limit: number): Promise<ProductSummary[]> {
  const db = await openCatalogCache();
  const stopWords = new Set(['the', 'and', 'with', 'for', 'from', 'a', 'an', 'of', 'in', 'to', 'by']);
  const tokens = [...new Set(query.normalize('NFKC').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !stopWords.has(token)))].slice(0, 8);
  if (!tokens.length) return [];
  const tokenConditions = tokens.map(() => `(name LIKE ? COLLATE NOCASE OR brand LIKE ? COLLATE NOCASE OR COALESCE(category,'') LIKE ? COLLATE NOCASE OR COALESCE(summary_json,'') LIKE ? COLLATE NOCASE)`);
  const tokenParameters = tokens.flatMap((token) => Array(4).fill(`%${token}%`));
  const safeQuery = query.replace(/[\\%_]/g, '');
  const rows = await db.getAllAsync<ProductCacheRow>(
    `SELECT * FROM catalog_products WHERE ${tokenConditions.join(' AND ')}
     ORDER BY CASE WHEN name = ? COLLATE NOCASE THEN 0 WHEN name LIKE ? COLLATE NOCASE THEN 1
       WHEN brand LIKE ? COLLATE NOCASE THEN 2 ELSE 3 END, name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    ...tokenParameters, safeQuery, `${safeQuery}%`, `${safeQuery}%`, limit, offset,
  );
  return rows.flatMap((row) => {
    const summary = parseJson<ProductSummary>(row.summary_json);
    return summary ? [summary] : [];
  });
}

export async function getCachedProductSearch(query: string, offset: number): Promise<CachedProductSearch | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<{ items_json: string; has_more: number; cached_at: string }>(
    'SELECT items_json,has_more,cached_at FROM catalog_search_cache WHERE query_key=? AND page_offset=?', query, offset,
  );
  if (!row) return null;
  const items = parseJson<ProductSummary[]>(row.items_json);
  if (!items) return null;
  return {
    items,
    hasMore: Boolean(row.has_more),
    cachedAt: row.cached_at,
    fresh: Date.now() - Date.parse(row.cached_at) < SEARCH_CACHE_TTL_MS,
  };
}

export async function cacheProductSearch(query: string, offset: number, items: ProductSummary[], hasMore: boolean) {
  const db = await openCatalogCache();
  await db.runAsync(
    `INSERT INTO catalog_search_cache(query_key,page_offset,items_json,has_more,cached_at)
     VALUES(?,?,?,?,?) ON CONFLICT(query_key,page_offset) DO UPDATE SET
       items_json=excluded.items_json,has_more=excluded.has_more,cached_at=excluded.cached_at`,
    query, offset, JSON.stringify(items), hasMore ? 1 : 0, new Date().toISOString(),
  );
  await db.runAsync(`DELETE FROM catalog_search_cache WHERE rowid IN (
    SELECT rowid FROM catalog_search_cache ORDER BY cached_at DESC LIMIT -1 OFFSET 100
  )`);
}

export async function cacheProducts(products: ProductSummary[]) {
  if (!products.length) return;
  const db = await openCatalogCache();
  const cachedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const product of products) {
      await db.runAsync(
        `INSERT INTO catalog_products(product_id,name,brand,category,summary_json,detail_json,cached_at)
         VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(product_id) DO UPDATE SET
          name=excluded.name,brand=excluded.brand,category=excluded.category,
          summary_json=excluded.summary_json,cached_at=excluded.cached_at`,
        product.productId, product.name, product.brand, product.category, JSON.stringify(product), cachedAt,
      );
    }
  });
  await db.runAsync(`DELETE FROM catalog_products WHERE product_id IN (
    SELECT product_id FROM catalog_products ORDER BY cached_at DESC LIMIT -1 OFFSET 1500
  )`);
}

export async function getCachedProduct(productId: number): Promise<{ product: ProductDetail; cachedAt: string } | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<ProductCacheRow>('SELECT * FROM catalog_products WHERE product_id=?', productId);
  const product = parseJson<ProductDetail>(row?.detail_json || null);
  return row && product ? { product, cachedAt: row.cached_at } : null;
}

export async function getCachedProductSummary(productId: number): Promise<ProductSummary | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<ProductCacheRow>('SELECT * FROM catalog_products WHERE product_id=?', productId);
  return parseJson<ProductSummary>(row?.summary_json || null);
}

export async function getCachedProductsByIds(productIds: number[]) {
  if (!productIds.length) return new Map<number, ProductSummary>();
  const db = await openCatalogCache();
  const rows = await db.getAllAsync<ProductCacheRow>(
    `SELECT * FROM catalog_products WHERE product_id IN (${productIds.map(() => '?').join(',')})`, ...productIds,
  );
  return new Map(rows.flatMap((row) => {
    const summary = parseJson<ProductSummary>(row.summary_json);
    return summary ? [[row.product_id, summary] as const] : [];
  }));
}

export async function getCachedProductDetailsByIds(productIds: number[]) {
  const uniqueIds = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length) return new Map<number, ProductDetail>();
  const db = await openCatalogCache();
  const rows = await db.getAllAsync<ProductCacheRow>(
    `SELECT * FROM catalog_products WHERE product_id IN (${uniqueIds.map(() => '?').join(',')}) AND detail_json IS NOT NULL`, ...uniqueIds,
  );
  return new Map(rows.flatMap((row) => {
    const detail = parseJson<ProductDetail>(row.detail_json);
    return detail ? [[row.product_id, detail] as const] : [];
  }));
}

export async function cacheProductDetail(product: ProductDetail) {
  const db = await openCatalogCache();
  const cachedAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO catalog_products(product_id,name,brand,category,summary_json,detail_json,cached_at)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET
      name=excluded.name,brand=excluded.brand,category=excluded.category,
      summary_json=excluded.summary_json,detail_json=excluded.detail_json,cached_at=excluded.cached_at`,
    product.productId, product.name, product.brand, product.category, JSON.stringify(summaryOf(product)), JSON.stringify(product), cachedAt,
  );
}

export async function cacheLegacyProductDetail(product: ProductDetail) {
  const db = await openCatalogCache();
  await db.runAsync(
    `INSERT INTO catalog_legacy_products(product_id,detail_json,cached_at) VALUES(?,?,?)
     ON CONFLICT(product_id) DO UPDATE SET detail_json=excluded.detail_json,cached_at=excluded.cached_at`,
    product.productId, JSON.stringify(product), new Date().toISOString(),
  );
}

export async function getCachedLegacyProductDetail(productId: number): Promise<ProductDetail | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<{ detail_json: string }>('SELECT detail_json FROM catalog_legacy_products WHERE product_id=?', productId);
  return row ? parseJson<ProductDetail>(row.detail_json) : null;
}

function summaryOf(product: ProductSummary): ProductSummary {
  return {
    productId: product.productId, brandId: product.brandId, brand: product.brand, name: product.name,
    category: product.category, subcategory: product.subcategory, imageUrl: product.imageUrl,
    description: product.description, flags: product.flags, matchedIngredients: product.matchedIngredients,
  };
}

export type CachedShelfItem = { id: string; productId: number; notes: string | null; createdAt: string };

export async function cacheShelfItems(userId: string, items: CachedShelfItem[]) {
  const db = await openCatalogCache();
  await db.runAsync(
    `INSERT INTO catalog_shelf_cache(user_id,items_json,cached_at) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET items_json=excluded.items_json,cached_at=excluded.cached_at`,
    userId, JSON.stringify(items), new Date().toISOString(),
  );
}

export async function getCachedShelfItems(userId: string): Promise<CachedShelfItem[] | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<{ items_json: string }>('SELECT items_json FROM catalog_shelf_cache WHERE user_id=?', userId);
  return row ? parseJson<CachedShelfItem[]>(row.items_json) : null;
}

export async function deleteUserShelfCache(userId: string) {
  const db = await openCatalogCache();
  await db.runAsync('DELETE FROM catalog_shelf_cache WHERE user_id=?', userId);
}

export async function cacheIngredientDetail(ingredient: IngredientDetail) {
  const db = await openCatalogCache();
  await db.runAsync(
    `INSERT INTO catalog_ingredients(ingredient_id,detail_json,cached_at) VALUES(?,?,?)
     ON CONFLICT(ingredient_id) DO UPDATE SET detail_json=excluded.detail_json,cached_at=excluded.cached_at`,
    ingredient.id, JSON.stringify(ingredient), new Date().toISOString(),
  );
}

export async function getCachedIngredientDetail(ingredientId: number): Promise<IngredientDetail | null> {
  const db = await openCatalogCache();
  const row = await db.getFirstAsync<{ detail_json: string }>('SELECT detail_json FROM catalog_ingredients WHERE ingredient_id=?', ingredientId);
  return row ? parseJson<IngredientDetail>(row.detail_json) : null;
}
