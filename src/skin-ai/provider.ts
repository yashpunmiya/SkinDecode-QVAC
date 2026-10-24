import { SKIN_AI_SYSTEM_PROMPT } from './prompt';
import type { AIProvider, SkinAIRequest, SkinAIResponse } from './types';

export type SkinAIRuntimeConfig = {
  provider: 'mock' | 'gemini' | 'openai' | 'custom';
  model: string | null;
  apiKey: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retries: number;
  streaming: boolean;
  systemPrompt: string;
};

/** The single future integration point. Keep provider credentials in a secure backend, not EXPO_PUBLIC env. */
export const skinAIRuntimeConfig: SkinAIRuntimeConfig = {
  provider: 'mock', model: null, apiKey: null,
  maxInputTokens: 2_400, maxOutputTokens: 240, timeoutMs: 20_000, retries: 1,
  streaming: false, systemPrompt: SKIN_AI_SYSTEM_PROMPT,
};

export class MockSkinAIProvider implements AIProvider {
  readonly id = 'mock';

  async respond(request: SkinAIRequest, options: { signal?: AbortSignal }): Promise<SkinAIResponse> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 420);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Response cancelled.')); }, { once: true });
    });
    const contextNames = Object.keys(request.context).filter((key) => key !== 'photos');
    const preface = contextNames.length ? `I’ve noted your ${contextNames.map((key) => key.replaceAll('-', ' ')).join(', ')} context. ` : '';
    return {
      text: `${preface}Skin AI is in preview mode, so this reply is a local placeholder. Once a provider is connected, I can answer “${request.question.slice(0, 110)}” using only the context you attached.`,
    };
  }
}

export function createSkinAIProvider(config = skinAIRuntimeConfig): AIProvider {
  // Provider implementations can be swapped here without coupling the screen or context builder.
  if (config.provider === 'mock') return new MockSkinAIProvider();
  throw new Error(`The ${config.provider} provider is not connected yet.`);
}
