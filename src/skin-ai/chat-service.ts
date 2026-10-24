import { buildAIRequest } from './context-builder';
import { createSkinAIProvider, skinAIRuntimeConfig } from './provider';
import type { SkinAIContextAttachment, SkinAIMessage } from './types';

const provider = createSkinAIProvider();

export const AIChatService = {
  async answer(question: string, attachments: SkinAIContextAttachment[], history: SkinAIMessage[], signal?: AbortSignal) {
    const request = buildAIRequest(question, attachments, history);
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
  async *stream(question: string, attachments: SkinAIContextAttachment[], history: SkinAIMessage[], signal?: AbortSignal) {
    const request = buildAIRequest(question, attachments, history);
    if (provider.stream) {
      yield* provider.stream(request, { signal });
      return;
    }
    const response = await this.answer(question, attachments, history, signal);
    yield response.text;
  },
};
