import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSuitabilityAnswer, buildProductSuitabilityModelRequest, isGroundedProductSuitabilityResponse } from '../src/skin-ai/product-analysis.ts';

const baseRequest = (question, product) => ({
  systemPrompt: '', question, history: [],
  context: {
    'skin-profile': { skinType: 'oily', sensitivity: 'high', concerns: ['acne'] },
    product,
    catalogEvidence: [{
      title: 'Barrier Repair Face Wash · Dot & Key',
      text: 'Exact cached formula ingredients: Glycerin — functions recorded: humectant; Sodium Laureth Sulfate — functions recorded: cleansing agent. Resolved catalog findings: concern: potential irritation (Sodium Laureth Sulfate).',
      source: 'SkinDecode product/formula database',
    }],
  },
});

test('personal product suitability answers use app score, linked signals, and the matching product citation', () => {
  const answer = buildProductSuitabilityAnswer(baseRequest('Which ingredients won\'t suit my skin?', {
    productId: 48, name: 'Barrier Repair Face Wash', brand: 'Dot & Key', formulaAvailable: true,
    ingredients: ['Glycerin', 'Sodium Laureth Sulfate'],
    skinMatch: {
      score: 34, confidence: 'low', concerns: ['Potential irritation signal'], positives: ['Humectant support'],
      cautionEvidence: [
        { label: 'Synthetic Fragrance', ingredients: ['PARFUM'] },
        { label: 'Fragrance', ingredients: ['PARFUM'] },
        { label: 'Potential irritation signal', ingredients: ['Sodium Laureth Sulfate'] },
      ],
      positiveEvidence: [{ label: 'Humectant support', ingredients: ['Glycerin'] }],
    },
  }));
  assert.match(answer, /34\/100 \(low match, low confidence\)/);
  assert.match(answer, /Sodium Laureth Sulfate/);
  assert.match(answer, /Synthetic Fragrance \/ Fragrance \(PARFUM\)/);
  assert.match(answer, /Humectant support \(Glycerin\)/);
  assert.doesNotMatch(answer, /Potential irritation signal \(Glycerin\)/);
  assert.match(answer, /\[E1\]/);
  assert.match(answer, /do not prove an ingredient will irritate you/);
  assert.doesNotMatch(answer, /photo|previous response|Ingredient 1|may not suit your skin type/);
});

test('missing match evidence does not invent an ingredient to avoid', () => {
  const answer = buildProductSuitabilityAnswer(baseRequest('Which ingredients won\'t suit my skin?', {
    productId: 48, name: 'Barrier Repair Face Wash', brand: 'Dot & Key', formulaAvailable: true,
    ingredients: ['Glycerin', 'Sodium Laureth Sulfate'],
  }));
  assert.match(answer, /no usable profile-match score/);
  assert.doesNotMatch(answer, /Sodium Laureth Sulfate|Potential irritation/);
});

test('general questions remain on the conversational model path', () => {
  assert.equal(buildProductSuitabilityAnswer(baseRequest('What does a cleanser do?', { name: 'Cleanser' })), null);
});

test('product follow-up prompt gives QVAC only the selected product/profile evidence, not prior assistant answers', () => {
  const request = baseRequest('Which ingredients are harmful for my skin?', {
    productId: 48, name: 'Barrier Repair Face Wash', brand: 'Dot & Key', formulaAvailable: true,
    ingredients: ['Glycerin', 'Sodium Laureth Sulfate'],
    skinMatch: { score: 58, confidence: 'high', concerns: ['Fragrance'], positives: ['Hydrating'] },
  });
  request.history = [{ role: 'assistant', content: 'Bad old output about photos and prior answers.' }];
  request.context['local-product-cache'] = [{ productId: 999, name: 'Unrelated product' }];
  const focused = buildProductSuitabilityModelRequest(request);
  assert.ok(focused);
  assert.deepEqual(focused.history, []);
  assert.equal(focused.context.product.name, 'Barrier Repair Face Wash');
  assert.equal(focused.context['local-product-cache'], undefined);
  assert.match(focused.systemPrompt, /Reason from the supplied product/);
});

test('model output guard rejects unrelated toxic-ingredient lists and fake context claims', () => {
  const input = baseRequest('Which ingredients are harmful for my skin?', {
    productId: 48, name: 'Barrier Repair Face Wash', brand: 'Dot & Key', ingredients: ['Glycerin'],
    skinMatch: { score: 58, confidence: 'high' },
  });
  input.context.catalogEvidence[0].text = 'Exact cached formula ingredients: Glycerin; PARFUM. Resolved catalog findings: Hydrating (Glycerin).';
  const request = buildProductSuitabilityModelRequest(input);
  assert.ok(request);
  assert.equal(isGroundedProductSuitabilityResponse('This cleanser scores 58/100. Sodium Laureth Sulfate and parabens may be harmful. [E1]', request), false);
  assert.equal(isGroundedProductSuitabilityResponse('I cannot inspect your photo or your 7-day ratings.', request), false);
  assert.equal(isGroundedProductSuitabilityResponse('This cleanser scores 58/100 for your profile. The app flags fragrance linked to PARFUM, balanced by hydration signals from glycerin. This is not proof of tolerance. [E1]', request), true);
  // A useful QVAC explanation must not be thrown away merely because the 1B
  // model missed a formatting requirement; the provider adds retrieved sources.
  assert.equal(isGroundedProductSuitabilityResponse('Fragrance is the clearest caution in this formula because the profile matcher links PARFUM with your sensitivity. Hydrating ingredients balance that concern, but the signal cannot predict your personal tolerance.', request), true);
});
