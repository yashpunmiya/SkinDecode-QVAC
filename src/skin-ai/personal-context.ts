import { loadDailySkinCheckHistory } from '../daily-skin-check/storage';
import { getCachedProductsByIds, getCachedProductDetailsByIds, getCachedShelfItems, getCachedSkinProfile, searchCachedCatalogEvidence } from '../products/product-cache';
import { getRoutineSnapshotForRange } from '../routine/routine-database';
import { localDateKey } from '../routine/models';
import { loadWaterHistory } from '../water/water-tracker';
import { getProductDetail, getSkinProfile } from '../products/catalog-service';
import { scoreProductMatch } from '../products/product-intelligence';
import { getCachedSkinAIContext } from './storage';
import { buildInvestigatorFacts } from './investigator';
import type { SkinAIContextAttachment } from './types';
import type { ProductDetail, ProductSummary, SkinProfile } from '../products/types';

function profileFromCachedContext(value: unknown): SkinProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const profile = data as Record<string, unknown>;
  return {
    ageRange: typeof profile.ageRange === 'string' ? profile.ageRange as SkinProfile['ageRange'] : null,
    skinType: typeof profile.skinType === 'string' ? profile.skinType as SkinProfile['skinType'] : null,
    sensitivity: typeof profile.sensitivity === 'string' ? profile.sensitivity as SkinProfile['sensitivity'] : null,
    concerns: Array.isArray(profile.concerns) ? profile.concerns.filter((item): item is SkinProfile['concerns'][number] => typeof item === 'string') : [],
    goals: Array.isArray(profile.goals) ? profile.goals.filter((item): item is SkinProfile['goals'][number] => typeof item === 'string') : [],
    preferences: Array.isArray(profile.preferences) ? profile.preferences.filter((item): item is SkinProfile['preferences'][number] => typeof item === 'string') : [],
  };
}

function wantsPersonalSkin(question: string) {
  return /\b(my|me|mine|i|today|yesterday|recent|last week|last month|trend|routine|shelf|skin|redness|irritation|dryness|breakout|acne|oiliness|product|ingredient)\b/i.test(question);
}

function wantsWater(question: string) {
  return /\b(water|glasses|drinking|drink|intake)\b/i.test(question);
}

function wantsCatalog(question: string) {
  return /\b(product|ingredient|ingredients|formula|face ?wash|cleanser|moisturizer|serum|sunscreen|spf|niacinamide|retinol|retinoid|ceramide|salicylic|glycolic|azelaic|hyaluronic|fragrance)\b/i.test(question) || /^\s*(what is|what does|explain)\b/i.test(question);
}

function wantsRoutine(question: string) {
	// A generic product/ingredient question should not silently pull in the active
	// routine. That unrelated context dilutes small on-device models and can make
	// their citations appear to refer to the wrong product.
	return /\b(routine|used|using|use|skipped|skip|completed|consistent|overlap|tonight|morning|evening|shelf)\b/i.test(question);
}

function wantsSkinChecks(question: string) {
  return /\b(skin|redness|irritation|irritated|dry|dryness|acne|breakout|oiliness|rating|check|trend|worse|better|journey)\b/i.test(question) || /yesterday.*today|today.*yesterday/i.test(question);
}

const selectedFormulaFreshness = new Map<number, { product: ProductDetail | null; loadedAt: number }>();
const SELECTED_FORMULA_TTL_MS = 5 * 60 * 1000;
async function getFreshSelectedFormula(productId: number): Promise<ProductDetail | null> {
  const recent = selectedFormulaFreshness.get(productId);
  if (recent && Date.now() - recent.loadedAt < SELECTED_FORMULA_TTL_MS) return recent.product;
  const product = await getProductDetail(productId).then(result => result.product).catch(() => null);
  if (product) selectedFormulaFreshness.set(productId, { product, loadedAt: Date.now() });
  return product;
}

/** Gathers only local SQLite/cache data. It never calls Supabase or a network API. */
export async function loadPersonalSkinContext(
  userId: string,
  question: string,
  selectedAttachments: SkinAIContextAttachment[] = [],
  now = new Date(),
): Promise<Record<string, unknown>> {
  const hasSelectedPersonalContext = selectedAttachments.some((item) => ['skin-profile', 'routine', 'skin-check', 'shelf', 'product', 'product-evidence'].includes(item.type));
  const comparisonQuestion = /\b(compare|comparison|versus|vs\.?|which one|which should|choose between|difference)\b/i.test(question);
  const needsCatalog = wantsCatalog(question) || (comparisonQuestion && hasSelectedPersonalContext);
  const personal = wantsPersonalSkin(question) || hasSelectedPersonalContext;
  if (!personal && !needsCatalog) return {};
  if (!personal) {
    const evidence = await searchCachedCatalogEvidence(question, 5).catch(() => []);
    return evidence.length
      ? { catalogEvidence: evidence.map(({ kind, title, text, source, sourceUrl }) => ({ kind, title, text, source, ...(sourceUrl ? { sourceUrl } : {}) })) }
      : { dataLimitations: ['No matching product or ingredient detail is cached locally. Product-specific claims cannot be verified offline.'] };
  }
  const needsChecks = wantsSkinChecks(question);
  const hasRoutineOrShelfContext = selectedAttachments.some((item) => item.type === 'routine' || item.type === 'shelf');
  const needsRoutine = wantsRoutine(question) || hasRoutineOrShelfContext || (needsChecks && /\b(irrit|redness|dryness|acne|breakout|oiliness)\b/i.test(question));
  const needsWater = wantsWater(question);
  const today = localDateKey(now);
  const fromDate = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  const [cachedProfile, legacyProfile, routine, checks, water, shelf] = await Promise.all([
    getCachedSkinProfile(userId).catch(() => null),
    getCachedSkinAIContext(userId, `skin-profile:${userId}`, Number.MAX_SAFE_INTEGER).catch(() => null),
    needsRoutine ? getRoutineSnapshotForRange(userId, fromDate, today).catch(() => null) : Promise.resolve(null),
    needsChecks ? loadDailySkinCheckHistory(userId, now).catch(() => []) : Promise.resolve([]),
    needsWater ? loadWaterHistory(userId, fromDate, today).catch(() => []) : Promise.resolve([]),
    needsRoutine ? getCachedShelfItems(userId).catch(() => null) : Promise.resolve(null),
  ]);
  const cachedProfileData = cachedProfile?.onboarding_completed
    ? {
      ageRange: cachedProfile.age_range, skinType: cachedProfile.skin_type, sensitivity: cachedProfile.sensitivity,
      concerns: cachedProfile.skin_concerns || [], goals: cachedProfile.skin_goals || [], preferences: cachedProfile.preferences || [],
    }
    : profileFromCachedContext(legacyProfile);
  // Prefer the account-scoped SQLite profile already loaded above. A routine
  // chat turn must not wait on Supabase when valid local personalization exists.
  // Refresh remotely only on a genuine local cache miss.
  const freshProfile = personal && !cachedProfileData ? await getSkinProfile(userId).catch(() => null) : null;
  const profile = freshProfile?.onboarding_completed ? {
    ageRange: freshProfile.age_range, skinType: freshProfile.skin_type, sensitivity: freshProfile.sensitivity,
    concerns: freshProfile.skin_concerns || [], goals: freshProfile.skin_goals || [], preferences: freshProfile.preferences || [],
  } as SkinProfile : cachedProfileData as SkinProfile | undefined;
  const context: Record<string, unknown> = {};

  if (profile) context['skin-profile'] = profile;
  const cachedShelfByItemId = new Map((shelf || []).map((item) => [item.id, item.productId]));
  const routineStepProductId = (step: unknown): number | null => {
    if (!step || typeof step !== 'object') return null;
    const value = step as Record<string, unknown>;
    const directId = Number(value.productId);
    if (Number.isSafeInteger(directId) && directId > 0) return directId;
    const linkedId = typeof value.shelfItemId === 'string' ? cachedShelfByItemId.get(value.shelfItemId) : undefined;
    return linkedId && Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : null;
  };
  const inventoryIds = new Set<number>();
  for (const item of selectedAttachments) {
    if ((item.type === 'product' || item.type === 'product-evidence') && Number.isSafeInteger(Number(item.sourceId))) inventoryIds.add(Number(item.sourceId));
    if (item.type === 'shelf' && Array.isArray(item.data?.products)) {
      for (const product of item.data.products.slice(0, 4)) {
        const id = Number((product as Record<string, unknown>)?.productId);
        if (Number.isSafeInteger(id) && id > 0) inventoryIds.add(id);
      }
    }
    if (item.type === 'routine' && Array.isArray(item.data?.steps)) {
      for (const step of item.data.steps.slice(0, 8)) {
        const id = routineStepProductId(step);
        if (id) inventoryIds.add(id);
      }
    }
  }
  if (routine && needsRoutine) {
    for (const step of routine.steps) {
      const id = routineStepProductId(step);
      if (id) inventoryIds.add(id);
    }
  }
  if (shelf && /\b(shelf|products|ingredients|routine|used|using|overlap|irrit|redness|dryness)\b/i.test(question)) {
    for (const item of shelf.slice(0, 16)) inventoryIds.add(item.productId);
  }
  const selectedProductIds = [...new Set(selectedAttachments
    .filter((item) => (item.type === 'product' || item.type === 'product-evidence') && Number.isSafeInteger(Number(item.sourceId)) && Number(item.sourceId) > 0)
    .map((item) => Number(item.sourceId)))].slice(0, 3);
  const attachedShelfIds = [...new Set(selectedAttachments
    .filter((item) => item.type === 'shelf' && Array.isArray(item.data?.products))
    .flatMap((item) => (item.data!.products as unknown[]).slice(0, 8).map((value: unknown) => Number((value as Record<string, unknown>)?.productId)))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  const attachedRoutineIds = [...new Set(selectedAttachments
    .filter((item) => item.type === 'routine' && Array.isArray(item.data?.steps))
    .flatMap((item) => (item.data!.steps as unknown[]).slice(0, 8).map(routineStepProductId))
    .filter((id): id is number => id !== null))];
  // A combined shelf/routine comparison should sample both sources fairly;
  // otherwise attachment order could fill the four-product evidence budget
  // with shelf items before any routine formula is considered.
  const attachedEvidenceIds = comparisonQuestion && attachedShelfIds.length && attachedRoutineIds.length
    ? [...attachedRoutineIds.slice(0, 2), ...attachedShelfIds.slice(0, 2)]
    : attachedRoutineIds.length ? attachedRoutineIds : attachedShelfIds;
  const productIds = [...new Set([...selectedProductIds, ...attachedEvidenceIds, ...inventoryIds])].slice(0, 4);
  const [cachedDetails, summaries] = await Promise.all([
    getCachedProductDetailsByIds(productIds).catch(() => new Map<number, ProductDetail>()),
    getCachedProductsByIds(productIds).catch(() => new Map<number, ProductSummary>()),
  ]);
  // Refresh missing details for explicitly attached products and routine/shelf
  // products whose shelf-item links resolved locally. Cached evidence stays
  // usable offline; network is only attempted to fill a cache miss.
  const refreshSelectedIds = [...new Set([...selectedProductIds, ...attachedEvidenceIds])].filter((id) => {
    const recent = selectedFormulaFreshness.get(id);
    return !cachedDetails.has(id) && (!recent || Date.now() - recent.loadedAt >= SELECTED_FORMULA_TTL_MS);
  });
  const refreshed = await Promise.all(refreshSelectedIds.map(async (id) => [id, await getFreshSelectedFormula(id)] as const));
  const details = new Map(cachedDetails);
  for (const [id, product] of refreshed) if (product) details.set(id, product);
  if (productIds.length) {
    const localProductCache = productIds.flatMap((id) => {
      const product = details.get(id);
      const summary = summaries.get(id);
      if (!product && !summary) return [];
      const match = product && profile ? scoreProductMatch(product, profile) : null;
      return [{
        productId: id, name: product?.name || summary?.name, brand: product?.brand || summary?.brand,
        category: product?.category || summary?.category,
        ...(match ? { skinMatch: {
          score: match.score, confidence: match.confidence,
          positives: match.strongestPositives.slice(0, 4).map(item => item.label),
          concerns: match.strongestConcerns.slice(0, 4).map(item => item.label),
          positiveEvidence: match.strongestPositives.slice(0, 4).map(item => ({ label: item.label, ingredients: item.ingredientNames.slice(0, 4), dimension: item.dimension })),
          cautionEvidence: match.strongestConcerns.slice(0, 4).map(item => ({ label: item.label, ingredients: item.ingredientNames.slice(0, 4), dimension: item.dimension })),
        } } : {}),
        formulaAvailable: product?.hasParsedFormula || false,
        formulaFindings: product?.formulas[0]?.analysis.filter((item) => item.resolved).slice(0, 8).map((item) => ({ label: item.label, kind: item.kind, ingredients: item.responsibleIngredients.slice(0, 4).map((ingredient) => ingredient.inciName || ingredient.name) })) || [],
        ingredients: product?.formulas[0]?.ingredients.slice(0, 24).map((ingredient) => ({ name: ingredient.inciName || ingredient.name, functions: ingredient.functions, attributes: ingredient.attributes.slice(0, 6).map((attribute) => ({ label: attribute.label, kind: attribute.kind })) })) || [],
      }];
    });
    context['local-product-cache'] = localProductCache;
    // Put the resolved attached routine/shelf products into the same structured
    // product slot used by individually attached products. Without this, routine
    // steps linked by shelfItemId could load details locally but leave the model
    // without comparable product records.
    if (comparisonQuestion && hasRoutineOrShelfContext && !selectedProductIds.length) {
      const attachedIds = new Set(attachedEvidenceIds);
      context.product = localProductCache
        .filter((item) => attachedIds.has(Number(item.productId)))
        .slice(0, 4)
        .map(({ productId, name, brand, category, formulaAvailable, formulaFindings, ingredients, skinMatch }) => ({
          productId, name, brand, category, formulaAvailable, formulaFindings, ingredients, skinMatch,
        }));
    }
  }

  const facts = buildInvestigatorFacts({
    checks, water, routine: routine || { routines: [], steps: [], logs: [] },
    products: [...details.values()], profile, question, now,
  });
  if (freshProfile) facts.unshift('Skin profile source: the signed-in user_profiles record retrieved through the existing app cache-aware service (no other user profile is queried).');
  if (refreshed.some(([, product]) => product)) facts.push('Selected-product formula source: catalog detail filled a missing local cache entry for an attached routine, shelf, or product item; formula findings and ingredients below come from that record.');
  context.personalFacts = facts;

  // Explicit product evidence is the narrowest user intent. A selected shelf is
  // next; attached routine products are included for a direct routine comparison.
  const preferredEvidenceIds = selectedProductIds.length ? selectedProductIds : attachedEvidenceIds.slice(0, 4);
  const hasExplicitProductSelection = preferredEvidenceIds.length > 0;
  const evidenceProducts = preferredEvidenceIds.length
    ? preferredEvidenceIds.map((id) => details.get(id)).filter((item): item is ProductDetail => Boolean(item))
    : [...details.values()];
  const formulaEvidence = evidenceProducts.flatMap((product) => {
    const formula = product.formulas[0];
    if (!formula) return [];
    const ingredients = formula.ingredients.slice(0, 80).map((item) => `${item.inciName || item.name}${item.functions.length ? ` — functions recorded: ${item.functions.join(', ')}` : ''}`);
    const findings = formula.analysis.filter((item) => item.resolved).slice(0, 16).map((item) => `${item.kind}: ${item.label}${item.responsibleIngredients.length ? ` (${item.responsibleIngredients.slice(0, 6).map((ingredient) => ingredient.inciName || ingredient.name).join(', ')})` : ''}`);
    return [{ kind: 'product_formula', title: `${product.name} · ${product.brand}`, text: `Exact cached formula ingredients: ${ingredients.join('; ') || 'none listed'}. Resolved catalog findings: ${findings.join('; ') || 'none recorded'}.`, source: 'SkinDecode product/formula database' }];
  });
  if (comparisonQuestion && hasRoutineOrShelfContext && evidenceProducts.filter((product) => product.formulas[0]?.ingredients.length).length < 2) {
    context.dataLimitations = [...((context.dataLimitations as string[]) || []), 'Fewer than two attached routine/shelf products have parsed formula details available locally or from the catalog. An ingredient-level comparison is not supported yet.'];
  }
  if (formulaEvidence.length && needsCatalog) context.catalogEvidence = formulaEvidence;
  else if (needsCatalog && hasExplicitProductSelection) {
    context.dataLimitations = ['The selected product’s exact formula is not available locally, so its ingredients cannot be verified. Other products’ catalog records are intentionally excluded from this answer.'];
  }
  else if ((needsCatalog && /\b(niacinamide|retinol|retinoid|ceramide|salicylic|glycolic|azelaic|hyaluronic|fragrance|centella|green tea|peptide|benzoyl peroxide|lactic acid)\b/i.test(question)) || /\b(overlap)\b/i.test(question)) {
    const evidence = await searchCachedCatalogEvidence(question, 5).catch(() => []);
    if (evidence.length) context.catalogEvidence = evidence.map(({ kind, title, text, source, sourceUrl }) => ({ kind, title, text, source, ...(sourceUrl ? { sourceUrl } : {}) }));
    else if (needsCatalog) context.dataLimitations = ['No matching product formula or ingredient record is available in the signed-in account’s local cache. Attach a specific product or ingredient name to get a grounded analysis.'];
  }
  if (selectedAttachments.some((item) => item.type === 'progress-photo')) {
    context.photoAnalysisStatus = 'Photos can be selected and compared manually in SkinDecode. The currently configured QVAC text model cannot inspect image pixels; no AI visual observations were made.';
  }
  if (!cachedProfileData && /\b(my|my skin|personal|for me)\b/i.test(question)) context.dataLimitations = ['No locally cached skin profile is available. Skin-profile personalization may require opening the app online to refresh the profile.'];
  if (needsRoutine && !routine) context.dataLimitations = [...((context.dataLimitations as string[]) || []), 'Routine database could not be read locally for this question.'];
  if (needsWater && !water.length) context.dataLimitations = [...((context.dataLimitations as string[]) || []), 'No water-intake records were found in the local date range; this is not the same as zero intake.'];
  return context;
}
