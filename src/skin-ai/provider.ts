import { completion, cancel } from '@qvac/sdk';
import { ensureQvacModelLoaded, reportQvacInferenceFailure, reportQvacInferenceSuccess, setActiveQvacCompletion } from './qvac-runtime';
import { buildEvidenceSynthesisInstructions, SKIN_AI_SYSTEM_PROMPT } from './prompt';
import { renderRetrievedCatalogSources } from './evidence-format';
import { fitContextNotes } from './context-window';
import type { AIProvider, SkinAIRequest, SkinAIResponse } from './types';

export type SkinAIRuntimeConfig = {
  provider: 'qvac' | 'gemini' | 'openai' | 'custom';
  model: string | null;
  apiKey: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retries: number;
  streaming: boolean;
  systemPrompt: string;
};

/** Model weights and inference stay on-device. Network access is used only to fetch model files once. */
export const skinAIRuntimeConfig: SkinAIRuntimeConfig = {
  provider: 'qvac', model: 'Llama 3.2 1B Instruct Q4_0', apiKey: null,
  // 256 tokens cut off otherwise healthy multi-part answers mid-thought.
  // Keep enough headroom for a complete explanation while remaining practical
  // on the bundled 1B model.
  maxInputTokens: 1_450, maxOutputTokens: 512, timeoutMs: 240_000, retries: 0,
  streaming: true, systemPrompt: SKIN_AI_SYSTEM_PROMPT,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : undefined;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)) : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

// One native QVAC request at a time: concurrent screens/actions wait in FIFO order.
let inferenceTail: Promise<void> = Promise.resolve();
async function acquireInferenceSlot(signal?: AbortSignal) {
  const previous = inferenceTail;
  let unlock!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  inferenceTail = previous.then(() => gate);
  if (signal?.aborted) { void previous.then(unlock); throw new Error('Response cancelled.'); }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Response cancelled.'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([previous, aborted]); }
  catch (error) { void previous.then(unlock); throw error; }
  finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
  if (signal?.aborted) { unlock(); throw new Error('Response cancelled.'); }
  return unlock;
}

/** Turn selected app data into short readable notes; raw JSON makes the small model echo its structure. */
function renderContextNotes(context: Record<string, unknown>, question: string): string {
  const notes: string[] = [];
  const asksIngredients = /ingredient|formula|what(?:'s| is) in|contains|list/i.test(question);
  const profile = record(context['skin-profile']);
  if (profile) {
    const facts = [
      profile.skinType && `skin type: ${label(String(profile.skinType))}`,
      profile.sensitivity && `sensitivity: ${label(String(profile.sensitivity))}`,
      list(profile.concerns).length && `concerns: ${list(profile.concerns).map(label).join(', ')}`,
      list(profile.goals).length && `goals: ${list(profile.goals).map(label).join(', ')}`,
      list(profile.preferences).length && `preferences: ${list(profile.preferences).map(label).join(', ')}`,
    ].filter(Boolean);
    if (facts.length) notes.push(`Skin profile — ${facts.join('; ')}.`);
  }

  const routine = record(context.routine);
  const steps = Array.isArray(routine?.steps) ? routine.steps.map(record).filter((step): step is Record<string, unknown> => Boolean(step)) : [];
  if (steps.length) {
    const groups = ['am', 'pm'].map((period) => {
      const names = steps.filter((step) => text(step.period)?.toLowerCase() === period).map((step) => {
        const name = text(step.name) || 'Unnamed step';
        const brand = text(step.brand);
        const status = text(step.status);
        return `${name}${brand ? ` (${brand})` : ''}${status && status !== 'pending' ? ` — ${status}` : ''}`;
      });
      return names.length ? `${period.toUpperCase()}: ${names.join(', ')}` : '';
    }).filter(Boolean);
    notes.push(`Routine — ${groups.join('; ')}.`);
  }

  const checks = record(context['skin-check']);
  if (checks) {
    for (const day of ['yesterday', 'today']) {
      const check = record(checks[day]);
      if (!check) continue;
      const ratings = record(check.ratings);
      const ratingText = ratings ? Object.entries(ratings).map(([key, value]) => `${label(key)} ${String(value)}`).join(', ') : '';
      const extras = [ratingText, check.morningRoutineCompleted === true ? 'AM routine completed' : '', check.eveningRoutineCompleted === true ? 'PM routine completed' : '', text(check.newProductStarted) ? `new product: ${text(check.newProductStarted)}` : ''].filter(Boolean);
      notes.push(`${label(day)} skin check${text(check.date) ? ` (${text(check.date)})` : ''}${extras.length ? ` — ${extras.join('; ')}` : ''}.`);
    }
    const comparison = record(checks.comparison);
    if (text(comparison?.summary)) notes.push(`Check-in comparison — ${text(comparison?.summary)}.`);
  }

  const shelf = record(context.shelf);
  const shelfProducts = Array.isArray(shelf?.products) ? shelf.products.map(record).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  if (shelfProducts.length) notes.push(`Products on shelf — ${shelfProducts.map((item) => [text(item.name), text(item.brand)].filter(Boolean).join(' by ')).join('; ')}.`);

  const products = Array.isArray(context.product) ? context.product : context.product ? [context.product] : [];
  for (const value of products) {
    const product = record(value);
    if (!product) continue;
    const name = text(product.name) || 'Selected product';
    const identity = [text(product.brand), text(product.category)].filter(Boolean).join(' · ');
    const ingredients = list(product.ingredients);
    const findings = Array.isArray(product.formulaFindings) ? product.formulaFindings.map(record).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => `${text(item.label) || 'Formula finding'}${list(item.ingredients).length ? ` (${list(item.ingredients).join(', ')})` : ''}`).slice(0, 4) : [];
    const skinMatch = record(product.skinMatch);
    const matchSignals = skinMatch ? [
      typeof skinMatch.score === 'number' ? `app Skin Match: ${skinMatch.score}/100${text(skinMatch.confidence) ? ` (${text(skinMatch.confidence)} confidence)` : ''}` : '',
      list(skinMatch.positives).length ? `app match signals: ${list(skinMatch.positives).join(', ')}` : '',
      list(skinMatch.concerns).length ? `app caution signals: ${list(skinMatch.concerns).join(', ')}` : '',
    ].filter(Boolean) : [];
    const details = [
      identity ? `from ${identity}` : '',
      ingredients.length ? `listed ingredients: ${ingredients.join(', ')}` : product.formulaAvailable === false ? 'ingredient formula is unavailable' : '',
      findings.length ? `app formula findings: ${findings.join('; ')}` : '',
      ...matchSignals,
    ].filter(Boolean);
    notes.push(`${name}${details.length ? ` — ${details.join('. ')}.` : '.'}`);
  }

  const cachedProducts = records(context['local-product-cache']).slice(0, 8);
  const cachedNames = cachedProducts.map((product) => text(product.name)).filter((name): name is string => Boolean(name));
  const personalFacts = list(context.personalFacts).filter((fact) => !cachedNames.some((name) => fact.toLocaleLowerCase().startsWith(name.toLocaleLowerCase())));
  if (personalFacts.length) notes.push(...personalFacts);
  const selectedProductIds = new Set(products.map((value) => Number(record(value)?.productId)).filter((id) => Number.isSafeInteger(id) && id > 0));
  for (const product of cachedProducts.filter((item) => !selectedProductIds.has(Number(item.productId)))) {
    const name = text(product.name) || 'Cached product';
    const brand = text(product.brand);
    const findings = records(product.formulaFindings).slice(0, 4).map((item) => `${text(item.kind) || 'catalog'}: ${text(item.label) || 'formula signal'}${list(item.ingredients).length ? ` (${list(item.ingredients).slice(0, 2).join(', ')})` : ''}`);
    const match = record(product.skinMatch);
    const matchSummary = match ? [typeof match.score === 'number' ? `Skin Match ${match.score}/100 (${text(match.confidence) || 'unrated'} confidence)` : '', list(match.concerns).length ? `profile cautions: ${list(match.concerns).slice(0, 2).join(', ')}` : '', list(match.positives).length ? `profile positives: ${list(match.positives).slice(0, 2).join(', ')}` : ''].filter(Boolean).join('; ') : '';
    const ingredientLimit = asksIngredients ? 8 : 3;
    const ingredients = records(product.ingredients).slice(0, ingredientLimit).map((item) => `${text(item.name) || 'Ingredient'}${asksIngredients && list(item.functions).length ? ` (${list(item.functions).slice(0, 1).join(', ')})` : ''}`);
    notes.push(`Locally cached product: ${name}${brand ? ` by ${brand}` : ''}${matchSummary ? `. ${matchSummary}` : ''}${findings.length ? `. Formula signals: ${findings.join('; ')}` : ''}${ingredients.length ? `. Listed ingredients${asksIngredients ? '' : ' (sample)'}: ${ingredients.join(', ')}` : '. The formula details are not cached.'}`);
  }
  for (const [index, item] of records(context.catalogEvidence).slice(0, 5).entries()) {
    const source = text(item.source) || 'Local catalog';
    const url = text(item.sourceUrl);
    notes.push(`[E${index + 1}] ${text(item.title) || 'Catalog evidence'} — ${text(item.text) || 'No evidence details were cached.'} Source: ${source}${url ? ` (${url})` : ''}.`);
  }
  for (const limitation of list(context.dataLimitations)) notes.push(`Data limitation: ${limitation}`);
  if (text(context.photoAnalysisStatus)) notes.push(text(context.photoAnalysisStatus)!);

  return notes.length ? `Private app notes for this question (use only what is relevant; do not describe these notes):\n${notes.join('\n')}` : '';
}

export class QvacSkinAIProvider implements AIProvider {
  readonly id = 'qvac-local';

  async respond(request: SkinAIRequest, options: { signal?: AbortSignal }): Promise<SkinAIResponse> {
    let text = '';
    for await (const part of this.stream(request, options)) text += part;
    return { text };
  }

  async *stream(request: SkinAIRequest, options: { signal?: AbortSignal }): AsyncIterable<string> {
    const unlock = await acquireInferenceSlot(options.signal);
    try { yield* this.streamUnlocked(request, options); }
    finally { unlock(); }
  }

  private async *streamUnlocked(request: SkinAIRequest, options: { signal?: AbortSignal }): AsyncIterable<string> {
    if (options.signal?.aborted) throw new Error('Response cancelled.');
    const modelId = await ensureQvacModelLoaded();
    if (options.signal?.aborted) throw new Error('Response cancelled.');
    // Phase 1 is text-only. Explicit photo attachments remain visible in chat history but
    // are deliberately excluded from inference until a photo model is implemented.
    const context = Object.fromEntries(Object.entries(request.context).filter(([key]) => key !== 'photos'));
    const contextText = renderContextNotes(context, request.question);
    const basePrompt = request.systemPrompt || SKIN_AI_SYSTEM_PROMPT;
    const synthesisInstructions = context.focusedProductAnalysis === true
      ? ''
      : buildEvidenceSynthesisInstructions(request.question, context);
    const promptText = [basePrompt, synthesisInstructions].filter(Boolean).join('\n\n');
    // The QVAC SDK reports model-specific context overflow only after native inference
    // starts. Estimate conservatively and discard oldest turns first so a normal chat
    // stays below the model window instead of failing with a native context error.
    const history = request.history.slice(-4).map(({ role, content }) => ({
      role,
      content: content.replace(/\s+/g, ' ').trim().slice(0, 180),
    }));
    const requestedHistoryTurns = history.length;
    const question = request.question.replace(/\s+/g, ' ').trim().slice(0, 500);
    const estimateInputUnits = (contextChars: number) => Math.ceil((promptText.length + contextChars + question.length + history.reduce((sum, item) => sum + item.content.length, 0)) / 2.5) + (history.length + 2) * 12;
    while (history.length && estimateInputUnits(contextText.length) > skinAIRuntimeConfig.maxInputTokens) history.shift();
    const omittedHistoryTurns = requestedHistoryTurns - history.length;
    const allowedContextChars = Math.max(0, (skinAIRuntimeConfig.maxInputTokens - Math.ceil((promptText.length + question.length) / 2.5) - history.reduce((sum, item) => sum + Math.ceil(item.content.length / 2.5) + 12, 0) - 24) * 2.5 - promptText.length - 2);
    const fittedContext = fitContextNotes(contextText, Math.floor(allowedContextChars), question);
    const boundedSystemContent = [promptText, fittedContext.text].filter(Boolean).join('\n\n');
    if (fittedContext.omitted || omittedHistoryTurns) {
      console.warn(`[Skin AI/QVAC] Context window kept the highest-relevance notes; ${fittedContext.omitted} context note(s) and ${omittedHistoryTurns} older conversation turn(s) were shortened or omitted.`);
    }
    if (estimateInputUnits(fittedContext.text.length) > skinAIRuntimeConfig.maxInputTokens) {
      throw new Error('This message is too long for the on-device model. Please shorten it and try again.');
    }
    const run = completion({
      modelId,
      history: [
        { role: 'system', content: boundedSystemContent },
        ...history,
        { role: 'user', content: question },
      ],
      stream: true,
      generationParams: { predict: skinAIRuntimeConfig.maxOutputTokens, temp: 0.35, top_p: 0.85 },
    });
    setActiveQvacCompletion(run.requestId);
    const inferenceStartedAt = Date.now();
    let firstTokenAt: number | null = null;
    const abort = () => { void cancel({ requestId: run.requestId }).catch(() => undefined); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      for await (const token of run.tokenStream) {
        if (options.signal?.aborted) throw new Error('Response cancelled.');
        if (firstTokenAt === null) firstTokenAt = Date.now();
        yield token;
      }
      const sources = renderRetrievedCatalogSources(request.context.catalogEvidence);
      if (sources) yield sources;
      reportQvacInferenceSuccess(Date.now() - inferenceStartedAt, firstTokenAt === null ? undefined : firstTokenAt - inferenceStartedAt);
    } catch (error) {
      if (!options.signal?.aborted) reportQvacInferenceFailure(error);
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      setActiveQvacCompletion(null);
    }
  }
}

export function createSkinAIProvider(config = skinAIRuntimeConfig): AIProvider {
  if (config.provider === 'qvac') return new QvacSkinAIProvider();
  throw new Error(`The ${config.provider} provider is not connected yet.`);
}
