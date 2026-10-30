// Local deterministic evidence engine for Skin Intelligence.
import { calculateSkinTrend, calculateWaterTrend } from './analysis-metrics.ts';
import { scoreProductMatch } from '../products/product-intelligence.ts';
import type { ProductDetail, SkinProfile } from '../products/types';
import type { DailySkinCheck } from '../daily-skin-check/rules';
import type { RoutineSnapshot } from '../routine/models';
import type { WaterHistoryEntry } from '../water/water-tracker';

export type IntelligenceData = { checks: DailySkinCheck[]; water: WaterHistoryEntry[]; routines: RoutineSnapshot; products: Map<number, ProductDetail>; profile: SkinProfile | null };
export type IntelligenceFlag = { id: string; kind: 'caution' | 'informational' | 'needs_review'; title: string; detail: string; products: string[]; ingredients: string[] };
export type IntelligenceFinding = { id: string; title: string; detail: string; dates: string[]; evidence: string[]; confidence: 'recorded'|'pattern' };
const norm = (s: string) => s.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function detectRoutineConflicts(data: IntelligenceData): IntelligenceFlag[] {
  const activeRoutines = new Set(data.routines.routines.filter(r => r.isActive).map(r => r.id));
  const steps = data.routines.steps.filter(s => s.enabled && activeRoutines.has(s.routineId));
  const flags: IntelligenceFlag[] = [];
  const ingredientProducts = new Map<string, Set<string>>();
  for (const step of steps) {
    const product = step.productId ? data.products.get(step.productId) : undefined;
    if (!product?.hasParsedFormula || !product.formulas.length) {
      if (step.productId) flags.push({ id: `missing:${step.id}`, kind: 'needs_review', title: 'Formula not cached', detail: 'Ingredient overlap and formula cautions cannot be checked without a parsed local formula.', products: [product?.name || step.title], ingredients: [] });
      continue;
    }
    const formula = product.formulas[0]!;
    for (const item of formula.analysis.filter(f => f.kind === 'concern' && f.resolved)) {
      flags.push({ id: `catalog:${step.id}:${item.attributeId}`, kind: 'caution', title: item.label, detail: item.description || 'This concern is recorded in the cached product formula analysis.', products: [product.name], ingredients: item.responsibleIngredients.map(i => i.inciName || i.name) });
    }
    if (data.profile) for (const item of scoreProductMatch(product, data.profile, formula).strongestConcerns) {
      flags.push({ id: `profile:${step.id}:${norm(item.label)}`, kind: 'caution', title: item.label, detail: 'The app’s existing skin-profile matching engine reports this concern signal.', products: [product.name], ingredients: item.ingredientNames });
    }
    for (const ingredient of formula.ingredients) {
      const name = ingredient.inciName || ingredient.name; const id = norm(name);
      if (!id) continue;
      const matches = ingredientProducts.get(id) || new Set<string>(); matches.add(product.name); ingredientProducts.set(id, matches);
    }
  }
  for (const [ingredient, products] of ingredientProducts) if (products.size > 1) flags.push({ id: `overlap:${ingredient}`, kind: 'informational', title: 'Repeated listed ingredient', detail: 'The same ingredient appears in multiple cached routine formulas. This is an overlap observation, not evidence of harm.', products: [...products], ingredients: [ingredient] });
  return flags.filter((f, i) => flags.findIndex(other => other.id === f.id) === i);
}

export function analyzeIntelligence(data: IntelligenceData, now = new Date()) {
  const findings: IntelligenceFinding[] = [];
  const trends = calculateSkinTrend(data.checks, 7, now);
  const trends30 = calculateSkinTrend(data.checks, 30, now);
  for (const t of trends) if (t.count >= 3 && Math.abs(t.delta) >= 1) {
    const coincidentProduct = data.checks.some(c => c.localDate >= t.firstDate && c.localDate <= t.lastDate && c.newProductStarted);
    findings.push({ id: `trend:${t.metric}`, title: `${t.metric[0]!.toUpperCase()}${t.metric.slice(1)} rating ${t.delta > 0 ? 'increased' : 'decreased'}`, detail: `Your reported ${t.metric} moved from ${t.first}/5 to ${t.last}/5 in ${t.count} check-ins. ${coincidentProduct ? 'A new product was also logged during this period; timing does not establish a cause.' : 'This is a self-reported change, not a diagnosis.'}`, dates: [t.firstDate,t.lastDate], evidence: [`${t.count} check-ins`, `Change ${t.delta > 0 ? '+' : ''}${t.delta}`], confidence: 'pattern' });
  }
  for (const check of data.checks) if (check.newProductStarted) findings.push({ id: `product:${check.localDate}`, title: 'New product logged', detail: 'A new product was marked on this check-in. Compare later entries; this timing alone does not establish a cause.', dates: [check.localDate], evidence: ['New product flag'], confidence: 'recorded' });
  const today = dateKey(now); const from = dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()-6));
  const weekChecks = data.checks.filter(c => c.localDate >= from && c.localDate <= today);
  const logs = data.routines.logs.filter(l => l.logDate >= from && l.logDate <= today);
  const active = new Set(data.routines.routines.filter(r => r.isActive).map(r => r.id));
  const dueSteps = data.routines.steps.filter(s => s.enabled && active.has(s.routineId));
  let due = 0, completed = 0;
  for (let day = new Date(now.getFullYear(),now.getMonth(),now.getDate()-6); day <= now; day.setDate(day.getDate()+1)) for (const step of dueSteps) if (step.daysOfWeek.includes(day.getDay())) { due++; if (logs.some(l => l.stepId === step.id && l.logDate === dateKey(day) && l.status === 'completed')) completed++; }
  const water = calculateWaterTrend(data.water, 7, now);
  const suggestions = [weekChecks.length >= 3 ? 'Continue regular check-ins to make week-to-week comparisons more useful.' : '', water && water.daysWithRecords < 7 ? 'Log water intake on more days for a fuller weekly summary.' : '', due && completed / due < 0.7 ? 'Review whether your scheduled routine is manageable; this summary does not recommend adding products.' : ''].filter(Boolean).slice(0,3);
  const limitations = [weekChecks.length < 3 ? 'Fewer than three check-ins this week; skin patterns may be missed.' : '', !water ? 'No water records this week; missing entries are not zero intake.' : '', !due ? 'No scheduled active routine steps are available for adherence analysis.' : '', !data.products.size ? 'No product formulas are cached; overlap checks are limited.' : ''].filter(Boolean);
  const routineAdherence = { due, completed, percentage: due ? Math.round(completed/due*100) : 0 };
  return { findings, conflicts: detectRoutineConflicts(data), trends, trends30, water, routineAdherence, checkins: weekChecks.length, metrics: { trends, trends30, water, routineAdherence, checkins: weekChecks.length }, suggestions, limitations };
}

export type Scenario = { removeProductId?: number; replaceWithProductId?: number; moveStepId?: string; moveTo?: 'am'|'pm' };
export function simulateRoutine(data: IntelligenceData, scenario: Scenario) {
  const before = detectRoutineConflicts(data);
  const snapshot = { ...data.routines, steps: data.routines.steps.map(s => ({ ...s })) };
  if (scenario.replaceWithProductId && scenario.removeProductId) { const s = snapshot.steps.find(item => item.productId === scenario.removeProductId); if (s) s.productId = scenario.replaceWithProductId; }
  else if (scenario.removeProductId) snapshot.steps = snapshot.steps.filter(s => s.productId !== scenario.removeProductId);
  if (scenario.moveStepId && scenario.moveTo) { const s = snapshot.steps.find(item => item.id === scenario.moveStepId); if (s) s.period = scenario.moveTo; }
  const after = detectRoutineConflicts({ ...data, routines: snapshot });
  const unknown = snapshot.steps.filter(s => s.enabled && s.productId && !data.products.get(s.productId)?.hasParsedFormula).map(s => data.products.get(s.productId!)?.name || s.title);
  const exposures = (steps: typeof snapshot.steps) => {
    const result = { am: new Set<string>(), pm: new Set<string>() };
    for (const step of steps.filter(s => s.enabled)) {
      const formula = step.productId ? data.products.get(step.productId)?.formulas[0] : undefined;
      for (const ingredient of formula?.ingredients || []) result[step.period].add(ingredient.inciName || ingredient.name);
    }
    return result;
  };
  const oldExposure = exposures(data.routines.steps); const newExposure = exposures(snapshot.steps);
  const shift = (period: 'am'|'pm') => {
    const added = [...newExposure[period]].filter(name => !oldExposure[period].has(name));
    const removed = [...oldExposure[period]].filter(name => !newExposure[period].has(name));
    return `${period.toUpperCase()} listed ingredients ${oldExposure[period].size} → ${newExposure[period].size}${added.length ? `; added ${added.slice(0,5).join(', ')}` : ''}${removed.length ? `; removed ${removed.slice(0,5).join(', ')}` : ''}`;
  };
  return { before, after, missingFormulaProducts: unknown, changes: [`Enabled steps ${data.routines.steps.filter(s=>s.enabled).length} → ${snapshot.steps.filter(s=>s.enabled).length}`, shift('am'), shift('pm'), `Catalog/profile caution signals ${before.filter(f=>f.kind==='caution').length} → ${after.filter(f=>f.kind==='caution').length}`, `Repeated-ingredient observations ${before.filter(f=>f.id.startsWith('overlap:')).length} → ${after.filter(f=>f.id.startsWith('overlap:')).length}`] };
}

export function stableIntelligenceFingerprint(value: unknown) {
  const str = JSON.stringify(value, (_key, v) => v instanceof Map ? [...v.entries()].sort(([a],[b]) => Number(a)-Number(b)) : v);
  let h = 2166136261; for (let i=0;i<str.length;i++) { h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
  return `${str.length.toString(36)}-${(h>>>0).toString(36)}`;
}
