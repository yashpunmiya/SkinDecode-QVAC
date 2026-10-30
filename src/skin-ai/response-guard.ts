import type { SkinAIRequest } from './types';

/** Deterministic replies for capabilities the current text model cannot safely infer. */
export function buildCapabilityGuardAnswer(request: SkinAIRequest): string | null {
  const photos = request.context.photos;
  if (Array.isArray(photos) && photos.length && /\b(photo|picture|image|face|compare my)\b/i.test(request.question)) {
    const hasChecks = Boolean(request.context['skin-check']);
    return `I can’t inspect photo pixels with the current text-only Skin AI model, so I haven’t compared your face or made visual observations.${hasChecks ? ' I can compare the skin-check ratings you attached, which are self-reported records.' : ' I can still compare photos manually in the Skin Check screen, or discuss check-in ratings if you attach them.'}`;
  }
  return null;
}
