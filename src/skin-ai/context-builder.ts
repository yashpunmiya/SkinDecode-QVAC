import type { SkinAIContextAttachment, SkinAIMessage, SkinAIRequest } from './types';
import { SKIN_AI_SYSTEM_PROMPT } from './prompt.ts';
import { asksProductComparison } from './product-comparison.ts';

const MAX_QUESTION_CHARS = 800;
const HISTORY_MESSAGES = 4;
const MESSAGE_CHARS = 180;

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 24).map(compact);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 180) : value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .slice(0, 32)
    .map(([key, entry]) => [key, compact(entry)]));
}

function compactCatalogEvidence(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 5).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const cleanLong = (candidate: unknown, max: number) => typeof candidate === 'string' ? candidate.replace(/\s+/g, ' ').trim().slice(0, max) : undefined;
    return [{
      kind: cleanLong(item.kind, 48), title: cleanLong(item.title, 160),
      // Formula citations must retain the actual evidence body. The default
      // 180-character chat-context cap silently removed ingredients and made
      // the visible citation fail to support the model's claim.
      text: cleanLong(item.text, 3_200), source: cleanLong(item.source, 120),
      sourceUrl: cleanLong(item.sourceUrl, 300),
    }];
  });
}

function selectedFacts(item: SkinAIContextAttachment): Record<string, unknown> {
  const data = item.data || {};
  const text = (value: unknown, max = 100) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined;
  const list = (value: unknown, max = 8) => Array.isArray(value) ? value.slice(0, max).map((entry) => typeof entry === 'string' ? text(entry, 64) : entry).filter(Boolean) : undefined;
  const base: Record<string, unknown> = { summary: text(item.summary, 120) };

  if (item.type === 'skin-profile') {
    return { ...base, ageRange: text(data.ageRange, 16), skinType: text(data.skinType), sensitivity: text(data.sensitivity), concerns: list(data.concerns, 5), goals: list(data.goals, 5), preferences: list(data.preferences, 4) };
  }
  if (item.type === 'routine') {
    const steps = Array.isArray(data.steps) ? data.steps.slice(0, 8).map((step: any) => ({
      name: text(step?.name, 64), period: text(step?.period, 12), status: text(step?.todayStatus, 16), brand: text(step?.brand, 40),
      productId: Number.isSafeInteger(Number(step?.productId)) ? Number(step.productId) : undefined,
    })) : [];
    return { ...base, steps };
  }
  if (item.type === 'skin-check') {
    return { ...base, yesterday: compact(data.yesterday), today: compact(data.today), comparison: compact(data.comparison) };
  }
  if (item.type === 'shelf') {
    const products = Array.isArray(data.products) ? data.products.slice(0, 8).map((product: any) => ({
      productId: Number.isSafeInteger(Number(product?.productId)) ? Number(product.productId) : undefined,
      name: text(product?.name, 64), brand: text(product?.brand, 40), category: text(product?.category, 32),
    })) : [];
    return { ...base, products };
  }
  if (item.type === 'product-evidence' || item.type === 'product') {
    const analyses = Array.isArray(data.formulaAnalysis) ? data.formulaAnalysis.slice(0, 10).map((entry: any) => ({ label: text(entry?.label, 36), kind: text(entry?.kind, 16), state: text(entry?.state, 24), ingredients: list(entry?.ingredients, 4) })) : [];
    const match = data.skinMatch && typeof data.skinMatch === 'object' ? data.skinMatch as Record<string, unknown> : undefined;
    const signalEvidence = (value: unknown) => Array.isArray(value) ? value.slice(0, 3).map((entry: any) => ({
      label: text(entry?.label, 48), ingredients: list(entry?.ingredients, 4), dimension: text(entry?.dimension, 24),
    })).filter((entry: any) => entry.label) : undefined;
    return {
      ...base, productId: Number(item.sourceId) || undefined, name: text(data.name, 64), brand: text(data.brand, 40), category: text(data.category, 32),
      ingredients: list(data.ingredientNames, 18), formulaFindings: analyses,
      ...(match ? { skinMatch: {
        score: match.score, confidence: match.confidence, positives: list(match.positives, 3), concerns: list(match.concerns, 3),
        positiveEvidence: signalEvidence(match.positiveEvidence), cautionEvidence: signalEvidence(match.cautionEvidence),
      } } : {}),
      formulaAvailable: data.hasParsedFormula,
    };
  }
  return { ...base, ...(compact(data) as Record<string, unknown>) };
}

function cachedProductEvidence(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const product = value as Record<string, any>;
  return {
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    category: product.category,
    ingredients: Array.isArray(product.ingredients) ? product.ingredients.slice(0, 12).map((item: any) => typeof item === 'string' ? item : item?.name).filter(Boolean) : [],
    formulaFindings: Array.isArray(product.formulaFindings) ? product.formulaFindings.slice(0, 6).map((item: any) => ({
      label: item?.label, kind: item?.kind, ingredients: Array.isArray(item?.ingredients) ? item.ingredients.slice(0, 4) : [],
    })) : [],
    skinMatch: product.skinMatch,
    formulaAvailable: product.formulaAvailable === true,
  };
}

export function buildAIRequest(question: string, attachments: SkinAIContextAttachment[], messages: SkinAIMessage[], additionalContext: Record<string, unknown> = {}): SkinAIRequest {
  const unique = new Map<string, SkinAIContextAttachment>();
  for (const attachment of attachments) {
    if (attachment.selectedByUser !== true) continue;
    const key = `${attachment.type}:${String(attachment.sourceId ?? attachment.id)}`;
    if (!unique.has(key)) unique.set(key, attachment);
  }
  const context: Record<string, unknown> = {};
  const photoRefs: string[] = [];
  for (const item of unique.values()) {
    if (item.type === 'progress-photo') {
      // The URI is kept separate from the normal provider payload. Future providers can
      // resolve it only after an explicit photo attachment and user send action.
      if (item.localPhotoUri) photoRefs.push(item.localPhotoUri);
      context.photos = [...((context.photos as unknown[]) || []), { id: item.sourceId, label: item.label, explicitlySelected: true }];
      continue;
    }
    const key = item.type === 'product-evidence' ? 'product' : item.type;
    const value = selectedFacts(item);
    const existing = context[key];
    context[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  // User-selected context takes precedence over automatic local retrieval.
  for (const [key, value] of Object.entries(additionalContext)) {
    if (context[key] === undefined && value !== undefined && value !== null) {
      context[key] = key === 'catalogEvidence' ? compactCatalogEvidence(value) : compact(value);
    }
  }
  // Shelf/routine attachments identify the user's actual products. Enrich those
  // references from the account-scoped cache so comparison prompts receive the
  // same formula and Skin Match evidence as individually selected products.
  // Keep this focused to explicit comparison requests and at most four items.
  if (!context.product && asksProductComparison(question)) {
    const ids = new Set<number>();
    for (const item of unique.values()) {
      const data = item.data || {};
      const rows = item.type === 'shelf' && Array.isArray(data.products)
        ? data.products
        : item.type === 'routine' && Array.isArray(data.steps) ? data.steps : [];
      for (const row of rows) {
        const id = Number((row as Record<string, unknown>)?.productId);
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      }
    }
    const cached = Array.isArray(context['local-product-cache']) ? context['local-product-cache'] : [];
    const enriched = cached.map(cachedProductEvidence).filter((product): product is Record<string, unknown> => Boolean(product && ids.has(Number(product.productId)))).slice(0, 4);
    if (enriched.length >= 2) context.product = enriched;
  }
  return {
    systemPrompt: SKIN_AI_SYSTEM_PROMPT,
    question: question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS),
    context,
    // Keep only two recent turns; older turns consume the small local model window
    // and can carry forward a previous incorrect answer as if it were a fact.
    history: messages.slice(-HISTORY_MESSAGES).map(({ role, text }) => ({ role, content: text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_CHARS) })),
    ...(photoRefs.length ? { explicitlyAttachedPhotoRefs: [...new Set(photoRefs)] } : {}),
  };
}
