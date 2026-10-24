import type { Href } from 'expo-router';
import type { SkinAIContextType } from './types';

export type SkinAIEntryContext = {
  type: SkinAIContextType;
  id?: string | number;
  label?: string;
};

/** Shared deep-link contract for attaching a specific source as a draft context item. */
export function skinAIHref(context?: SkinAIEntryContext): Href {
  if (!context) return '/skin-ai' as Href;
  return {
    pathname: '/skin-ai',
    params: {
      contextType: context.type,
      ...(context.id !== undefined ? { contextId: String(context.id) } : {}),
      ...(context.label ? { contextLabel: context.label } : {}),
    },
  } as Href;
}
