import type { SkinAIRequest } from './types';

type ProductEvidence = {
  productId?: number;
  name?: string;
  brand?: string;
  category?: string;
  ingredients?: string[];
  formulaAvailable?: boolean;
  formulaFindings?: Array<{ label?: string; kind?: string; ingredients?: string[] }>;
  skinMatch?: { score?: number | null; confidence?: string; positives?: string[]; concerns?: string[] };
};

function object(value: unknown): ProductEvidence | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ProductEvidence : null;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function productSummary(product: ProductEvidence) {
  const name = clean(product.name) || 'Selected product';
  const brand = clean(product.brand);
  const identity = brand ? `${name} (${brand})` : name;
  const findings = product.formulaFindings || [];
  const findingText = (item: NonNullable<ProductEvidence['formulaFindings']>[number]) => {
    const name = clean(item.label);
    const ingredients = unique(item.ingredients || []).slice(0, 3);
    return `${name || 'Formula signal'}${ingredients.length ? ` (${ingredients.join(', ')})` : ''}`;
  };
  const benefits = unique(findings.filter((item) => item.kind === 'benefit').map(findingText)).slice(0, 2);
  const cautions = unique(findings.filter((item) => item.kind === 'concern').map(findingText)).slice(0, 2);
  const match = product.skinMatch;
  const matchSignals = match ? [
    ...(match.positives || []).slice(0, 2).map((item) => `match signal: ${clean(item)}`),
    ...(match.concerns || []).slice(0, 2).map((item) => `caution signal: ${clean(item)}`),
  ] : [];
  const evidence = [
    benefits.length ? `app formula signals: ${benefits.join(', ')}` : '',
    cautions.length ? `app formula cautions: ${cautions.join(', ')}` : '',
    ...matchSignals,
    !benefits.length && !cautions.length && (product.ingredients || []).length ? `listed ingredients: ${unique(product.ingredients || []).slice(0, 6).join(', ')}` : '',
  ].filter(Boolean);
  if (!product.formulaAvailable && !findings.length) evidence.push('the catalog has no parsed formula for this product');
  return { identity, evidence };
}

/** Deterministic path: never ask the language model to rank or invent product facts. */
export function buildProductComparison(request: SkinAIRequest): string | null {
  if (!/\b(compare|comparison|versus|vs\.?|better|which one|which should|choose between|difference)\b/i.test(request.question)) return null;
  const rawProducts = request.context.product;
  const products = (Array.isArray(rawProducts) ? rawProducts : rawProducts ? [rawProducts] : [])
    .map(object).filter((item): item is ProductEvidence => Boolean(item)).slice(0, 4);
  if (products.length < 2) return null;

  const summaries = products.map(productSummary);
  const lines = summaries.map(({ identity, evidence }) => `• ${identity}${evidence.length ? ` — ${evidence.join('; ')}.` : ' — no app formula signals were supplied.'}`);
  const matches = products.map((product) => product.skinMatch);
  const allScored = matches.every((match) => typeof match?.score === 'number' && Number.isFinite(match.score));
  let conclusion: string;
  if (allScored) {
    const ranked = products.map((product, index) => ({ product, index, score: matches[index]!.score as number })).sort((a, b) => b.score - a.score);
    const [best, next] = ranked;
    if (best && next && best.score - next.score >= 3) {
      conclusion = `App Skin Match: ${clean(best.product.name) || 'The first product'} scores ${best.score}/100 versus ${next.score}/100 for ${clean(next.product.name) || 'the other product'}. This is the app's formula/profile signal, not a guarantee of tolerance or results.`;
    } else {
      conclusion = `App Skin Match scores are close (${ranked.map((item) => `${clean(item.product.name) || 'Product'} ${item.score}/100`).join('; ')}), so the app data does not show a clear winner.`;
    }
  } else {
    conclusion = request.context['skin-profile']
      ? 'The catalog does not have enough parsed formula evidence to calculate a Skin Match for every product. I can compare the listed signals above, but the app data does not support a personalized winner.'
      : 'The app does not have a calculated Skin Match for every selected product, so I can compare the catalog formula signals but cannot responsibly pick a personalized winner. Add My Skin alongside both products to include app-calculated match signals.';
  }
  return ['Product comparison', ...lines, conclusion].join('\n\n');
}

/** Reject small-model comparison output that adds product identities or formula facts absent from app evidence. */
export function isGroundedProductComparisonResponse(response: string, request: SkinAIRequest): boolean {
  const rawProducts = request.context.product;
  const products = (Array.isArray(rawProducts) ? rawProducts : rawProducts ? [rawProducts] : [])
    .map(object).filter((item): item is ProductEvidence => Boolean(item)).slice(0, 4);
  if (products.length < 2) return false;
  const answer = clean(response).toLocaleLowerCase();
  const evidence = JSON.stringify({
    products,
    routine: request.context.routine,
    shelf: request.context.shelf,
    catalogEvidence: request.context.catalogEvidence,
    localProducts: request.context['local-product-cache'],
  }).toLocaleLowerCase();
  const namedProducts = products.filter((product) => {
    const name = clean(product.name).toLocaleLowerCase();
    return name.length >= 4 && answer.includes(name);
  });
  if (namedProducts.length < 2) return false;
  if (/\b\d+(?:\.\d+)?\s?%/.test(answer)) {
    const percentages = response.match(/\b\d+(?:\.\d+)?\s?%/g) || [];
    if (percentages.some((value) => !evidence.includes(value.toLocaleLowerCase()))) return false;
  }
  const productCodes = response.match(/\b[A-Z]{1,3}\d+\b/g) || [];
  if (productCodes.some((value) => !evidence.includes(value.toLocaleLowerCase()))) return false;
  if (/\b(replac\w*|switch to|add a |try a |more effective|most effective|higher concentration|stronger concentration|more concentrated|better choice|best option|winner)\b/i.test(response)) return false;
  return true;
}

/** Keep product comparisons off the model path until two parsed formulas are actually available. */
export function routineShelfComparisonLimitation(request: SkinAIRequest): string | null {
  const asksForComparison = /\b(compare|comparison|versus|vs\.?|which one|which should|choose between|difference)\b/i.test(request.question);
  const productOrRoutineComparison = Boolean(request.context.routine || request.context.shelf || request.context.product)
    || /\b(products?|formulas?|routines?|shelf|cleanser|face ?wash|moisturizer|serum|sunscreen)\b/i.test(request.question);
  if (!asksForComparison || !productOrRoutineComparison) return null;
  const raw = request.context.product;
  const products = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  const parsedFormulaCount = products.filter((item) => item.formulaAvailable === true).length;
  if (products.length >= 2 && parsedFormulaCount >= 2) return null;
  return 'I don’t have parsed formula records for two identified products yet, so I can’t make a reliable ingredient-level comparison. Open both product pages while online to cache their formulas, or attach two products individually and ask again.';
}
