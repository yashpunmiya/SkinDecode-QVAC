export type SkinAIContextType =
  | 'skin-profile'
  | 'routine'
  | 'skin-check'
  | 'shelf'
  | 'product'
  | 'product-evidence'
  | 'progress-photo';

/** A displayable, removable selection. Raw catalog objects and photo bytes never live here. */
export type SkinAIContextAttachment = {
  id: string;
  type: SkinAIContextType;
  label: string;
  summary: string;
  sourceId?: string | number;
  selectedByUser: true;
  data?: Record<string, unknown>;
  /** Local reference only; providers must explicitly opt in and resolve it at send time. */
  localPhotoUri?: string;
};

export type SkinAIMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  attachments?: SkinAIContextAttachment[];
};

export type SkinAIRequest = {
  systemPrompt: string;
  question: string;
  context: Record<string, unknown>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  historySummary?: string;
  /** Photo references are deliberately a separate opt-in channel, never part of normal context. */
  explicitlyAttachedPhotoRefs?: string[];
};

export type SkinAIResponse = { text: string; usage?: { inputTokens?: number; outputTokens?: number } };

export interface AIProvider {
  readonly id: string;
  respond(request: SkinAIRequest, options: { signal?: AbortSignal }): Promise<SkinAIResponse>;
  stream?(request: SkinAIRequest, options: { signal?: AbortSignal }): AsyncIterable<string>;
}
