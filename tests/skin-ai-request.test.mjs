import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIRequest } from '../src/skin-ai/context-builder.ts';

const message = (role, text) => ({ id: `${role}-${text}`, role, text, createdAt: '2026-04-08T12:00:00.000Z' });

test('request builder preserves recent multi-turn chat and appends local facts', () => {
  const history = [message('user', 'one'), message('assistant', 'two'), message('user', 'three'), message('assistant', 'four'), message('user', 'five')];
  const request = buildAIRequest('follow up', [], history, { personalFacts: ['Recorded dryness ratings rose by one point.'] });
  assert.deepEqual(request.history.map((item) => item.content), ['two', 'three', 'four', 'five']);
  assert.deepEqual(request.context.personalFacts, ['Recorded dryness ratings rose by one point.']);
});

test('manual selection takes precedence and photo paths stay out of ordinary context', () => {
  const photo = { id: 'photo-1', type: 'progress-photo', label: 'Today photo', summary: 'local photo', sourceId: '2026-04-08', selectedByUser: true, localPhotoUri: 'file:///private/skin.jpg' };
  const product = { id: 'product-1', type: 'product-evidence', label: 'Selected item', summary: 'Known item', sourceId: 3, selectedByUser: true, data: { name: 'Selected product', ingredientNames: ['Glycerin'], hasParsedFormula: true } };
  const request = buildAIRequest('compare this', [photo, product], [], { product: [{ name: 'Automatically retrieved item' }], photoAnalysisStatus: 'Text-only model.' });
  assert.equal(request.context.product.name, 'Selected product');
  assert.equal(request.context.photos[0].label, 'Today photo');
  assert.equal(JSON.stringify(request.context).includes('file:///private/skin.jpg'), false);
  assert.deepEqual(request.explicitlyAttachedPhotoRefs, ['file:///private/skin.jpg']);
});

test('catalog evidence text is preserved so its citation can support formula claims', () => {
  const formula = `Exact cached formula ingredients: ${Array.from({length: 35}, (_, index) => `INGREDIENT_${index + 1}`).join('; ')}.`;
  const request = buildAIRequest('Which ingredients are listed?', [], [], {
    catalogEvidence: [{ title: 'Exact product formula', text: formula, source: 'SkinDecode product/formula database' }],
  });
  assert.equal(request.context.catalogEvidence[0].text, formula);
  assert.match(request.context.catalogEvidence[0].text, /INGREDIENT_35/);
});

test('routine and shelf comparisons receive cached formula and profile-match evidence', () => {
  const shelf = {
    id: 'shelf-1', type: 'shelf', label: 'My Shelf', summary: '2 saved products', sourceId: 'user-1', selectedByUser: true,
    data: { products: [{ productId: 11, name: 'Calm Cream' }, { productId: 12, name: 'Daily Gel' }] },
  };
  const cached = [
    { productId: 11, name: 'Calm Cream', brand: 'A', formulaAvailable: true, ingredients: [{ name: 'Glycerin' }], formulaFindings: [{ label: 'Barrier support', kind: 'benefit', ingredients: ['Ceramide'] }], skinMatch: { score: 82, confidence: 'high', positives: ['barrier support'], concerns: [] } },
    { productId: 12, name: 'Daily Gel', brand: 'B', formulaAvailable: true, ingredients: [{ name: 'Niacinamide' }], formulaFindings: [{ label: 'Oil control', kind: 'benefit', ingredients: ['Niacinamide'] }], skinMatch: { score: 76, confidence: 'medium', positives: ['oiliness'], concerns: ['sensitivity'] } },
  ];
  const request = buildAIRequest('Compare these products for my skin', [shelf], [], { 'local-product-cache': cached });
  assert.deepEqual(request.context.product.map((item) => item.name), ['Calm Cream', 'Daily Gel']);
  assert.deepEqual(request.context.product[0].ingredients, ['Glycerin']);
  assert.equal(request.context.product[0].skinMatch.score, 82);
  assert.equal(request.context.product[1].formulaFindings[0].label, 'Oil control');
});

test('routine comparison only promotes products actually referenced by attached routine steps', () => {
  const routine = {
    id: 'routine-1', type: 'routine', label: 'My Routine', summary: 'AM and PM', sourceId: 1, selectedByUser: true,
    data: { steps: [{ name: 'Cleanser', productId: 21, period: 'am' }, { name: 'Moisturizer', productId: 22, period: 'pm' }] },
  };
  const request = buildAIRequest('What is the difference between these?', [routine], [], {
    'local-product-cache': [
      { productId: 21, name: 'Cleanser', ingredients: [{ name: 'Glycerin' }], formulaAvailable: true },
      { productId: 22, name: 'Moisturizer', ingredients: [{ name: 'Ceramide' }], formulaAvailable: true },
      { productId: 99, name: 'Unrelated saved product', ingredients: [{ name: 'Retinol' }], formulaAvailable: true },
    ],
  });
  assert.deepEqual(request.context.product.map((item) => item.productId), [21, 22]);
});
