import { loadDailySkinCheckHistory } from '../daily-skin-check/storage';
import { getCachedProductDetailsByIds, getCachedShelfItems, getCachedSkinProfile } from '../products/product-cache';
import type { SkinProfile } from '../products/types';
import { getRoutineSnapshotForRange } from '../routine/routine-database';
import { localDateKey } from '../routine/models';
import { loadWaterHistory } from '../water/water-tracker';
import { analyzeIntelligence, stableIntelligenceFingerprint, type IntelligenceData } from './skin-intelligence';
import { getSkinAIValue, putSkinAIValue } from './storage';

export type LocalIntelligenceSnapshot = { analysis: ReturnType<typeof analyzeIntelligence>; fingerprint: string; data: IntelligenceData; timings: { dataLoadMs: number; analysisMs: number }; loadedAt: number };
function toProfile(row: Awaited<ReturnType<typeof getCachedSkinProfile>>): SkinProfile | null {
  if (!row?.onboarding_completed) return null;
  return { ageRange: row.age_range, skinType: row.skin_type, sensitivity: row.sensitivity, concerns: row.skin_concerns || [], goals: row.skin_goals || [], preferences: row.preferences || [] };
}

/** Loads only bounded SQLite/cache data. This module has no network or Supabase dependency. */
export async function loadLocalIntelligence(userId: string, now = new Date()): Promise<LocalIntelligenceSnapshot> {
  const started = Date.now();
  const today = localDateKey(now); const from = localDateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()-29));
  const [checks, water, routines, profileRow, shelf] = await Promise.all([
    loadDailySkinCheckHistory(userId, now), loadWaterHistory(userId, from, today), getRoutineSnapshotForRange(userId, from, today), getCachedSkinProfile(userId), getCachedShelfItems(userId),
  ]);
  const ids = [...new Set([...routines.steps.flatMap(s => s.productId ? [s.productId] : []), ...(shelf || []).slice(0,20).map(s => s.productId)])].slice(0,30);
  const products = await getCachedProductDetailsByIds(ids);
  const data: IntelligenceData = { checks, water, routines, products, profile: toProfile(profileRow) };
  const fingerprint = stableIntelligenceFingerprint({ checks, water, routines, profile: data.profile, products: [...products.entries()] });
  const dataLoadMs = Date.now() - started; const analysisStarted = Date.now();
  const cachedAnalysis = await getSkinAIValue<ReturnType<typeof analyzeIntelligence>>(userId, `analysis:${fingerprint}`);
  const analysis = cachedAnalysis?.value || analyzeIntelligence(data, now);
  const analysisMs = Date.now() - analysisStarted;
  if (!cachedAnalysis) await putSkinAIValue(userId, `analysis:${fingerprint}`, analysis);
  return { analysis, fingerprint, data, timings: { dataLoadMs, analysisMs }, loadedAt: Date.now() };
}

export async function loadCachedWeeklyNarrative(userId: string, fingerprint: string) {
  return getSkinAIValue<{ fingerprint: string; text: string }>(userId, `weekly-report:${fingerprint}`);
}
export async function saveCachedWeeklyNarrative(userId: string, fingerprint: string, text: string) {
  await putSkinAIValue(userId, `weekly-report:${fingerprint}`, { fingerprint, text });
}
