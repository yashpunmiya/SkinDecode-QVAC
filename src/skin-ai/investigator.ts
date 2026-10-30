import type { DailySkinCheck, SkinCheckMetric } from '../daily-skin-check/rules';
import { isStepScheduled, localDateKey, type RoutineSnapshot } from '../routine/models.ts';
import type { WaterHistoryEntry } from '../water/water-tracker';
import type { ProductDetail, SkinProfile } from '../products/types';
import { scoreProductMatch } from '../products/product-intelligence.ts';
import { calculateSkinTrend, calculateWaterTrend } from './analysis-metrics.ts';

const METRIC_LABELS: Record<SkinCheckMetric, string> = { acne: 'breakouts', redness: 'redness', dryness: 'dryness', oiliness: 'oiliness', irritation: 'irritation' };
const deltaLabel = (delta: number) => `${delta > 0 ? '+' : ''}${delta}`;

function dayWindow(now: Date, days: number) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  return { from: localDateKey(start), through: localDateKey(now) };
}

function skinTrendFact(history: DailySkinCheck[], days: 7 | 30, now: Date) {
  const trend = calculateSkinTrend(history, days, now);
  const entries = history.filter((item) => item.localDate >= dayWindow(now, days).from && item.localDate <= dayWindow(now, days).through);
  if (!entries.length) return `${days}-day skin-check history: no check-ins were recorded.`;
  if (!trend.length) return `${days}-day skin-check history: ${entries.length} check-in${entries.length === 1 ? '' : 's'} recorded; a trend needs at least two readings for the same rating.`;
  return `${days}-day skin ratings (${entries.length} recorded check-ins): ${trend.map((item) => `${METRIC_LABELS[item.metric]} average ${item.average.toFixed(1)}/5, ${item.first}/5 on ${item.firstDate} to ${item.last}/5 on ${item.lastDate} (${deltaLabel(item.delta)})`).join('; ')}. These are self-reported ratings, not a diagnosis.`;
}

function eventFacts(history: DailySkinCheck[]) {
  const ordered = [...history].sort((a, b) => a.localDate.localeCompare(b.localDate));
  return ordered.flatMap((item, index) => {
    if (!item.newProductStarted) return [];
    const previous = ordered[index - 1];
    const change = previous ? (['irritation', 'redness', 'dryness', 'acne', 'oiliness'] as const)
      .filter((metric) => item.ratings[metric] !== previous.ratings[metric])
      .map((metric) => `${METRIC_LABELS[metric]} ${previous.ratings[metric]} to ${item.ratings[metric]} (${deltaLabel(item.ratings[metric] - previous.ratings[metric])})`) : [];
    return [`On ${item.localDate}, you marked that a new product was started${previous ? `; the previous recorded check-in was ${previous.localDate}${change.length ? ` and ratings changed: ${change.join(', ')}` : ' with no rating changes'}` : ', with no earlier check-in available'}. The check-in does not identify the product, and timing alone cannot show cause.`];
  });
}

function routineFacts(snapshot: RoutineSnapshot, now: Date) {
  const activeRoutines = snapshot.routines.filter((item) => item.isActive && !item.deletedAt);
  const activeIds = new Set(activeRoutines.map((item) => item.id));
  const steps = snapshot.steps.filter((item) => activeIds.has(item.routineId) && item.enabled && !item.deletedAt);
  const windowSummary = (days: 7 | 30) => {
    const { from, through } = dayWindow(now, days);
    const logs = snapshot.logs.filter((item) => item.logDate >= from && item.logDate <= through && !item.deletedAt && steps.some((step) => step.id === item.stepId));
    const completed = logs.filter((item) => item.status === 'completed').length;
    const skipped = logs.filter((item) => item.status === 'skipped').length;
    let scheduled = 0;
    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      date.setDate(date.getDate() - offset);
      scheduled += steps.filter((step) => isStepScheduled(step, date)).length;
    }
    const loggedKeys = new Set(logs.map((item) => `${item.stepId}:${item.logDate}`));
    const unrecorded = Math.max(0, scheduled - loggedKeys.size);
    return `${days}-day routine records: ${completed} completed and ${skipped} explicitly skipped step logs; ${unrecorded} of ${scheduled} scheduled step-days have no recorded outcome`;
  };
  const { from, through } = dayWindow(now, 7);
  const logs = snapshot.logs.filter((item) => item.logDate >= from && item.logDate <= through && !item.deletedAt && steps.some((step) => step.id === item.stepId));
  const summary = `${windowSummary(7)}. ${windowSummary(30)}. No log does not prove whether a product was used.`;
  const timeline = [...new Set(logs.map((item) => item.logDate))].sort().slice(-7).map((date) => {
    const dayLogs = logs.filter((item) => item.logDate === date);
    return `${date}: ${dayLogs.map((log) => `${steps.find((step) => step.id === log.stepId)?.title || 'Routine step'} ${log.status}`).join(', ')}`;
  });
  const current = steps.map((step) => `${step.period.toUpperCase()} ${step.title}${step.productId ? ` (product ${step.productId})` : ''}`);
  return [
    `Current routine (${steps.length} enabled steps): ${current.length ? current.join('; ') : 'no enabled steps recorded'}.`,
    summary,
    timeline.length ? `Recorded routine timeline: ${timeline.join('; ')}.` : 'No completed/skipped routine step logs were recorded in the last 7 days.',
  ];
}

function waterFact(entries: WaterHistoryEntry[], now: Date) {
  const recent = calculateWaterTrend(entries, 7, now);
  const month = calculateWaterTrend(entries, 30, now);
  const previousStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  previousStart.setDate(previousStart.getDate() - 13);
  const previousEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  previousEnd.setDate(previousEnd.getDate() - 7);
  const previousRows = entries.filter((item) => item.localDate >= localDateKey(previousStart) && item.localDate <= localDateKey(previousEnd));
  if (!recent) return 'Water intake: no saved intake entries in the last 7 days.';
  const previousAverage = previousRows.length ? previousRows.reduce((sum, item) => sum + item.glasses, 0) / previousRows.length : null;
  const daily = entries.filter((item) => item.localDate >= dayWindow(now, 7).from && item.localDate <= dayWindow(now, 7).through).map((item) => `${item.localDate}: ${item.glasses} glasses`).join('; ');
  return `Water intake (saved records only): last 7 days ${recent.averageGlasses.toFixed(1)} glasses/day average across ${recent.daysWithRecords} logged days${previousAverage === null ? '; no previous-week comparison is available' : `; previous 7 days ${previousAverage.toFixed(1)} glasses/day across ${previousRows.length} logged days`}${month ? `; 30-day average ${month.averageGlasses.toFixed(1)} glasses/day across ${month.daysWithRecords} logged days` : ''}. Recent entries: ${daily}. Missing days are not treated as zero. Water records do not establish a cause for skin changes.`;
}

function formulaFacts(products: ProductDetail[], profile?: SkinProfile) {
  const facts: string[] = [];
  const occurrences = new Map<string, Set<string>>();
  for (const product of products) {
    const formula = product.formulas[0];
    if (!formula) continue;
    for (const ingredient of formula.ingredients) {
      const name = (ingredient.inciName || ingredient.name).trim();
      const normalized = name.toLocaleLowerCase();
      if (!normalized) continue;
      const productNames = occurrences.get(normalized) || new Set<string>();
      productNames.add(product.name);
      occurrences.set(normalized, productNames);
    }
    const concerns = formula.analysis.filter((item) => item.kind === 'concern' && item.resolved).slice(0, 3).map((item) => `${item.label}${item.responsibleIngredients.length ? ` (${item.responsibleIngredients.slice(0, 3).map((ingredient) => ingredient.inciName || ingredient.name).join(', ')})` : ''}`);
    const match = profile ? scoreProductMatch(product, profile) : null;
    const personalized = match?.strongestConcerns.slice(0, 3).map((item) => `${item.label} (${item.ingredientNames.slice(0, 2).join(', ')})`) || [];
    facts.push(`${product.name} (${product.brand})${concerns.length ? ` catalog formula cautions: ${concerns.join('; ')}` : ' has no resolved catalog formula caution in the cached record'}${personalized.length ? `; app profile-match caution signals: ${personalized.join('; ')}` : ''}.`);
  }
  const overlaps = [...occurrences].filter(([, names]) => names.size > 1).slice(0, 8).map(([name, names]) => `${name} appears in ${[...names].join(' and ')}`);
  if (overlaps.length) facts.push(`Exact shared listed ingredients across cached routine products: ${overlaps.join('; ')}. Shared ingredients alone do not establish irritation or risk.`);
  return facts;
}

export function buildInvestigatorFacts(input: {
  checks: DailySkinCheck[];
  water: WaterHistoryEntry[];
  routine: RoutineSnapshot;
  products: ProductDetail[];
  profile?: SkinProfile;
  question: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const question = input.question.toLocaleLowerCase();
  const skinQuestion = /skin|red|irrit|dry|acne|breakout|pimple|oil|rating|trend|feel|worse|better/i.test(question) || /yesterday.*today|today.*yesterday/i.test(question);
  const skinChangeQuestion = /skin|redness|irrit|dry|acne|breakout|oiliness/i.test(question) && /why|after|since|started|changed|worse|increase|today|recent/i.test(question);
  const routineQuestion = /routine|use|used|skip|skipped|consistent|overlap|ingredient|product|tonight|morning|evening|am |pm /i.test(question) || skinChangeQuestion;
  const waterQuestion = /water intake|water|glasses|drinking|drink more/i.test(question);
  const facts: string[] = [];
  if (!input.checks.length && skinQuestion) facts.push('No local skin-check records are available for this question.');
  if (!input.water.length && waterQuestion) facts.push('No local water-intake records are available for this question; missing records are not zero intake.');
  if (skinQuestion) {
    facts.push(skinTrendFact(input.checks, 7, now), skinTrendFact(input.checks, 30, now));
    facts.push(...eventFacts(input.checks));
  }
  if (routineQuestion) facts.push(...routineFacts(input.routine, now), ...formulaFacts(input.products, input.profile));
  if (waterQuestion) facts.push(waterFact(input.water, now));
  if (question.includes('yesterday') && question.includes('today')) {
    const ordered = [...input.checks].sort((a, b) => a.localDate.localeCompare(b.localDate));
    const todayKey = localDateKey(now);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    yesterday.setDate(yesterday.getDate() - 1);
    const priorKey = localDateKey(yesterday);
    const a = ordered.find((item) => item.localDate === priorKey);
    const b = ordered.find((item) => item.localDate === todayKey);
    if (a && b) {
      const changes = (['acne', 'redness', 'dryness', 'oiliness', 'irritation'] as const)
        .map((metric) => `${metric} ${a.ratings[metric]} to ${b.ratings[metric]} (${deltaLabel(b.ratings[metric] - a.ratings[metric])})`).join('; ');
      facts.push(`Recorded yesterday-to-today ratings (${priorKey} to ${todayKey}): ${changes}. Ratings describe the user's report, not a diagnosis.`);
    } else facts.push('A complete pair of yesterday and today skin-check ratings is not available locally.');
  }
  return facts;
}
