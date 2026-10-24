export const SKIN_CHECK_METRICS = ['acne', 'redness', 'dryness', 'oiliness', 'irritation'] as const;
export type SkinCheckMetric = typeof SKIN_CHECK_METRICS[number];
export type MetricRatings = Record<SkinCheckMetric, number>;
export type MetricTrend = 'clearly_improved' | 'slightly_improved' | 'stable' | 'slightly_worse' | 'clearly_worse';
export type OverallStatus = 'improved' | 'stable' | 'mixed' | 'worse';

export type DailySkinCheck = {
  userId: string;
  localDate: string;
  ratings: MetricRatings;
  amRoutineCompleted: boolean;
  pmRoutineCompleted: boolean;
  newProductStarted: boolean;
  photoUri: string | null;
  updatedAt: string;
};

export type DailyRoutineContext = {
  yesterdayAmCompleted: boolean;
  yesterdayPmCompleted: boolean;
  todayAmCompleted: boolean;
  todayPmCompleted: boolean;
  newProductStarted: boolean;
};

export type MetricChange = {
  metric: SkinCheckMetric;
  yesterday: number;
  today: number;
  delta: number;
  trend: MetricTrend;
};

export type DailySkinComparison = {
  overallStatus: OverallStatus;
  primaryMetric: SkinCheckMetric | 'routine_consistency' | 'overall' | null;
  title: string;
  summary: string;
  suggestion: string;
  supportingChanges: string[];
  severity: 'none' | 'slight' | 'clear';
  newProductWatch: boolean;
  routineContext: {
    yesterdayAmCompleted: boolean;
    yesterdayPmCompleted: boolean;
    todayAmCompleted: boolean;
    todayPmCompleted: boolean;
    newProductStarted: boolean;
  };
  metricChanges: MetricChange[];
};

export function trendForDelta(delta: number): MetricTrend {
  if (delta <= -2) return 'clearly_improved';
  if (delta === -1) return 'slightly_improved';
  if (delta === 0) return 'stable';
  if (delta === 1) return 'slightly_worse';
  return 'clearly_worse';
}

const METRIC_PRIORITY: Record<SkinCheckMetric, number> = {
  irritation: 0,
  redness: 1,
  dryness: 2,
  acne: 3,
  oiliness: 4,
};

const METRIC_LABEL: Record<SkinCheckMetric, string> = {
  acne: 'Breakouts',
  redness: 'Redness',
  dryness: 'Dryness',
  oiliness: 'Oiliness',
  irritation: 'Irritation',
};

type SkinCheckEntry = Pick<DailySkinCheck,
  'ratings' | 'amRoutineCompleted' | 'pmRoutineCompleted' | 'newProductStarted'>;

function formatChange(change: MetricChange) {
  const direction = change.delta < 0 ? 'improved' : 'increased';
  return `${METRIC_LABEL[change.metric]} ${direction} (${change.delta > 0 ? '+' : ''}${change.delta}).`;
}

function positiveSummary(improvements: MetricChange[]) {
  if (improvements.length > 1) return 'Several skin concerns improved since yesterday.';
  if (improvements.length === 1) return `${METRIC_LABEL[improvements[0]!.metric]} improved since yesterday.`;
  return 'Your skin looks stable today.';
}

function suggestionForWorsening(metric: SkinCheckMetric, delta: number, recentlyChanged: boolean, yesterdayPmMissed: boolean) {
  if (metric === 'irritation') {
    if (recentlyChanged) return 'You recently changed your routine and irritation increased. The new product may be worth watching. Keep tonight simple.';
    if (delta >= 2) return 'Your skin feels more irritated today. Keep tonight simple: gentle cleanse + moisturizer, and skip optional actives.';
    return 'Irritation is slightly higher today. Keep your routine gentle and watch how your skin feels tomorrow.';
  }
  if (metric === 'redness') {
    if (delta >= 2) return 'Redness increased today. Use a simple, calming routine and avoid unnecessary actives tonight.';
    return 'Redness is slightly higher today. Keep things gentle and monitor it tomorrow.';
  }
  if (metric === 'dryness') {
    if (yesterdayPmMissed) return 'Your skin is drier today and last night’s routine was missed. Consistency with moisturizer may help.';
    if (delta >= 2) return 'Your skin feels much drier today. Prioritize moisturizer and avoid extra cleansing tonight.';
    return 'Skin is slightly drier today. Add a little more moisture and keep cleansing gentle.';
  }
  if (metric === 'acne') {
    if (recentlyChanged) return 'Breakouts increased after a recent routine change. Keep tracking before deciding whether the new product is a problem.';
    if (delta >= 2) return 'Breakouts increased today. Don’t change everything at once—track this for the next 2–3 check-ins.';
    return 'Acne is slightly worse today. Stay consistent and avoid adding multiple new products.';
  }
  if (delta >= 2) return 'Your skin feels much oilier today. Avoid over-cleansing—stick to your normal routine.';
  return 'Oiliness is slightly higher today. Stay consistent rather than adding extra cleansing.';
}

function suggestionForImprovement(metric: SkinCheckMetric) {
  if (metric === 'irritation') return 'Irritation has improved. Keep your routine consistent and avoid changing too much at once.';
  if (metric === 'redness') return 'Redness improved today. Keep doing what is working.';
  if (metric === 'dryness') return 'Dryness improved. Keep your hydration routine consistent.';
  if (metric === 'acne') return 'Breakouts look better today. Keep your current routine consistent.';
  return 'Oiliness improved today. Keep your routine steady.';
}

export function compareDailySkinChecks(
  yesterday: SkinCheckEntry | null | undefined,
  today: SkinCheckEntry | null | undefined,
  context?: DailyRoutineContext,
): DailySkinComparison | null {
  if (!yesterday || !today) return null;

  const metricChanges = SKIN_CHECK_METRICS.map((metric) => {
    const delta = today.ratings[metric] - yesterday.ratings[metric];
    return { metric, yesterday: yesterday.ratings[metric], today: today.ratings[metric], delta, trend: trendForDelta(delta) };
  });
  const worsened = metricChanges.filter((change) => change.delta > 0)
    .sort((a, b) => (b.delta - a.delta) || (METRIC_PRIORITY[a.metric] - METRIC_PRIORITY[b.metric]));
  const improved = metricChanges.filter((change) => change.delta < 0)
    .sort((a, b) => (METRIC_PRIORITY[a.metric] - METRIC_PRIORITY[b.metric]));
  const overallStatus: OverallStatus = worsened.length === 0
    ? (improved.length ? 'improved' : 'stable')
    : improved.length ? 'mixed' : 'worse';
  const routineContext: DailyRoutineContext = context || {
    yesterdayAmCompleted: yesterday.amRoutineCompleted,
    yesterdayPmCompleted: yesterday.pmRoutineCompleted,
    todayAmCompleted: today.amRoutineCompleted,
    todayPmCompleted: today.pmRoutineCompleted,
    newProductStarted: today.newProductStarted || yesterday.newProductStarted,
  };
  const newProductWatch = Boolean(worsened.some((change) => change.metric === 'irritation' || change.metric === 'acne')
    && routineContext.newProductStarted);

  let primaryMetric: DailySkinComparison['primaryMetric'] = null;
  let title = 'Skin check';
  let summary = positiveSummary(improved);
  let suggestion = 'Your skin looks stable today. Keep your routine consistent.';
  let severity: DailySkinComparison['severity'] = 'none';

  // A broad improvement should read as progress when only one area moved slightly upward.
  const broadImprovementWithOneSmallDip = worsened.length === 1 && worsened[0]!.delta === 1 && improved.length >= 3;
  if (broadImprovementWithOneSmallDip) {
    primaryMetric = worsened[0]!.metric;
    title = 'Trending better';
    summary = 'Overall, your skin is trending better. One area changed slightly.';
    suggestion = 'Overall, your skin is trending better. One area changed slightly, so keep monitoring without changing your routine yet.';
    severity = 'slight';
  } else if (worsened.length) {
    const primary = worsened[0]!;
    primaryMetric = primary.metric;
    title = `${METRIC_LABEL[primary.metric]} ${primary.delta >= 2 ? 'increased' : 'slightly higher'}`;
    summary = formatChange(primary);
    suggestion = suggestionForWorsening(primary.metric, primary.delta, newProductWatch, !routineContext.yesterdayPmCompleted);
    severity = primary.delta >= 2 ? 'clear' : 'slight';
  } else {
    // Consistency is a higher-priority prompt than the general stable/improved message.
    if (!routineContext.yesterdayAmCompleted) {
      primaryMetric = 'routine_consistency';
      title = 'Restart your rhythm';
      summary = 'Your morning routine was missed yesterday.';
      suggestion = 'You missed your morning routine yesterday. Try getting back to your usual routine today.';
    } else if (!routineContext.yesterdayPmCompleted) {
      primaryMetric = 'routine_consistency';
      title = 'A steady evening helps';
      summary = 'Your evening routine was missed yesterday.';
      suggestion = 'You missed your evening routine yesterday. A consistent night routine may help.';
    } else {
      primaryMetric = improved.length ? improved[0]!.metric : 'overall';
      title = improved.length ? 'Good consistency' : 'Skin looks steady';
      summary = positiveSummary(improved);
      suggestion = improved.length > 1
        ? 'Several skin concerns improved since yesterday. Keep your routine steady and avoid unnecessary changes.'
        : improved.length === 1
          ? 'You stayed consistent with your routine. Keep it going.'
          : 'Your skin looks stable today. Keep your routine consistent.';
    }
  }

  const supportingChanges = metricChanges
    .filter((change) => change.metric !== primaryMetric && change.delta !== 0)
    .sort((a, b) => (Math.abs(b.delta) - Math.abs(a.delta)) || (METRIC_PRIORITY[a.metric] - METRIC_PRIORITY[b.metric]))
    .slice(0, 2)
    .map(formatChange);

  // When both upper-priority symptoms rise, state the second one as context without changing advice.
  if (primaryMetric === 'irritation' && worsened.some((change) => change.metric === 'redness')
    && !supportingChanges.some((change) => change.startsWith('Redness'))) {
    supportingChanges.unshift(formatChange(worsened.find((change) => change.metric === 'redness')!));
    supportingChanges.splice(2);
  }

  return {
    overallStatus,
    primaryMetric,
    title,
    summary,
    suggestion,
    supportingChanges,
    severity,
    newProductWatch,
    routineContext,
    metricChanges,
  };
}

export const SKIN_CHECK_METRIC_LABELS = METRIC_LABEL;
