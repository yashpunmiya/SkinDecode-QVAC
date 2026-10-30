import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSkinTrend, calculateWaterTrend } from '../src/skin-ai/analysis-metrics.ts';
import { buildInvestigatorFacts } from '../src/skin-ai/investigator.ts';
import { renderRetrievedCatalogSources } from '../src/skin-ai/evidence-format.ts';

const check = (date, overrides = {}) => ({
  userId: 'demo-user', localDate: date,
  ratings: { acne: 2, redness: 2, dryness: 2, oiliness: 2, irritation: 2, ...overrides },
  amRoutineCompleted: false, pmRoutineCompleted: false, newProductStarted: false,
  photoUri: null, updatedAt: `${date}T12:00:00.000Z`,
});

test('skin trends use recorded values only and keep direction explicit', () => {
  const history = [
    check('2026-04-03', { dryness: 2, redness: 3 }),
    check('2026-04-06', { dryness: 4, redness: 2 }),
    check('2026-03-10', { dryness: 5 }),
  ];
  const dryness = calculateSkinTrend(history, 7, new Date(2026, 3, 8)).find((item) => item.metric === 'dryness');
  assert.deepEqual({ count: dryness.count, average: dryness.average, first: dryness.first, last: dryness.last, delta: dryness.delta },
    { count: 2, average: 3, first: 2, last: 4, delta: 2 });
  assert.equal(calculateSkinTrend([check('2026-04-07')], 7, new Date(2026, 3, 8)).length, 0);
});

test('water averages exclude unlogged days and do not treat missing as zero', () => {
  const result = calculateWaterTrend([
    { localDate: '2026-04-02', glasses: 4 },
    { localDate: '2026-04-07', glasses: 8 },
    { localDate: '2026-03-01', glasses: 0 },
  ], 7, new Date(2026, 3, 8));
  assert.deepEqual(result, { daysWithRecords: 2, averageGlasses: 6, totalGlasses: 12 });
  assert.equal(calculateWaterTrend([], 7, new Date(2026, 3, 8)), null);
});

test('investigator marks missing history and does not create an explanation from absent records', () => {
  const facts = buildInvestigatorFacts({
    checks: [], water: [], routine: { routines: [], steps: [], logs: [] }, products: [],
    question: 'Why is my skin drier today and did water change?', now: new Date(2026, 3, 8),
  });
  assert.ok(facts.some((fact) => fact.includes('No local skin-check records')));
  assert.ok(facts.some((fact) => fact.includes('missing records are not zero intake')));
  assert.ok(!facts.some((fact) => /caused|because.*water/i.test(fact)));
});

test('new-product timing is described as an association, not a cause', () => {
  const facts = buildInvestigatorFacts({
    checks: [check('2026-04-07', { irritation: 1 }), { ...check('2026-04-08', { irritation: 4 }), newProductStarted: true }],
    water: [], routine: { routines: [], steps: [], logs: [] }, products: [], question: 'Why did irritation increase after a new product?', now: new Date(2026, 3, 8),
  });
  assert.ok(facts.some((fact) => fact.includes('timing alone cannot show cause')));
});

test('evidence references are limited to locally retrieved source records', () => {
  assert.equal(renderRetrievedCatalogSources(undefined), '');
  const sources = renderRetrievedCatalogSources([
    { title: 'Ingredient entry', source: 'Local catalog', sourceUrl: 'https://example.test/item' },
    null,
  ]);
  assert.match(sources, /\[E1\] Ingredient entry — Local catalog: https:\/\/example\.test\/item/);
  assert.doesNotMatch(sources, /\[E2\]/);
});
