import { supabase } from '../lib/supabase';
import type {
  CatalogAnalysisStateRow, CatalogAttributeRow, CatalogBrandRow, CatalogFlagRow,
  CatalogFormulaRow, CatalogIngredientAliasRow, CatalogIngredientAttributeRow,
  CatalogIngredientReferenceRow, CatalogIngredientRow, CatalogLegacyProductRefRow,
  CatalogProductRow, CatalogSearchProductRow, ShelfItemRow, UserProfileRow,
} from '../types/database.types';
import type { RoutineStep } from '../routine/models';
import {
  cacheIngredientDetail, cacheLegacyProductDetail, cacheProductDetail, cacheProductSearch, cacheProducts, cacheShelfItems,
  cacheSkinProfile, getCachedIngredientDetail, getCachedLegacyProductDetail, getCachedProduct, getCachedProductDetailsByIds, getCachedProductSearch, getCachedSkinProfile,
  getCachedProducts, getCachedProductsByIds, getCachedShelfItems,
} from './product-cache';
import { decodeCompactFormula } from './compact-formula';
import { analysisKind } from './personalization';
import { resolveFormulaAnalysis } from './catalog-evidence';
import { scoreProductMatch, type ProductIntelligence } from './product-intelligence';
import type {
  IngredientAttribute, IngredientDetail, IngredientReference,
  ProductDetail, ProductFormula, ProductIngredient, ProductSearchResult, SkinProfile,
  ProductSummary, ShelfItem,
} from './types';

const SEARCH_LIMIT = 20;
const PRODUCT_COLUMNS = 'id,brand_id,name,category,subcategory,image_url,description';
const CATALOG = 'skindecode_catalog';

type CatalogDictionaries = {
  flags: Map<number, CatalogFlagRow>;
  attributes: Map<number, CatalogAttributeRow>;
  states: Map<number, CatalogAnalysisStateRow>;
};
let dictionaryPromise: Promise<CatalogDictionaries> | undefined;
const profileCache = new Map<string, { value: UserProfileRow | null; expiresAt: number }>();
const profileRequests = new Map<string, Promise<UserProfileRow | null>>();
const profileCacheVersion = new Map<string, number>();
export function invalidateSkinProfileCache(userId: string) {
  profileCache.delete(userId);
  profileCacheVersion.set(userId, (profileCacheVersion.get(userId) || 0) + 1);
  profileRequests.delete(userId);
}

function cleanSearchTerm(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function decodeCatalogText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (code[0] !== '#') return named[code.toLocaleLowerCase()] || entity;
    const point = code[1]?.toLocaleLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try { return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity; }
    catch { return entity; }
  });
}

function isApiSetupError(error: { code?: string; message?: string }) {
  return error.code === 'PGRST106' || error.code === '42501' || error.code === 'PGRST202' || /schema.*exposed|permission denied|function .*search_products.*not found/i.test(error.message || '');
}

function raiseIfError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (isApiSetupError(error)) {
    throw new Error('The compact catalog API is not ready. Apply the compact catalog search migration and expose skindecode_catalog in Supabase API settings.');
  }
  const normalized = new Error(error.message || 'The catalog request failed.') as Error & { code?: string; status?: number };
  normalized.code = error.code;
  normalized.status = (error as { status?: number }).status;
  throw normalized;
}

function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; message?: string; status?: number; code?: string };
  // PostgreSQL 57014 means the database cancelled a statement (most commonly
  // because it exceeded statement_timeout), not that the device lost network.
  if (candidate.code === '57014' || /statement timeout|canceling statement due to/i.test(candidate.message || '')) return false;
  if (candidate.status === 0 || candidate.name === 'AbortError' || candidate.name === 'NetworkError') return true;
  return /network request failed|failed to fetch|fetch failed|networkerror|connection reset|socket hang up|network.*timed? ?out|connection.*timed? ?out|econn(reset|refused)|enotfound|eai_again/i.test(
    `${candidate.name || ''} ${candidate.message || ''} ${candidate.code || ''}`,
  );
}

function logCatalogFailure(operation: string, error: unknown) {
  const candidate = error && typeof error === 'object'
    ? error as { code?: string; status?: number; message?: string }
    : null;
  console.warn(`[catalog] ${operation} request failed`, {
    code: candidate?.code,
    status: candidate?.status,
    message: candidate?.message || String(error),
  });
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}

function toProductFlag(row: CatalogFlagRow | undefined): ProductFormula['flags'][number] | null {
  if (!row) return null;
  return { id: row.id, key: row.key, label: row.label || row.key.replaceAll('_', ' ') };
}

async function getCatalogDictionaries(): Promise<CatalogDictionaries> {
  if (!dictionaryPromise) {
    dictionaryPromise = (async () => {
      const catalog = supabase.schema(CATALOG);
      const [flags, attributes, states] = await Promise.all([
        catalog.from('catalog_flags').select('id,key,label').order('id'),
        catalog.from('catalog_attributes').select('id,key,label,description').order('id'),
        catalog.from('catalog_analysis_states').select('id,key').order('id'),
      ]);
      raiseIfError(flags.error); raiseIfError(attributes.error); raiseIfError(states.error);
      return {
        flags: new Map(((flags.data || []) as unknown as CatalogFlagRow[]).map((row) => [row.id, row])),
        attributes: new Map(((attributes.data || []) as unknown as CatalogAttributeRow[]).map((row) => [row.id, row])),
        states: new Map(((states.data || []) as unknown as CatalogAnalysisStateRow[]).map((row) => [row.id, row])),
      };
    })().catch((error) => { dictionaryPromise = undefined; throw error; });
  }
  return dictionaryPromise;
}

export async function searchProducts(value: string, offset = 0, signal?: AbortSignal): Promise<ProductSearchResult> {
  const query = cleanSearchTerm(value);
  const safeOffset = Math.max(0, offset);
  if (query.length < 2) return { items: [], offline: false, hasMore: false };

  const cachedSearch = await getCachedProductSearch(query, safeOffset).catch(() => null);
  if (signal?.aborted) throw new Error('Search canceled.');
  if (cachedSearch?.fresh) {
    return { items: cachedSearch.items, offline: false, hasMore: cachedSearch.hasMore };
  }

  try {
    let request = supabase.schema(CATALOG).rpc('search_products', {
      search_query: query, page_size: SEARCH_LIMIT, page_offset: safeOffset,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    raiseIfError(error);
    const rows = (data || []) as unknown as CatalogSearchProductRow[];
    const items: ProductSummary[] = rows.map((row) => ({
      productId: row.id,
      brandId: null,
      brand: decodeCatalogText(row.brand_name) || 'Brand not listed',
      name: decodeCatalogText(row.name) || 'Unnamed product',
      category: decodeCatalogText(row.category),
      subcategory: decodeCatalogText(row.subcategory),
      imageUrl: row.image_url,
      description: null,
      flags: (row.product_flags || []).slice(0, 3).map((label, index) => ({ id: index, key: label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_'), label })),
      matchedIngredients: [],
    }));
    const hasMore = rows[0]?.has_more ?? items.length === SEARCH_LIMIT;
    await cacheProductSearch(query, safeOffset, items, hasMore).catch((error) => console.warn('[catalog] search cache write failed', error));
    await cacheProducts(items).catch((error) => console.warn('[catalog] product cache write failed', error));
    return { items, offline: false, hasMore };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.message.includes('compact catalog API is not ready')) throw error;
    if (!isNetworkFailure(error)) {
      logCatalogFailure('search', error);
      throw error;
    }
    logCatalogFailure('search network', error);
    const cached = cachedSearch?.items || await getCachedProducts(query, safeOffset, SEARCH_LIMIT).catch(() => []);
    return { items: cached, offline: true, hasMore: cachedSearch?.hasMore ?? cached.length === SEARCH_LIMIT };
  }
}

async function fetchProductRows(ids: number[]): Promise<CatalogIngredientRow[]> {
  if (!ids.length) return [];
  const catalog = supabase.schema(CATALOG);
  const output: CatalogIngredientRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const { data, error } = await catalog.from('catalog_ingredients')
      .select('id,name,inci_name,inn_name,ph_eur_name,description,functions_json,prevalence_label,prevalence_percent,common_categories_json,typical_list_position')
      .in('id', ids.slice(offset, offset + 400));
    raiseIfError(error);
    output.push(...((data || []) as unknown as CatalogIngredientRow[]));
  }
  return output;
}

function toProductIngredient(
  row: CatalogIngredientRow | undefined,
  ingredientId: number,
  position: number,
  attributesByIngredient: Map<number, IngredientAttribute[]> = new Map(),
): ProductIngredient {
  const inciName = row?.inci_name || null;
  return {
    id: row?.id ?? ingredientId,
    position,
    name: decodeCatalogText(row?.name) || inciName || `Ingredient #${ingredientId}`,
    inciName: decodeCatalogText(inciName),
    rawToken: null,
    functions: parseStringArray(row?.functions_json || null).map((fn) => decodeCatalogText(fn) || fn),
    description: decodeCatalogText(row?.description),
    attributes: attributesByIngredient.get(ingredientId) || [],
  };
}

async function fetchProductDetail(productId: number): Promise<ProductDetail | null> {
  const catalog = supabase.schema(CATALOG);
  const { data: productData, error: productError } = await catalog.from('catalog_products')
    .select(PRODUCT_COLUMNS).eq('id', productId).maybeSingle();
  raiseIfError(productError);
  if (!productData) return null;
  const product = productData as unknown as CatalogProductRow;

  const [brandResponse, formulasResponse, dictionaries] = await Promise.all([
    catalog.from('catalog_brands').select('id,name').eq('id', product.brand_id).maybeSingle(),
    catalog.from('catalog_formulas')
      .select('id,product_id,region,formulation,variant,image_url,ingredient_ids_json,flag_ids_json,analysis_json')
      .eq('product_id', productId).order('id', { ascending: true }).limit(200),
    getCatalogDictionaries(),
  ]);
  raiseIfError(brandResponse.error); raiseIfError(formulasResponse.error);
  const formulas = (formulasResponse.data || []) as unknown as CatalogFormulaRow[];
  const decodedFormulas = formulas.map((formula) => ({ formula, decoded: decodeCompactFormula(formula) }));
  const referencedIngredientIds = [...new Set(decodedFormulas.flatMap(({ decoded }) => [
    ...decoded.ingredientIds,
  ]))];
  let ingredientRows: CatalogIngredientRow[] = [];
  const ingredientAttributes = new Map<number, IngredientAttribute[]>();
  if (referencedIngredientIds.length) {
    const links: CatalogIngredientAttributeRow[] = [];
    for (let offset = 0; offset < referencedIngredientIds.length; offset += 400) {
      const { data, error } = await catalog.from('catalog_ingredient_attributes').select('ingredient_id,attribute_id')
        .in('ingredient_id', referencedIngredientIds.slice(offset, offset + 400));
      raiseIfError(error);
      links.push(...((data || []) as unknown as CatalogIngredientAttributeRow[]));
    }
    ingredientRows = await fetchProductRows(referencedIngredientIds);
    for (const link of links) {
      const attribute = dictionaries.attributes.get(link.attribute_id);
      if (!attribute) continue;
      const values = ingredientAttributes.get(link.ingredient_id) || [];
      values.push({
        id: attribute.id, key: attribute.key,
        label: decodeCatalogText(attribute.label) || attribute.key.replaceAll('_', ' '),
        description: decodeCatalogText(attribute.description), kind: analysisKind(attribute.key),
      });
      ingredientAttributes.set(link.ingredient_id, values);
    }
  }
  const ingredientsById = new Map(ingredientRows.map((row) => [row.id, row]));
  const brand = decodeCatalogText((brandResponse.data as unknown as CatalogBrandRow | null)?.name) || 'Brand not listed';
  const detailFormulas: ProductFormula[] = decodedFormulas.map(({ formula, decoded }) => ({
    id: formula.id,
    region: formula.region,
    formulation: formula.formulation,
    variant: formula.variant,
    imageUrl: formula.image_url,
    ingredients: decoded.ingredientIds.map((id, position) => toProductIngredient(ingredientsById.get(id), id, position, ingredientAttributes)),
    flags: decoded.flagIds.map((id) => toProductFlag(dictionaries.flags.get(id))).filter((flag): flag is NonNullable<typeof flag> => flag !== null),
    analysis: resolveFormulaAnalysis(
      decoded.analysis,
      new Map([...dictionaries.attributes].map(([id, value]) => [id, { key: value.key, label: decodeCatalogText(value.label), description: decodeCatalogText(value.description) }])),
      new Map([...dictionaries.states].map(([id, value]) => [id, { key: value.key }])),
      decoded.ingredientIds.map((id, position) => toProductIngredient(ingredientsById.get(id), id, position, ingredientAttributes)),
    ),
    decodeWarnings: decoded.warnings,
  }));

  return {
    productId: product.id,
    brandId: product.brand_id,
    brand,
    name: decodeCatalogText(product.name) || 'Unnamed product',
    category: decodeCatalogText(product.category),
    subcategory: decodeCatalogText(product.subcategory),
    imageUrl: product.image_url,
    description: decodeCatalogText(product.description),
    flags: detailFormulas[0]?.flags || [],
    matchedIngredients: [],
    formulas: detailFormulas,
    hasParsedFormula: detailFormulas.some((formula) => formula.ingredients.length > 0),
  };
}

async function fetchLegacyProductDetail(productId: number): Promise<ProductDetail | null> {
  const catalog = supabase.schema(CATALOG);
  const { data, error } = await catalog.from('catalog_legacy_product_refs')
    .select('product_id,product_snapshot').eq('product_id', productId).maybeSingle();
  raiseIfError(error);
  if (!data) return null;
  const row = data as unknown as CatalogLegacyProductRefRow;
  const summary = toLegacySummary(row);
  const snapshot = row.product_snapshot;
  return {
    ...summary,
    rawIngredientText: typeof snapshot.raw_ingredient_text === 'string' ? decodeCatalogText(snapshot.raw_ingredient_text) : null,
    formulas: [],
    hasParsedFormula: false,
  };
}

export async function getProductDetail(productId: number, legacySnapshot = false): Promise<{ product: ProductDetail | null; offline: boolean; cached: boolean }> {
  if (legacySnapshot) {
    const cachedLegacy = await getCachedLegacyProductDetail(productId).catch(() => null);
    try {
      const product = await fetchLegacyProductDetail(productId);
      if (product) await cacheLegacyProductDetail(product).catch((error) => console.warn('[catalog] legacy product cache write failed', error));
      return { product, offline: false, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message.includes('compact catalog API is not ready')) throw error;
      if (!isNetworkFailure(error)) { logCatalogFailure('legacy product detail', error); throw error; }
      logCatalogFailure('legacy product detail network', error);
      return cachedLegacy ? { product: cachedLegacy, offline: true, cached: true } : { product: null, offline: true, cached: false };
    }
  }
  const cached = await getCachedProduct(productId).catch(() => null);
  try {
    const product = await fetchProductDetail(productId);
    if (product) await cacheProductDetail(product).catch((error) => console.warn('[catalog] product detail cache write failed', error));
    return { product, offline: false, cached: false };
  } catch (error) {
    if (error instanceof Error && error.message.includes('compact catalog API is not ready')) throw error;
    if (!isNetworkFailure(error)) { logCatalogFailure('product detail', error); throw error; }
    logCatalogFailure('product detail network', error);
    if (cached) return { product: cached.product, offline: true, cached: true };
    return { product: null, offline: true, cached: false };
  }
}

export async function getCompactProductSummariesByIds(productIds: number[]) {
  const uniqueIds = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const cached = await getCachedProductsByIds(uniqueIds).catch(() => new Map<number, ProductSummary>());
  const results = new Map<number, ProductSummary>(cached);
  const missingIds = uniqueIds.filter((id) => !results.has(id));
  if (!missingIds.length) return results;

  const catalog = supabase.schema(CATALOG);
  const { data, error } = await catalog.from('catalog_products').select(PRODUCT_COLUMNS).in('id', missingIds);
  raiseIfError(error);
  const rows = (data || []) as unknown as CatalogProductRow[];
  const brandIds = [...new Set(rows.map((row) => row.brand_id))];
  const brandNames = new Map<number, string>();
  if (brandIds.length) {
    const brands = await catalog.from('catalog_brands').select('id,name').in('id', brandIds);
    raiseIfError(brands.error);
    for (const row of (brands.data || []) as unknown as CatalogBrandRow[]) brandNames.set(row.id, row.name);
  }
  const products: ProductSummary[] = rows.map((row) => ({
    productId: row.id, brandId: row.brand_id, brand: decodeCatalogText(brandNames.get(row.brand_id)) || 'Brand not listed',
    name: decodeCatalogText(row.name) || 'Unnamed product', category: decodeCatalogText(row.category), subcategory: decodeCatalogText(row.subcategory),
    imageUrl: row.image_url, description: decodeCatalogText(row.description), flags: [], matchedIngredients: [],
  }));
  await cacheProducts(products).catch((cacheError) => console.warn('[catalog] product cache write failed', cacheError));
  for (const item of products) results.set(item.productId, item);
  return results;
}

function toLegacySummary(row: CatalogLegacyProductRefRow): ProductSummary {
  const snapshot = row.product_snapshot;
  return {
    productId: row.product_id,
    barcode: typeof snapshot.barcode === 'string' ? snapshot.barcode : null,
    brandId: typeof snapshot.brand_id === 'number' ? snapshot.brand_id : null,
    brand: typeof snapshot.brand_raw === 'string' && snapshot.brand_raw.trim() ? decodeCatalogText(snapshot.brand_raw) || 'Brand not listed' : 'Brand not listed',
    name: typeof snapshot.name === 'string' && snapshot.name.trim() ? decodeCatalogText(snapshot.name) || 'Saved legacy product' : 'Saved legacy product',
    category: typeof snapshot.category === 'string' ? decodeCatalogText(snapshot.category) : null,
    subcategory: null,
    quantity: typeof snapshot.quantity === 'string' ? snapshot.quantity : null,
    imageUrl: typeof snapshot.image_url === 'string' ? snapshot.image_url : null,
    description: null,
    flags: [],
    matchedIngredients: [],
    isLegacySnapshot: true,
  };
}

export async function getRoutineProductSummaries(userId: string, steps: Pick<RoutineStep, 'id' | 'productId' | 'shelfItemId'>[]) {
  const result = new Map<string, ProductSummary>();
  const legacyIds = [...new Set(steps.map((step) => step.productId).filter((id): id is number => id !== null))];
  const shelfIds = [...new Set(steps.map((step) => step.shelfItemId).filter((id): id is string => Boolean(id)))];
  const catalog = supabase.schema(CATALOG);
  let legacyById = new Map<number, ProductSummary>();
  if (legacyIds.length) {
    const { data, error } = await catalog.from('catalog_legacy_product_refs')
      .select('product_id,product_snapshot').in('product_id', legacyIds);
    raiseIfError(error);
    legacyById = new Map(((data || []) as unknown as CatalogLegacyProductRefRow[]).map((row) => [row.product_id, toLegacySummary(row)]));
  }

  const productIdByShelf = new Map<string, number>();
  if (shelfIds.length) {
    const { data, error } = await supabase.from('shelf_items').select('id,user_id,product_id,notes,created_at')
      .eq('user_id', userId).in('id', shelfIds);
    raiseIfError(error);
    for (const row of (data || []) as ShelfItemRow[]) productIdByShelf.set(row.id, row.product_id);
  }
  // routine_steps.product_id represents the old catalog namespace and must
  // resolve only through its preserved snapshot. Looking up a missing legacy
  // ID in compact_catalog could silently open an unrelated product after IDs
  // were reassigned. New product links resolve through the owned shelf item.
  const compactIds = [...new Set(productIdByShelf.values())];
  const compactById = compactIds.length ? await getCompactProductSummariesByIds(compactIds) : new Map<number, ProductSummary>();

  for (const step of steps) {
    if (step.productId !== null) {
      const product = legacyById.get(step.productId);
      if (product) result.set(step.id, product);
      continue;
    }
    if (step.shelfItemId) {
      const compactId = productIdByShelf.get(step.shelfItemId);
      const product = compactId === undefined ? undefined : compactById.get(compactId);
      if (product) result.set(step.id, product);
    }
  }
  return result;
}

export async function getIngredientDetail(ingredientId: number): Promise<{ ingredient: IngredientDetail | null; offline: boolean; cached: boolean }> {
  const cached = await getCachedIngredientDetail(ingredientId).catch(() => null);
  try {
    const catalog = supabase.schema(CATALOG);
    const [ingredientResponse, aliasResponse, attributeLinksResponse, refsResponse] = await Promise.all([
      catalog.from('catalog_ingredients')
        .select('id,name,inci_name,inn_name,ph_eur_name,description,functions_json,prevalence_label,prevalence_percent,common_categories_json,typical_list_position')
        .eq('id', ingredientId).maybeSingle(),
      catalog.from('catalog_ingredient_aliases').select('ingredient_id,alias,normalized_alias').eq('ingredient_id', ingredientId).order('alias').limit(100),
      catalog.from('catalog_ingredient_attributes').select('ingredient_id,attribute_id').eq('ingredient_id', ingredientId).limit(66),
      catalog.from('catalog_ingredient_references').select('id,ingredient_id,url,domain,label').eq('ingredient_id', ingredientId).order('id').limit(50),
    ]);
    raiseIfError(ingredientResponse.error); raiseIfError(aliasResponse.error);
    raiseIfError(attributeLinksResponse.error); raiseIfError(refsResponse.error);
    if (!ingredientResponse.data) return { ingredient: null, offline: false, cached: false };
    const row = ingredientResponse.data as unknown as CatalogIngredientRow;
    const links = (attributeLinksResponse.data || []) as unknown as CatalogIngredientAttributeRow[];
    const attributeIds = [...new Set(links.map((link) => link.attribute_id))];
    const { data: attributeData, error: attributeError } = attributeIds.length
      ? await catalog.from('catalog_attributes').select('id,key,label,description').in('id', attributeIds)
      : { data: [], error: null };
    raiseIfError(attributeError);
    const attributesById = new Map(((attributeData || []) as unknown as CatalogAttributeRow[]).map((attribute) => [attribute.id, attribute]));
    const attributes: IngredientAttribute[] = links.flatMap((link) => {
      const attribute = attributesById.get(link.attribute_id);
      if (!attribute) return [];
      return [{
        id: attribute.id, key: attribute.key,
        label: decodeCatalogText(attribute.label) || attribute.key.replaceAll('_', ' '),
        description: decodeCatalogText(attribute.description), kind: analysisKind(attribute.key),
      }];
    });
    const ingredient: IngredientDetail = {
      id: row.id,
      name: decodeCatalogText(row.name) || row.name,
      inciName: decodeCatalogText(row.inci_name),
      innName: row.inn_name,
      phEurName: decodeCatalogText(row.ph_eur_name),
      description: decodeCatalogText(row.description),
      functions: parseStringArray(row.functions_json).map((fn) => decodeCatalogText(fn) || fn),
      aliases: ((aliasResponse.data || []) as unknown as CatalogIngredientAliasRow[]).map((alias) => decodeCatalogText(alias.alias) || alias.alias).filter(Boolean),
      attributes,
      prevalenceLabel: row.prevalence_label,
      prevalencePercent: row.prevalence_percent,
      commonCategories: parseStringArray(row.common_categories_json).map((category) => decodeCatalogText(category) || category),
      typicalListPosition: row.typical_list_position,
      references: ((refsResponse.data || []) as unknown as CatalogIngredientReferenceRow[]).map((reference): IngredientReference => ({
        id: reference.id, url: reference.url, domain: reference.domain, label: reference.label,
      })),
    };
    await cacheIngredientDetail(ingredient).catch((error) => console.warn('[catalog] ingredient cache write failed', error));
    return { ingredient, offline: false, cached: false };
  } catch (error) {
    if (error instanceof Error && error.message.includes('compact catalog API is not ready')) throw error;
    if (!isNetworkFailure(error)) { logCatalogFailure('ingredient detail', error); throw error; }
    logCatalogFailure('ingredient detail network', error);
    return cached ? { ingredient: cached, offline: true, cached: true } : { ingredient: null, offline: true, cached: false };
  }
}

export async function getSkinProfile(userId: string): Promise<UserProfileRow | null> {
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = profileRequests.get(userId);
  if (pending) return pending;
  const version = profileCacheVersion.get(userId) || 0;
  let request: Promise<UserProfileRow | null>;
  request = (async () => {
    const cachedDisk = await getCachedSkinProfile(userId).catch(() => null);
    let value: UserProfileRow | null;
    try {
      const { data, error } = await supabase.from('user_profiles')
        .select('id,age_range,skin_type,sensitivity,skin_concerns,skin_goals,preferences,onboarding_completed,created_at,updated_at')
        .eq('id', userId).maybeSingle();
      if (error) throw error;
      value = data as UserProfileRow | null;
      if (value) await cacheSkinProfile(userId, value).catch((cacheError) => console.warn('[catalog] skin profile cache write failed', cacheError));
    } catch (error) {
      if (!isNetworkFailure(error) || !cachedDisk) throw error;
      logCatalogFailure('skin profile network; using local cache', error);
      value = cachedDisk;
    }
    if ((profileCacheVersion.get(userId) || 0) === version) profileCache.set(userId, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
    return value;
  })().finally(() => { if (profileRequests.get(userId) === request) profileRequests.delete(userId); });
  profileRequests.set(userId, request);
  return request;
}

/** Scores cached product summaries and formula details from SQLite. Never fetches
 * catalog formulas for list surfaces; full explanations load after opening a product. */
export async function getCachedProductIntelligence(userId: string, productIds: number[]): Promise<Map<number, ProductIntelligence>> {
  const uniqueIds = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length) return new Map();
  const profileRow = await getSkinProfile(userId);
  if (!profileRow?.onboarding_completed) return new Map();
  const profile = {
    ageRange: profileRow.age_range, skinType: profileRow.skin_type, sensitivity: profileRow.sensitivity,
    concerns: profileRow.skin_concerns || [], goals: profileRow.skin_goals || [], preferences: profileRow.preferences || [],
  };
  const [details, summaries] = await Promise.all([
    getCachedProductDetailsByIds(uniqueIds).catch(() => new Map()),
    getCachedProductsByIds(uniqueIds).catch(() => new Map()),
  ]);
  const results = new Map([...details].map(([id, product]) => [id, scoreProductMatch(product, profile)]));
  for (const [id, summary] of summaries) if (!results.has(id)) results.set(id, scoreProductMatch(summary, profile));
  return results;
}

export async function getShelfProductIds(userId: string): Promise<Set<number>> {
  const { data, error } = await supabase.from('shelf_items').select('id,user_id,product_id,notes,created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return new Set(((data || []) as ShelfItemRow[]).map((item) => item.product_id));
}

export async function listShelfItems(userId: string): Promise<{ items: ShelfItem[]; offline: boolean }> {
  try {
    const { data, error } = await supabase.from('shelf_items').select('id,user_id,product_id,notes,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const shelfRows = (data || []) as ShelfItemRow[];
    await cacheShelfItems(userId, shelfRows.map((item) => ({ id: item.id, productId: item.product_id, notes: item.notes, createdAt: item.created_at })));
    const products = await getCompactProductSummariesByIds([...new Set(shelfRows.map((item) => item.product_id))]);
    return {
      items: shelfRows.map((item) => ({
        id: item.id, productId: item.product_id, notes: item.notes, createdAt: item.created_at,
        product: products.get(item.product_id) || null,
      })),
      offline: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('compact catalog API is not ready')) throw error;
    if (!isNetworkFailure(error)) { logCatalogFailure('shelf', error); throw error; }
    logCatalogFailure('shelf network', error);
    const cachedShelf = await getCachedShelfItems(userId).catch(() => null);
    const cachedProducts = await getCachedProductsByIds(cachedShelf?.map((item) => item.productId) || []).catch(() => new Map());
    return {
      items: (cachedShelf || []).map((item) => ({
        id: item.id, productId: item.productId, notes: item.notes, createdAt: item.createdAt,
        product: cachedProducts.get(item.productId) || null,
      })),
      offline: true,
    };
  }
}

export async function getShelfItemForProduct(userId: string, productId: number): Promise<ShelfItemRow | null> {
  const { data, error } = await supabase.from('shelf_items').select('id,user_id,product_id,notes,created_at')
    .eq('user_id', userId).eq('product_id', productId).maybeSingle();
  if (error) throw error;
  return data as ShelfItemRow | null;
}

export async function addProductToShelf(userId: string, productId: number): Promise<ShelfItemRow> {
  const { data, error } = await supabase.from('shelf_items')
    .upsert({ user_id: userId, product_id: productId, notes: null }, { onConflict: 'user_id,product_id', ignoreDuplicates: true })
    .select('id,user_id,product_id,notes,created_at').maybeSingle();
  if (error) throw error;
  const item = data as ShelfItemRow | null || await getShelfItemForProduct(userId, productId);
  if (!item) throw new Error('The saved product could not be loaded. Please retry.');
  const oldCache = await getCachedShelfItems(userId).catch(() => null);
  const cache = oldCache || [];
  if (!cache.some((entry) => entry.id === item.id)) {
    await cacheShelfItems(userId, [{ id: item.id, productId: item.product_id, notes: item.notes, createdAt: item.created_at }, ...cache]);
  }
  return item;
}

export async function removeShelfItem(userId: string, shelfItemId: string) {
  const { error } = await supabase.from('shelf_items').delete().eq('id', shelfItemId).eq('user_id', userId);
  if (error) throw error;
  const cached = await getCachedShelfItems(userId).catch(() => null);
  if (cached) await cacheShelfItems(userId, cached.filter((item) => item.id !== shelfItemId));
}
