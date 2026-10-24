import type { SkinAIContextAttachment, SkinAIMessage, SkinAIRequest } from './types';
import { SKIN_AI_SYSTEM_PROMPT } from './prompt';

const MAX_QUESTION_CHARS = 800;
const MAX_CONTEXT_CHARS = 4_200;
const HISTORY_MESSAGES = 6;
const MESSAGE_CHARS = 420;

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

function summarizeOlderHistory(messages: SkinAIMessage[]) {
  const older = messages.slice(0, Math.max(0, messages.length - HISTORY_MESSAGES));
  if (!older.length) return undefined;
  return older.slice(-12).map((message) => `${message.role === 'user' ? 'User' : 'SkinDecode'}: ${message.text}`)
    .join('\n').replace(/\s+/g, ' ').slice(-500);
}

export function buildAIRequest(question: string, attachments: SkinAIContextAttachment[], messages: SkinAIMessage[]): SkinAIRequest {
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
    const value = compact({ id: item.sourceId, summary: item.summary, ...(item.data || {}) });
    const existing = context[key];
    context[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  let boundedContext = context;
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
    boundedContext = { selectedContext: Object.entries(context).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n').slice(0, MAX_CONTEXT_CHARS) };
  }
  return {
    systemPrompt: SKIN_AI_SYSTEM_PROMPT,
    question: question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS),
    context: boundedContext,
    history: messages.slice(-HISTORY_MESSAGES).map(({ role, text }) => ({ role, content: text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_CHARS) })),
    historySummary: summarizeOlderHistory(messages),
    ...(photoRefs.length ? { explicitlyAttachedPhotoRefs: [...new Set(photoRefs)] } : {}),
  };
}
