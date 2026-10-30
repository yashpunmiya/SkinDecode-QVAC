import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductComparison, isGroundedProductComparisonResponse, routineShelfComparisonLimitation } from '../src/skin-ai/product-comparison.ts';

const request = (question, products, extra = {}) => ({
  systemPrompt: '', question, context: { product: products, ...extra }, history: [],
});

test('product comparison uses catalog formula signals and deterministic app match scores', () => {
  const answer = buildProductComparison(request('Which facewash is better?', [
    { name: 'Foam Cleanser A', brand: 'Brand A', formulaAvailable: true, formulaFindings: [{ label: 'Hydrating', kind: 'benefit', ingredients: ['Glycerin'] }], skinMatch: { score: 82, confidence: 'high', positives: ['Hydrating'], concerns: [] } },
    { name: 'Cleanser B', brand: 'Brand B', formulaAvailable: true, formulaFindings: [{ label: 'Can worsen irritation', kind: 'concern', ingredients: ['Fragrance'] }], skinMatch: { score: 61, confidence: 'medium', positives: [], concerns: ['Irritation risk'] } },
  ]));
  assert.match(answer, /Foam Cleanser A/);
  assert.match(answer, /Glycerin/);
  assert.match(answer, /Fragrance/);
  assert.match(answer, /82\/100 versus 61\/100/);
});

test('comparison refuses to invent a personalized winner when score evidence is missing', () => {
  const answer = buildProductComparison(request('Compare these products', [
    { name: 'Product A', formulaAvailable: true, formulaFindings: [{ label: 'Hydrating', kind: 'benefit', ingredients: ['Glycerin'] }] },
    { name: 'Product B', formulaAvailable: false, formulaFindings: [] },
  ]));
  assert.match(answer, /cannot responsibly pick a personalized winner/);
  assert.match(answer, /does not have a calculated Skin Match for every selected product/);
});

test('non-comparison question stays on the conversational model path', () => {
  assert.equal(buildProductComparison(request('Tell me about this cleanser', [{ name: 'A' }, { name: 'B' }])), null);
});

test('comparison response guard accepts evidence-linked discussion and rejects invented product facts', () => {
  const req = request('Compare these products', [
    { name: 'Barrier Calm Cream', formulaAvailable: true, formulaFindings: [{ label: 'Barrier support', kind: 'benefit', ingredients: ['Ceramide'] }], skinMatch: { score: 82, confidence: 'high', positives: ['barrier support'], concerns: [] } },
    { name: 'Daily Balance Gel', formulaAvailable: true, formulaFindings: [{ label: 'Oil control', kind: 'benefit', ingredients: ['Niacinamide'] }], skinMatch: { score: 76, confidence: 'medium', positives: ['oiliness'], concerns: ['sensitivity'] } },
  ]);
  assert.equal(isGroundedProductComparisonResponse('Barrier Calm Cream has an app match score of 82/100 with a barrier support signal. Daily Balance Gel scores 76/100 and includes an oil control signal, though its sensitivity caution means the records do not establish which one you will tolerate better.', req), true);
  assert.equal(isGroundedProductComparisonResponse('Barrier Calm Cream has 20% vitamin C. Daily Balance Gel has 30% retinol and is more effective.', req), false);
  assert.equal(isGroundedProductComparisonResponse('Barrier Calm Cream should be replaced with a stronger serum. Daily Balance Gel is the better choice.', req), false);
  assert.equal(isGroundedProductComparisonResponse('Barrier Calm Cream is a better choice than another serum.', req), false);
});

test('routine and shelf comparisons do not reach the model without two parsed product formulas', () => {
  const routineRequest = {
    ...request('Compare my routine products', [
      { name: 'Cleanser', formulaAvailable: false },
      { name: 'Moisturizer', formulaAvailable: false },
    ]),
    context: { routine: { steps: [{ name: 'Cleanser' }, { name: 'Moisturizer' }] }, product: [
      { name: 'Cleanser', formulaAvailable: false }, { name: 'Moisturizer', formulaAvailable: false },
    ] },
  };
  assert.match(routineShelfComparisonLimitation(routineRequest), /parsed formula records for two identified products/);
  routineRequest.context.product = [
    { name: 'Cleanser', formulaAvailable: true }, { name: 'Moisturizer', formulaAvailable: true },
  ];
  assert.equal(routineShelfComparisonLimitation(routineRequest), null);
  assert.equal(routineShelfComparisonLimitation(request('Compare these products', [
    { name: 'A', formulaAvailable: true }, { name: 'B', formulaAvailable: true },
  ])), null);
});

test('a one-product comparison cannot fall through to model-generated formula claims', () => {
  const req = request('Compare this product with others in my routine', [
    { name: 'Attached cleanser', formulaAvailable: true, ingredients: ['Glycerin'] },
  ]);
  assert.match(routineShelfComparisonLimitation(req), /parsed formula records for two identified products/);
  assert.equal(routineShelfComparisonLimitation(request('Compare these two products', [
    { name: 'A', formulaAvailable: true }, { name: 'B', formulaAvailable: true },
  ])), null);
});
