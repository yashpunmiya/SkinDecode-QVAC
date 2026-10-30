import type { SkinAIRequest } from './types';
import { renderRetrievedCatalogSources } from './evidence-format.ts';

type Match = {
  score?: number | null; confidence?: string; positives?: string[]; concerns?: string[];
  positiveEvidence?: Array<{ label?: string; ingredients?: string[]; dimension?: string }>;
  cautionEvidence?: Array<{ label?: string; ingredients?: string[]; dimension?: string }>;
};
type Product = {
  productId?: number; name?: string; brand?: string; ingredients?: string[]; formulaAvailable?: boolean;
  formulaFindings?: Array<{ label?: string; kind?: string; ingredients?: string[]; state?: string }>;
  skinMatch?: Match;
};
type Evidence = { kind?: string; title?: string; text?: string; source?: string; sourceUrl?: string };

const PRODUCT_ANALYSIS_PROMPT = `You are SkinDecode's on-device skincare analyst. Answer the user's question in your own words. Reason from the supplied product, skin profile, and SkinDecode match signals; do not copy the evidence notes or produce a database dump. Explain which supplied formula signals matter to this person and why, balance the caution against the strongest relevant positive, then state what cannot be concluded about their personal tolerance. Use the exact product, ingredients, score, and confidence supplied; cite product facts with [E1]. Never invent ingredients, ratings, symptoms, sources, photos, or previous replies. Be direct and useful in 2–4 concise sentences. If the evidence does not identify a harmful ingredient, say that clearly instead of naming generic irritants.`;

const obj = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const str = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(str).filter(Boolean))] : [];
const norm = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dimensionLabel: Record<string, string> = { skin_type: 'skin type', concerns: 'recorded concerns', goals: 'goals', sensitivity: 'sensitivity', preferences: 'preferences' };
function scoreDescription(score: number) {
  if (score >= 80) return 'high match';
  if (score >= 65) return 'good match';
  if (score >= 45) return 'mixed match';
  return 'low match';
}

/** Grounded, app-calculated answer for personal product suitability. Small local models
 * repeatedly fabricate ingredients and leak prompt templates on this exact task. */
export function buildProductSuitabilityAnswer(request: SkinAIRequest): string | null {
  if (!/\b(suit|suitable|won.t suit|not suit|irritat|my skin|for me|acne|sensitive|sensitivity)\b/i.test(request.question)) return null;
  const raw = request.context.product;
  const products = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(obj).filter((item): item is Record<string, any> => Boolean(item));
  if (products.length !== 1) return null;
  const product = products[0] as Product & Record<string, any>;
  if (!product.name) return null;

  const profile = obj(request.context['skin-profile']);
  const cacheRows = Array.isArray(request.context['local-product-cache']) ? request.context['local-product-cache'].map(obj).filter(Boolean) as Record<string, any>[] : [];
  const cached = cacheRows.find((item) => Number(item.productId) === Number(product.productId) || norm(str(item.name)) === norm(str(product.name)));
  const selectedMatch = product.skinMatch || {};
  const cachedMatch = obj(cached?.skinMatch) as Match | null;
  const match: Match = {
    ...selectedMatch, ...(cachedMatch || {}),
    score: cachedMatch?.score ?? selectedMatch.score, confidence: cachedMatch?.confidence ?? selectedMatch.confidence,
    positiveEvidence: cachedMatch?.positiveEvidence?.length ? cachedMatch.positiveEvidence : selectedMatch.positiveEvidence,
    cautionEvidence: cachedMatch?.cautionEvidence?.length ? cachedMatch.cautionEvidence : selectedMatch.cautionEvidence,
  };
  const exactIngredients = list(product.ingredients).length ? list(product.ingredients) : (Array.isArray(cached?.ingredients) ? cached.ingredients.map((item: any) => str(item?.name)).filter(Boolean) : []);
  const evidenceSignals = (value: unknown) => Array.isArray(value) ? value.map(obj).filter(Boolean).map((item) => ({
    // These names come from SkinDecode's formula/profile scorer, which evaluates
    // the complete formula. Do not filter against the user attachment's display
    // list: that UI deliberately truncates ingredient names for compact storage.
    label: str(item?.label), ingredients: list(item?.ingredients), dimension: str(item?.dimension),
  })).filter((item) => item.label) : [];
  const cautionSignals = evidenceSignals(match.cautionEvidence);
  const positiveSignals = evidenceSignals(match.positiveEvidence);
  const concerns = list(match.concerns);
  const positives = list(match.positives);
  const score = typeof match.score === 'number' && Number.isFinite(match.score) ? match.score : null;
  const confidence = str(match.confidence);
  const evidence = Array.isArray(request.context.catalogEvidence) ? request.context.catalogEvidence.map(obj).filter(Boolean) as Evidence[] : [];
  const matchedEvidence = evidence.find((item) => norm(str(item.title)).includes(norm(str(product.name)))
    && (!str(product.brand) || norm(str(item.title)).includes(norm(str(product.brand)))))
    || evidence.find((item) => norm(str(item.title)).includes(norm(str(product.name))));
  const evidenceIndex = matchedEvidence ? evidence.indexOf(matchedEvidence) + 1 : 0;
  const citation = evidenceIndex ? ` [E${evidenceIndex}]` : '';
  const identity = `${str(product.name)}${str(product.brand) ? ` (${str(product.brand)})` : ''}`;
  const skinType = str(profile?.skinType).replaceAll('_', ' ');
  const sensitivity = str(profile?.sensitivity).replaceAll('_', ' ');
  const profileDetails = skinType
    ? `${skinType} skin${sensitivity && sensitivity !== 'not sure' ? ` with ${sensitivity} sensitivity` : ''}`
    : '';
  const opening = score === null
    ? `SkinDecode match: I can’t identify a specific ingredient as unsuitable in ${identity} because there is no usable profile-match score for this formula${confidence && confidence !== 'none' ? ` (${confidence} confidence)` : ''}.`
    : `SkinDecode match: ${identity} scores ${score}/100 (${scoreDescription(score)}${confidence ? `, ${confidence} confidence` : ''})${profileDetails ? ` for your ${profileDetails}` : ''}.`;

  const lines = [opening];
  if (cautionSignals.length) {
    const grouped = new Map<string, { labels: string[]; ingredients: string[]; dimensions: string[] }>();
    for (const signal of cautionSignals) {
      const key = signal.ingredients.length ? signal.ingredients.map(norm).sort().join('|') : norm(signal.label);
      const group = grouped.get(key) || { labels: [], ingredients: signal.ingredients, dimensions: [] };
      if (!group.labels.some((label) => norm(label) === norm(signal.label))) group.labels.push(signal.label);
      if (signal.dimension && !group.dimensions.includes(signal.dimension)) group.dimensions.push(signal.dimension);
      grouped.set(key, group);
    }
    const details = [...grouped.values()].slice(0, 3).map((group) => {
      const dimensions = group.dimensions.map((item) => dimensionLabel[item] || item);
      return `${group.labels.join(' / ')}${group.ingredients.length ? ` (${group.ingredients.slice(0, 3).join(', ')}${dimensions.length ? `; ${dimensions.join(' and ')}` : ''})` : ''}`;
    });
    lines.push(`Why it was flagged: the app’s profile matcher links ${details.join('; ')} to your recorded profile.${citation}`);
  } else if (concerns.length) {
    lines.push(`Why it was flagged: the app records these profile-match cautions: ${concerns.slice(0, 3).join('; ')}. The saved attachment does not preserve which exact ingredients generated each signal.${citation}`);
  } else if (score !== null) {
    lines.push(`Why it was flagged: the app found no specific profile-linked caution among the supplied formula signals${citation ? `.${citation}` : '.'}`);
  }
  const formulaFindings = (Array.isArray(cached?.formulaFindings) ? cached.formulaFindings : product.formulaFindings || [])
    .map(obj).filter(Boolean)
    .filter((item) => item?.kind === 'benefit' && (!item.state || /resolved/i.test(str(item.state))))
    .slice(0, 3).map((item) => `${str(item?.label)}${list(item?.ingredients).length ? ` (${list(item?.ingredients).slice(0, 3).join(', ')})` : ''}`).filter(Boolean);
  if (positiveSignals.length || positives.length) {
    const grouped = new Map<string, { labels: string[]; ingredients: string[] }>();
    for (const signal of positiveSignals) {
      const key = signal.ingredients.length ? signal.ingredients.map(norm).sort().join('|') : norm(signal.label);
      const group = grouped.get(key) || { labels: [], ingredients: signal.ingredients };
      if (!group.labels.some((label) => norm(label) === norm(signal.label))) group.labels.push(signal.label);
      grouped.set(key, group);
    }
    const details = [...grouped.values()].slice(0, 2).map((group) => `${group.labels.join(' / ')}${group.ingredients.length ? ` (${group.ingredients.slice(0, 3).join(', ')})` : ''}`);
    lines.push(`What balances this: the profile match also records ${(details.length ? details : positives.slice(0, 2)).join('; ')}.${citation}`);
  } else if (formulaFindings.length) {
    lines.push(`What balances this: the formula record notes ${formulaFindings.join('; ')} as catalog benefits; those are recorded signals, not promised results.${citation}`);
  }
  lines.push('Limit: these catalog/profile matches do not prove an ingredient will irritate you or that the product will work. The app cannot predict personal tolerance.');
  if ((!product.formulaAvailable && !cached?.formulaAvailable) || !exactIngredients.length) {
    lines.push('The complete parsed ingredient list is unavailable here, so I can’t name a specific ingredient to avoid.');
  }
  const answer = lines.join('\n\n');
  const sources = renderRetrievedCatalogSources(evidence);
  return answer + sources;
}

/** Build a short, isolated QVAC prompt from the selected product and real scorer output.
 * Older assistant turns and unrelated personal records are deliberately excluded. */
export function buildProductSuitabilityModelRequest(request: SkinAIRequest): SkinAIRequest | null {
  if (!/\b(suit|suitable|won.t suit|not suit|harmful|safe|unsafe|avoid|irritat|my skin|for me|acne|sensitive|sensitivity|reaction|risk)\b/i.test(request.question)) return null;
  const raw = request.context.product;
  const products = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(obj).filter((item): item is Record<string, any> => Boolean(item));
  if (products.length !== 1) return null;
  const product = products[0]!;
  if (!str(product.name)) return null;
  const cacheRows = Array.isArray(request.context['local-product-cache']) ? request.context['local-product-cache'].map(obj).filter(Boolean) as Record<string, any>[] : [];
  const cached = cacheRows.find((item) => Number(item.productId) === Number(product.productId) || norm(str(item.name)) === norm(str(product.name)));
  const selectedMatch = obj(product.skinMatch) || {};
  const cachedMatch = obj(cached?.skinMatch) || {};
  const match = {
    score: cachedMatch.score ?? selectedMatch.score,
    confidence: cachedMatch.confidence ?? selectedMatch.confidence,
    positives: cachedMatch.positives ?? selectedMatch.positives,
    concerns: cachedMatch.concerns ?? selectedMatch.concerns,
    positiveEvidence: cachedMatch.positiveEvidence ?? selectedMatch.positiveEvidence,
    cautionEvidence: cachedMatch.cautionEvidence ?? selectedMatch.cautionEvidence,
  };
  const evidenceRows = Array.isArray(request.context.catalogEvidence) ? request.context.catalogEvidence.map(obj).filter(Boolean) as Evidence[] : [];
  const evidence = evidenceRows.filter((item) => norm(str(item.title)).includes(norm(str(product.name))));
  if (!evidence.length && !Array.isArray(product.ingredients)) return null;
  const profile = obj(request.context['skin-profile']);
  const signals = (value: unknown) => Array.isArray(value) ? value.map(obj).filter(Boolean).map((item) => ({
    label: str(item?.label), ingredients: list(item?.ingredients).slice(0, 3), dimension: str(item?.dimension),
  })).filter((item) => item.label).slice(0, 3) : [];
  const cautions = signals(match.cautionEvidence);
  const benefits = signals(match.positiveEvidence);
  const relevantIngredients = [...new Set([...cautions, ...benefits].flatMap((item) => item.ingredients))].slice(0, 10);
  const source = evidence[0];
  const compactEvidence = source ? [{
    kind: source.kind || 'product_formula', title: source.title,
    text: [
      `Selected product formula/profile evidence for ${str(product.name)} by ${str(product.brand)}.`,
      `App-calculated profile cautions: ${cautions.map((item) => `${item.label}${item.ingredients.length ? ` (${item.ingredients.join(', ')})` : ''}${item.dimension ? `; profile dimension ${item.dimension}` : ''}`).join('; ') || 'none recorded'}.`,
      `App-calculated positive profile signals: ${benefits.map((item) => `${item.label}${item.ingredients.length ? ` (${item.ingredients.join(', ')})` : ''}`).join('; ') || 'none recorded'}.`,
      `Relevant ingredients are listed in this product’s parsed formula: ${relevantIngredients.join(', ') || list(product.ingredients).slice(0, 10).join(', ')}.`,
    ].join(' '),
    source: source.source, ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
  }] : [];
  const productFacts = {
    productId: product.productId, name: str(product.name), brand: str(product.brand), category: str(product.category),
    formulaAvailable: Boolean(product.formulaAvailable ?? cached?.formulaAvailable),
    ingredients: relevantIngredients,
    skinMatch: { score: match.score, confidence: match.confidence, positives: benefits.map((item) => item.label), concerns: cautions.map((item) => item.label) },
  };
  const context: Record<string, unknown> = {
    product: productFacts,
    ...(profile ? { 'skin-profile': {
      skinType: str(profile.skinType), sensitivity: str(profile.sensitivity),
    } } : {}),
    ...(compactEvidence.length ? { catalogEvidence: compactEvidence } : {}),
    focusedProductAnalysis: true,
  };
  return { ...request, systemPrompt: PRODUCT_ANALYSIS_PROMPT, context, history: [] };
}

/** Return a non-sensitive rejection reason for recognized small-model failures. */
export function productSuitabilityResponseRejectionReason(text: string, request: SkinAIRequest): string | null {
  const value = text.trim();
  if (value.length < 24 || value.length > 1_800) return 'length';
  if (/\b(previous response|attached json|the user'?s own statements|I can'?t inspect your photo|I don'?t have access to your personal|\[ingredient\s*\d|7[- ]day|30[- ]day|skin ratings?|check-ins?|source\s*\d)\b/i.test(value)) return 'prompt leakage or unrelated records';
  const rawProduct = request.context.product;
  const product = (Array.isArray(rawProduct) ? rawProduct : rawProduct ? [rawProduct] : []).map(obj).find(Boolean);
  if (!product) return 'missing selected product';
  const evidence = Array.isArray(request.context.catalogEvidence) ? request.context.catalogEvidence.map(obj).filter(Boolean) : [];
  const sourceText = evidence.map((item) => str(item?.text)).join(' ').toLocaleLowerCase();
  const hallucinatedIngredients: Array<[RegExp, RegExp]> = [
    [/\bsodium lauryl sulfate\b/i, /\bsodium lauryl sulfate\b/i],
    [/\bsodium laureth sulfate\b/i, /\bsodium laureth sulfate\b/i],
    [/\bmethylparaben\b/i, /\bmethylparaben\b/i],
    [/\bpropylparaben\b/i, /\bpropylparaben\b/i],
    [/\bphthalates?\b|\bdibutyl phthalate\b|\bdiethyl phthalate\b/i, /\bphthalates?\b|\bdibutyl phthalate\b|\bdiethyl phthalate\b/i],
    [/\btriclosan\b/i, /\btriclosan\b/i],
    [/\bdmdm hydantoin\b|\bformaldehyde-releasing agents?\b/i, /\bdmdm hydantoin\b|\bformaldehyde-releasing agents?\b/i],
  ];
  if (hallucinatedIngredients.some(([outputPattern, evidencePattern]) => outputPattern.test(value) && !evidencePattern.test(sourceText))) return 'ingredient absent from selected formula';
  const validIds = new Set(evidence.map((_, index) => `E${index + 1}`));
  const citedIds = [...value.matchAll(/\[E(\d+)\]/g)].map((match) => `E${match[1]}`);
  if (citedIds.some((id) => !validIds.has(id))) return 'invalid citation id';
  return null;
}

/** Reject recognizable small-model failures before they reach the chat transcript. */
export function isGroundedProductSuitabilityResponse(text: string, request: SkinAIRequest): boolean {
  return productSuitabilityResponseRejectionReason(text, request) === null;
}
