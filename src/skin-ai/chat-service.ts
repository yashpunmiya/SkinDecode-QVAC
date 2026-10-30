import { buildAIRequest } from './context-builder';
import { buildProductComparison, isGroundedProductComparisonResponse, routineShelfComparisonLimitation } from './product-comparison';
import { buildCapabilityGuardAnswer } from './response-guard';
import { buildProductSuitabilityModelRequest, isGroundedProductSuitabilityResponse, productSuitabilityResponseRejectionReason } from './product-analysis';
import { createSkinAIProvider, skinAIRuntimeConfig } from './provider';
import type { SkinAIContextAttachment, SkinAIMessage } from './types';

const provider = createSkinAIProvider();
function comparisonModelRequest(request: ReturnType<typeof buildAIRequest>, comparison: string) {
  return {
    ...request,
    systemPrompt: `You are SkinDecode's on-device product analyst. Compare only the exact named products and facts in the private notes. Explain one practical trade-off using supplied formula findings and app-calculated Skin Match signals; do not repeat the full inventory. Name both products exactly as shown. If formula details or match scores are missing, say that the records do not support an ingredient-level or personalized comparison. Never invent product codes, product roles, ingredients, ingredient counts, concentrations, percentages, or efficacy claims. Do not suggest replacements or routine changes. Do not pick a personalized winner unless the supplied scores support it. Keep the answer to 2–4 concise sentences and cite only supplied references. Comparison evidence: ${comparison}`,
    history: [],
    context: { ...request.context, focusedProductAnalysis: true },
  };
}

async function answerProductComparison(request: ReturnType<typeof buildAIRequest>, comparison: string, signal?: AbortSignal) {
  const result = await provider.respond(comparisonModelRequest(request, comparison), { signal });
  return isGroundedProductComparisonResponse(result.text, request)
    ? result
    : { text: 'I couldn’t produce a reliable comparison from the saved product evidence, so I’ve left out unsupported details. Try comparing two products at a time or ask about one specific formula signal.' };
}

async function answerProductSuitability(request: ReturnType<typeof buildAIRequest>, signal?: AbortSignal): Promise<string | null> {
  const focusedRequest = buildProductSuitabilityModelRequest(request);
  if (!focusedRequest) return null;
  let fallbackReason = 'unknown model failure';
  try {
    const generated = await provider.respond(focusedRequest, { signal });
    if (isGroundedProductSuitabilityResponse(generated.text, focusedRequest)) return generated.text;
    fallbackReason = productSuitabilityResponseRejectionReason(generated.text, focusedRequest) || 'invalid model output';
  } catch (error) {
    if (signal?.aborted) throw error;
    fallbackReason = error instanceof Error ? `QVAC generation error (${error.name})` : 'QVAC generation error';
  }
  console.warn('[Skin AI] Product analysis using evidence fallback:', fallbackReason);
  // Do not quietly replace a failed model answer with an app-authored report:
  // that made users believe the local model had reasoned about their question.
  return 'I couldn’t get a reliable answer from the on-device model this time. Please try again, or ask a narrower question about one ingredient or the product’s Skin Match.';
}

export const AIChatService = {
  async answer(question: string, attachments: SkinAIContextAttachment[], history: SkinAIMessage[], signal?: AbortSignal, additionalContext: Record<string, unknown> = {}) {
    const request = buildAIRequest(question, attachments, history, additionalContext);
    const limitedRoutineComparison = routineShelfComparisonLimitation(request);
    if (limitedRoutineComparison) return { text: limitedRoutineComparison };
    const comparison = buildProductComparison(request);
    if (comparison) return answerProductComparison(request, comparison, signal);
    const guarded = buildCapabilityGuardAnswer(request);
    if (guarded) return { text: guarded };
    const productAnalysis = await answerProductSuitability(request, signal);
    if (productAnalysis) return { text: productAnalysis };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), skinAIRuntimeConfig.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      let attempt = 0;
      while (true) {
        try { return await provider.respond(request, { signal: controller.signal }); }
        catch (error) {
          if (controller.signal.aborted || attempt >= skinAIRuntimeConfig.retries) throw error;
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  },
  async *stream(question: string, attachments: SkinAIContextAttachment[], history: SkinAIMessage[], signal?: AbortSignal, additionalContext: Record<string, unknown> = {}) {
    const request = buildAIRequest(question, attachments, history, additionalContext);
    const limitedRoutineComparison = routineShelfComparisonLimitation(request);
    if (limitedRoutineComparison) { if (signal?.aborted) throw new Error('Response cancelled.'); yield limitedRoutineComparison; return; }
    const comparison = buildProductComparison(request);
    if (comparison) {
      if (signal?.aborted) throw new Error('Response cancelled.');
      const result = await answerProductComparison(request, comparison, signal);
      if (signal?.aborted) throw new Error('Response cancelled.');
      yield result.text;
      return;
    }
    const grounded = buildCapabilityGuardAnswer(request);
    if (grounded) { if (signal?.aborted) throw new Error('Response cancelled.'); yield grounded; return; }
    const productAnalysis = await answerProductSuitability(request, signal);
    if (productAnalysis) { if (signal?.aborted) throw new Error('Response cancelled.'); yield productAnalysis; return; }
    if (provider.stream) {
      yield* provider.stream(request, { signal });
      return;
    }
    const response = await this.answer(question, attachments, history, signal, additionalContext);
    yield response.text;
  },
};
