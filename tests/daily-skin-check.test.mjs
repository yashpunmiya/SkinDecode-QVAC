import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDailySkinChecks, SKIN_CHECK_METRICS, trendForDelta } from '../src/daily-skin-check/rules.ts';
import { buildDailyRoutineContext } from '../src/daily-skin-check/routine-context.ts';

const baseline = {
  ratings: { acne: 3, redness: 3, dryness: 3, oiliness: 3, irritation: 3 },
  amRoutineCompleted: true,
  pmRoutineCompleted: true,
  newProductStarted: false,
};

const entry = (overrides = {}) => ({ ...baseline, ...overrides, ratings: { ...baseline.ratings, ...(overrides.ratings || {}) } });
const compare = (yesterday = entry(), today = entry()) => compareDailySkinChecks(yesterday, today);

test('each metric interprets improving and worsening ratings consistently', () => {
  for (const metric of SKIN_CHECK_METRICS) {
    assert.equal(compare(entry(), entry({ ratings: { [metric]: 1 } })).metricChanges.find((item) => item.metric === metric).trend, 'clearly_improved');
    assert.equal(compare(entry(), entry({ ratings: { [metric]: 4 } })).metricChanges.find((item) => item.metric === metric).trend, 'slightly_worse');
    assert.equal(compare(entry(), entry({ ratings: { [metric]: 5 } })).metricChanges.find((item) => item.metric === metric).trend, 'clearly_worse');
  }
  assert.equal(trendForDelta(-1), 'slightly_improved');
  assert.equal(trendForDelta(0), 'stable');
});

test('+1 is mild and +2 is clear worsening', () => {
  const slight = compare(entry(), entry({ ratings: { redness: 4 } }));
  const clear = compare(entry(), entry({ ratings: { redness: 5 } }));
  assert.equal(slight.severity, 'slight');
  assert.equal(slight.metricChanges.find((item) => item.metric === 'redness').trend, 'slightly_worse');
  assert.equal(clear.severity, 'clear');
  assert.equal(clear.metricChanges.find((item) => item.metric === 'redness').trend, 'clearly_worse');
});

test('multiple simultaneous worsening changes resolve deterministically by severity then priority', () => {
  const result = compare(entry(), entry({ ratings: { irritation: 5, redness: 5, acne: 5 } }));
  assert.equal(result.primaryMetric, 'irritation');
  assert.equal(result.overallStatus, 'worse');
  assert.ok(result.supportingChanges.some((item) => item.startsWith('Redness')));
  assert.equal(compare(entry(), entry({ ratings: { redness: 5, acne: 5 } })).primaryMetric, 'redness');
});

test('irritation outranks redness and both changes remain visible without conflicting advice', () => {
  const result = compare(entry(), entry({ ratings: { irritation: 5, redness: 4 } }));
  assert.equal(result.primaryMetric, 'irritation');
  assert.match(result.suggestion, /Keep tonight simple/);
  assert.ok(result.supportingChanges.some((item) => item.startsWith('Redness')));
});

test('dryness wins the dryness/oiliness conflict and never recommends stronger cleansing', () => {
  const result = compare(entry(), entry({ ratings: { dryness: 5, oiliness: 5 } }));
  assert.equal(result.primaryMetric, 'dryness');
  assert.match(result.suggestion, /avoid extra cleansing/);
  assert.doesNotMatch(result.suggestion, /stronger cleansing|cleanse more/i);
});

test('acne worsening with a new product advises observation without claiming cause or purging', () => {
  const result = compare(entry(), entry({ newProductStarted: true, ratings: { acne: 5 } }));
  assert.equal(result.primaryMetric, 'acne');
  assert.equal(result.newProductWatch, true);
  assert.match(result.suggestion, /Keep tracking before deciding whether the new product is a problem/);
  assert.doesNotMatch(result.suggestion, /caused|purging|clogging/i);
});

test('dryness and a missed previous PM routine use the contextual moisturizer advice', () => {
  const result = compare(entry({ pmRoutineCompleted: false }), entry({ ratings: { dryness: 4 } }));
  assert.equal(result.primaryMetric, 'dryness');
  assert.match(result.suggestion, /last night’s routine was missed/);
  assert.match(result.suggestion, /moisturizer/);
});

test('all stable metrics produce a stable, non-alarmist suggestion', () => {
  const result = compare();
  assert.equal(result.overallStatus, 'stable');
  assert.equal(result.primaryMetric, 'overall');
  assert.equal(result.suggestion, 'Your skin looks stable today. Keep your routine consistent.');
});

test('all improved metrics are represented as an overall improvement', () => {
  const result = compare(entry(), entry({ ratings: { acne: 1, redness: 2, dryness: 1, oiliness: 2, irritation: 1 } }));
  assert.equal(result.overallStatus, 'improved');
  assert.match(result.summary, /Several skin concerns improved/);
  assert.equal(result.suggestion, 'Several skin concerns improved since yesterday. Keep your routine steady and avoid unnecessary changes.');
  assert.ok(result.metricChanges.every((change) => change.delta < 0));
});

test('one slight worsening with most areas improved is described as an overall positive trend', () => {
  const result = compare(entry(), entry({ ratings: { acne: 2, redness: 2, dryness: 4, oiliness: 2, irritation: 2 } }));
  assert.equal(result.overallStatus, 'mixed');
  assert.equal(result.primaryMetric, 'dryness');
  assert.match(result.title, /Trending better/);
  assert.equal(result.suggestion, 'Overall, your skin is trending better. One area changed slightly, so keep monitoring without changing your routine yet.');
});

test('no yesterday or no today returns no comparison instead of inventing a state', () => {
  assert.equal(compareDailySkinChecks(null, entry()), null);
  assert.equal(compareDailySkinChecks(entry(), null), null);
});

test('routine completion and recent product additions are inferred from local routine data', () => {
  const now = new Date(2026, 9, 6, 12);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const snapshot = {
    routines: [{ id: 'r1', isActive: true, deletedAt: null }],
    steps: [
      { id: 'am1', routineId: 'r1', enabled: true, deletedAt: null, period: 'am', daysOfWeek: [yesterday.getDay(), now.getDay()], productId: 42, shelfItemId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 'pm1', routineId: 'r1', enabled: true, deletedAt: null, period: 'pm', daysOfWeek: [yesterday.getDay()], productId: null, shelfItemId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    ],
    logs: [{ id: 'l1', stepId: 'am1', logDate: dateKey, status: 'completed', deletedAt: null }],
  };
  const result = buildDailyRoutineContext(snapshot, now);
  assert.equal(result.yesterdayAmCompleted, true);
  assert.equal(result.yesterdayPmCompleted, false);
  assert.equal(result.todayAmCompleted, false);
  assert.equal(result.newProductStarted, true);

  snapshot.steps[0].createdAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  snapshot.steps[0].updatedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(buildDailyRoutineContext(snapshot, now).newProductStarted, false);
});

test('automatically derived routine context overrides saved snapshots for comparison', () => {
  const context = {
    yesterdayAmCompleted: true,
    yesterdayPmCompleted: true,
    todayAmCompleted: false,
    todayPmCompleted: false,
    newProductStarted: true,
  };
  const result = compareDailySkinChecks(
    entry({ newProductStarted: false }),
    entry({ newProductStarted: false, ratings: { acne: 5 } }),
    context,
  );
  assert.equal(result.routineContext.newProductStarted, true);
  assert.match(result.suggestion, /recent routine change/);
});

