import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scoreProductMatch } from '../src/products/product-intelligence.ts';
import { CATALOG_ATTRIBUTE_KEYS } from '../src/products/intelligence-mapping.ts';

const catalog = JSON.parse(await readFile(new URL('./fixtures/product-intelligence-catalog.json', import.meta.url), 'utf8'));
const baseProfile = (values = {}) => ({
  ageRange: '25_34', skinType: 'normal', sensitivity: 'not_sure', concerns: [], goals: [], preferences: [], ...values,
});
const profiles = [
  ...['oily', 'dry', 'combination', 'normal', 'not_sure'].map((skinType) => baseProfile({ skinType })),
  ...['low', 'moderate', 'high', 'not_sure'].map((sensitivity) => baseProfile({ skinType: 'dry', sensitivity })),
  ...[
    ['acne', 'clear_acne'], ['dark_spots', 'even_tone'], ['redness', 'reduce_redness'],
    ['dryness', 'hydrate'], ['oiliness', 'maintain'], ['texture', 'smooth_texture'],
    ['pores', 'clear_acne'], ['fine_lines', 'anti_aging'], ['dullness', 'even_tone'],
  ].map(([concern, goal]) => baseProfile({ concerns: [concern], goals: [goal] })),
  ...[
    { concerns: ['redness'], goals: ['repair_barrier'], sensitivity: 'high' },
    { concerns: ['acne', 'pores'], goals: ['clear_acne'], skinType: 'oily', sensitivity: 'moderate' },
    { concerns: ['dryness', 'redness'], goals: ['hydrate', 'repair_barrier'], skinType: 'dry', sensitivity: 'high' },
    { concerns: ['fine_lines', 'dullness'], goals: ['anti_aging', 'even_tone'], skinType: 'normal' },
    { concerns: ['texture', 'dark_spots'], goals: ['smooth_texture', 'even_tone'], skinType: 'combination' },
    { goals: ['hydrate'], preferences: ['fragrance_free', 'avoid_alcohol'], skinType: 'dry' },
    { concerns: ['acne'], goals: ['clear_acne'], preferences: ['fragrance_free'], skinType: 'oily', sensitivity: 'high' },
    { concerns: ['redness'], goals: ['repair_barrier'], preferences: ['vegan', 'cruelty_free'], sensitivity: 'moderate' },
    { concerns: ['dark_spots'], goals: ['even_tone'], skinType: 'combination', sensitivity: 'low' },
    { concerns: ['pores', 'oiliness'], goals: ['clear_acne'], skinType: 'oily', sensitivity: 'not_sure' },
    { goals: ['anti_aging'], skinType: 'dry', sensitivity: 'moderate', preferences: ['avoid_alcohol'] },
    { concerns: ['texture'], goals: ['smooth_texture'], skinType: 'normal', sensitivity: 'high' },
  ].map(baseProfile),
];

const products = catalog.products.map((product) => ({
  ...product,
  formulas: product.formulas.map((formula) => ({
    ...formula,
    analysis: formula.analysis.map((item) => {
      const linked = item.resolved ? item.ingredientPositions.map((position) => formula.ingredients[position - 1]).filter(Boolean) : [];
      return { ...item, responsibleIngredients: linked, ingredientIds: linked.map((ingredient) => ingredient.id) };
    }),
  })),
}));

const score = (product, profile, formula) => scoreProductMatch(product, profile, formula);
const keys = (result, field) => new Set(result[field].flatMap((item) => [item.key, ...item.ingredientNames]));

test('calibration matrix uses 30 profiles and 80 validated real catalog products', () => {
  assert.equal(profiles.length, 30);
  assert.equal(products.length, 80);
  assert.ok(new Set(products.map((item) => item.category)).size >= 8);
  assert.ok(products.some((item) => item.formulas.length > 1), 'multi-formula products are represented');
  assert.ok(products.some((item) => item.formulas.every((formula) => formula.ingredients.length === 0)), 'no-INCI products are represented');
  assert.ok(products.some((item) => item.formulas.some((formula) => formula.analysis.some((entry) => !entry.resolved))), 'unresolved data is represented');
});

test('sensitivity calibration never rewards a sensitivity-linked irritation warning', (t) => {
  let comparable = 0;
  let differentiated = 0;
  for (const product of products) {
    const high = score(product, baseProfile({ sensitivity: 'high' }));
    const low = score(product, baseProfile({ sensitivity: 'low' }));
    const sensitiveWarnings = high.strongestConcerns.filter((entry) =>
      ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen', 'alcohol'].includes(entry.key),
    );
    if (!sensitiveWarnings.length) continue;
    comparable += 1;
    assert.notEqual(high.score, null, `${product.brand} ${product.name}: linked risk should be scorable`);
    assert.notEqual(low.score, null, `${product.brand} ${product.name}: linked risk should be scorable`);
    assert.ok(high.score <= low.score, `${product.brand} ${product.name}: high sensitivity ${high.score} > low ${low.score}`);
    if (high.score < low.score) differentiated += 1;
  }
  t.diagnostic(`products with sensitivity warning evidence=${comparable}; differentiated=${differentiated}`);
  assert.ok(comparable >= 8, 'fixture should contain enough real sensitivity warning examples');
  assert.ok(differentiated >= 3, 'scores should reflect materially different sensitivity risk');
  const andBeauty = products.find((product) => product.productId === 442);
  const andResult = score(andBeauty, baseProfile({ skinType: 'dry', sensitivity: 'high', concerns: ['redness'], goals: ['repair_barrier'] }));
  assert.equal(andResult.strongestConcerns.filter((item) => item.key === 'may_cause_irritation' && item.dimension === 'sensitivity').length, 1,
    'exact and generic causes should be combined into one readable reason');
});

test('adjacent sensitivity levels do not cause unstable jumps on the same real formulas', () => {
  let compared = 0;
  for (const product of products) {
    const profileAt = (sensitivity) => baseProfile({ skinType: 'not_sure', sensitivity });
    const low = score(product, profileAt('low'));
    const moderate = score(product, profileAt('moderate'));
    const high = score(product, profileAt('high'));
    if (low.subScores.sensitivity === null || moderate.subScores.sensitivity === null || high.subScores.sensitivity === null) continue;
    compared += 1;
    assert.ok(low.subScores.sensitivity >= moderate.subScores.sensitivity, `${product.name}: moderate sensitivity improved the risk score`);
    assert.ok(moderate.subScores.sensitivity >= high.subScores.sensitivity, `${product.name}: high sensitivity improved the risk score`);
    assert.ok(low.subScores.sensitivity - moderate.subScores.sensitivity <= 20, `${product.name}: low-to-moderate shift is unstable`);
    assert.ok(moderate.subScores.sensitivity - high.subScores.sensitivity <= 20, `${product.name}: moderate-to-high shift is unstable`);
  }
  assert.ok(compared >= 8);
});

test('dry profile hydration signals do not reduce a product versus otherwise identical neutral skin', () => {
  const dryProfile = baseProfile({ skinType: 'dry' });
  const neutralProfile = baseProfile({ skinType: 'not_sure' });
  let supported = 0;
  for (const product of products) {
    const dry = score(product, dryProfile);
    const neutral = score(product, neutralProfile);
    const positives = keys(dry, 'strongestPositives');
    const concerns = keys(dry, 'strongestConcerns');
    if (![...positives].some((key) => ['hydrating', 'helps_with_barrier_repair', 'ceramide', 'hyaluronic_acid', 'urea'].includes(key))) continue;
    if ([...concerns].some((key) => key === 'can_worsen_dry_skin')) continue;
    supported += 1;
    assert.notEqual(dry.subScores.skin_type, null, `${product.name}: dry evidence should populate skin type sub-score`);
    assert.ok(dry.subScores.skin_type >= 50, `${product.name}: hydration/barrier evidence should not lower dry-skin compatibility`);
  }
  assert.ok(supported >= 4, `expected dry-skin support examples, found ${supported}`);
});

test('oily and acne profiles receive the corresponding catalog warnings', () => {
  const profile = baseProfile({ skinType: 'oily', concerns: ['acne'], goals: ['clear_acne'] });
  const warnings = products.flatMap((product) => {
    const result = score(product, profile);
    return result.strongestConcerns.filter((item) => ['may_cause_acne', 'can_worsen_oily_skin'].includes(item.key)).map((item) => ({ product, result, item }));
  });
  assert.ok(warnings.length >= 3, `expected several oil/acne warning examples, found ${warnings.length}`);
  assert.ok(warnings.some(({ result }) => (result.subScores.concerns ?? 50) < 50), 'relevant acne and oil warnings should lower the concern sub-score');
});

test('a profile changes the same product score and catalog reasons in coherent directions', () => {
  let differentiated = 0;
  let hydrationSignals = 0;
  let acneSignals = 0;
  for (const product of products) {
    const dry = score(product, baseProfile({ skinType: 'dry', goals: ['hydrate', 'repair_barrier'] }));
    const oily = score(product, baseProfile({ skinType: 'oily', concerns: ['acne'], goals: ['clear_acne'] }));
    if (dry.score !== oily.score && dry.score !== null && oily.score !== null) differentiated += 1;
    if (dry.strongestPositives.some((item) => ['hydrating', 'helps_with_barrier_repair'].includes(item.key))) hydrationSignals += 1;
    if (oily.strongestConcerns.some((item) => ['may_cause_acne', 'can_worsen_oily_skin'].includes(item.key))) acneSignals += 1;
  }
  assert.ok(differentiated >= 30, `only ${differentiated} products differentiated these materially different profiles`);
  assert.ok(hydrationSignals > 0);
  assert.ok(acneSignals > 0);
});

test('incomplete and unresolved catalog records lower confidence without inferred ingredient claims', () => {
  const noInci = products.find((product) => product.productId === 19);
  const unresolved = products.find((product) => product.productId === 6);
  assert.ok(noInci, 'known no-INCI product should be present');
  assert.ok(unresolved, 'known unresolved product should be present');
  const noInciResult = score(noInci, baseProfile({ skinType: 'not_sure', sensitivity: 'not_sure' }));
  const unresolvedResult = score(unresolved, baseProfile({ skinType: 'dry', goals: ['hydrate'] }));
  assert.equal(noInciResult.scoreStatus, 'insufficient_data');
  assert.equal(noInciResult.confidence, 'none');
  assert.equal(noInciResult.strongestPositives.length + noInciResult.strongestConcerns.length, 0);
  assert.equal(unresolvedResult.evidenceCounts.exactFormula, 0);
  assert.ok(unresolvedResult.evidenceCounts.ingredientAttributes > 0, 'ingredient attributes remain valid weaker evidence even when formula links are unresolved');
  assert.notEqual(unresolvedResult.score, null, 'a parsed ingredient list with linked generic attributes can support a cautious score');
  assert.equal(unresolvedResult.confidence, 'low');
  assert.equal(unresolvedResult.scoreStatus, 'partial');
  assert.ok(unresolvedResult.evidenceCounts.unresolvedFormula > 0);
});

test('same-profile ranking separates stronger and weaker catalog evidence within product categories', (t) => {
  const benchmark = baseProfile({ skinType: 'dry', sensitivity: 'moderate', concerns: ['dryness', 'redness'], goals: ['hydrate', 'repair_barrier'] });
  const byCategory = new Map();
  for (const product of products) {
    const result = score(product, benchmark);
    if (!product.category || result.score === null) continue;
    const group = byCategory.get(product.category) || [];
    group.push({ product, result });
    byCategory.set(product.category, group);
  }
  const report = [];
  for (const [category, group] of byCategory) {
    const ranked = group.sort((a, b) => b.result.score - a.result.score || a.product.productId - b.product.productId);
    if (ranked.length < 2) continue;
    assert.ok(ranked[0].result.score >= ranked.at(-1).result.score);
    assert.ok(ranked[0].result.score - ranked.at(-1).result.score >= 10, `${category}: evidence ranking spread should be meaningful`);
    report.push({
      category, products: ranked.length,
      top: `${ranked[0].product.brand} ${ranked[0].product.name}`,
      topScore: ranked[0].result.score, topEvidence: ranked[0].result.strongestPositives.slice(0, 2).map((item) => item.key),
      bottom: `${ranked.at(-1).product.brand} ${ranked.at(-1).product.name}`,
      bottomScore: ranked.at(-1).result.score, bottomEvidence: ranked.at(-1).result.strongestConcerns.slice(0, 2).map((item) => item.key),
    });
  }
  t.diagnostic(JSON.stringify({ rankedCategories: report.length, ranking: report }));
  assert.ok(report.length >= 8);
});

test('strong exact irritation evidence outweighs a weak generic hydration positive', () => {
  const ingredient = (id, position, key) => ({ id, position, name: key, inciName: key, attributes: [] });
  const irritant = ingredient(1, 0, 'may_cause_irritation');
  const hydrator = ingredient(2, 7, 'hydrating');
  const formula = {
    id: 1, region: null, formulation: null, variant: null, imageUrl: null,
    ingredients: [irritant, hydrator], flags: [], decodeWarnings: [],
    analysis: [{ attributeId: 7, stateId: 1, reportedCount: 1, ingredientIds: [1], key: 'may_cause_irritation', label: 'May cause irritation', description: null, state: 'resolved_endpoint', resolved: true, ingredientPositions: [1], responsibleIngredients: [irritant], kind: 'concern' }],
  };
  hydrator.attributes = [{ id: 3, key: 'hydrating', label: 'Hydrating', kind: 'benefit' }];
  const result = score({ productId: 900001, brandId: 1, brand: 'Calibration', name: 'Conflict fixture', category: 'Serums', subcategory: null, imageUrl: null, description: null, flags: [], matchedIngredients: [], formulas: [formula], hasParsedFormula: true }, baseProfile({ sensitivity: 'high', skinType: 'dry', goals: ['hydrate'] }));
  assert.ok(result.score < 50, `strong exact concern must outweigh weak generic positive, got ${result.score}`);
  assert.ok(result.strongestConcerns[0]?.source === 'formula');
});

test('hydration and barrier evidence helps the matching profile dimensions', () => {
  const fixtureIngredient = { id: 800001, position: 2, name: 'Glycerin', inciName: 'Glycerin', attributes: [] };
  const formula = {
    id: 800001, region: null, formulation: null, variant: null, imageUrl: null,
    ingredients: [fixtureIngredient], flags: [], decodeWarnings: [],
    analysis: [{ attributeId: 3, stateId: 1, reportedCount: 1, ingredientIds: [800001], key: 'hydrating', label: 'Hydrating', description: null, state: 'resolved_endpoint', resolved: true, ingredientPositions: [1], responsibleIngredients: [fixtureIngredient], kind: 'benefit' }],
  };
  const product = { productId: 800001, brandId: 1, brand: 'Calibration', name: 'Hydration signal', category: 'Moisturizers', subcategory: null, imageUrl: null, description: null, flags: [], matchedIngredients: [], formulas: [formula], hasParsedFormula: true };
  const relevant = score(product, baseProfile({ skinType: 'dry', goals: ['hydrate', 'repair_barrier'] }));
  const unrelated = score(product, baseProfile({ skinType: 'normal', goals: ['anti_aging'] }));
  assert.ok(relevant.subScores.skin_type > 50);
  assert.ok(relevant.subScores.goals > 50);
  assert.equal(unrelated.subScores.goals, null, 'hydration does not imply anti-aging evidence');
});

test('acne-risk evidence lowers acne-focused concern score but leaves unrelated concerns unknown', () => {
  const product = products.find((item) => item.formulas.some((formula) => formula.analysis.some((entry) => entry.resolved && ['may_cause_acne', 'can_worsen_oily_skin'].includes(entry.key))));
  assert.ok(product, 'fixture includes real linked acne or oil-risk evidence');
  const formula = product.formulas.find((candidate) => candidate.analysis.some((entry) => entry.resolved && ['may_cause_acne', 'can_worsen_oily_skin'].includes(entry.key)));
  const acne = score(product, baseProfile({ concerns: ['acne'] }), formula);
  assert.notEqual(acne.subScores.concerns, null);
  assert.ok(acne.subScores.concerns < 50);
  const unrelated = score(product, baseProfile({ concerns: [] }), formula);
  assert.equal(unrelated.subScores.concerns, null);
});

test('irrelevant profile choices do not move supported scores', () => {
  const ingredient = { id: 800002, position: 1, name: 'Glycerin', inciName: 'Glycerin', attributes: [] };
  const formula = {
    id: 800002, region: null, formulation: null, variant: null, imageUrl: null,
    ingredients: [ingredient], flags: [], decodeWarnings: [],
    analysis: [{ attributeId: 3, stateId: 1, reportedCount: 1, ingredientIds: [800002], key: 'hydrating', label: 'Hydrating', description: null, state: 'resolved_endpoint', resolved: true, ingredientPositions: [1], responsibleIngredients: [ingredient], kind: 'benefit' }],
  };
  const product = { productId: 800002, brandId: 1, brand: 'Calibration', name: 'One signal', category: 'Moisturizers', subcategory: null, imageUrl: null, description: null, flags: [], matchedIngredients: [], formulas: [formula], hasParsedFormula: true };
  const base = score(product, baseProfile({ skinType: 'dry', goals: ['hydrate'] }));
  const unrelatedChoices = score(product, baseProfile({ skinType: 'dry', goals: ['hydrate', 'anti_aging'], concerns: ['fine_lines'] }));
  assert.equal(unrelatedChoices.score, base.score);
  assert.equal(unrelatedChoices.subScores.skin_type, base.subScores.skin_type);
  assert.equal(unrelatedChoices.subScores.goals, base.subScores.goals);
  assert.equal(unrelatedChoices.subScores.concerns, null);
});

test('unmapped catalog attributes cannot change a score or create reasons', () => {
  const base = products.find((product) => product.productId === 442);
  const withIrrelevantAttribute = structuredClone(base);
  withIrrelevantAttribute.formulas[0].ingredients[1].attributes.push({
    id: 23, key: 'chemical_uv_filter', label: 'Chemical UV Filter', kind: 'benefit',
  });
  const profile = baseProfile({ skinType: 'dry', sensitivity: 'high', concerns: ['redness'], goals: ['repair_barrier'] });
  const original = score(base, profile);
  const augmented = score(withIrrelevantAttribute, profile);
  assert.equal(augmented.score, original.score);
  assert.deepEqual(augmented.strongestPositives, original.strongestPositives);
  assert.deepEqual(augmented.strongestConcerns, original.strongestConcerns);
});
test('the matrix captures category tops, sparsely supported items, and score differentiation for reporting', (t) => {
  const distributions = {};
  for (const profile of profiles) {
    const results = products.map((product) => score(product, profile));
    distributions[profileKey(profile)] = {
      complete: results.filter((item) => item.scoreStatus === 'complete').length,
      partial: results.filter((item) => item.scoreStatus === 'partial').length,
      insufficient: results.filter((item) => item.scoreStatus === 'insufficient_data').length,
      uniqueScores: new Set(results.flatMap((item) => item.score === null ? [] : [item.score])).size,
    };
    if (results.filter((item) => item.score !== null).length >= 2) assert.ok(distributions[profileKey(profile)].uniqueScores >= 2, `profile ${profileKey(profile)} should produce differentiated scores`);
  }
  const profileKeyNames = Object.keys(distributions);
  const averages = products.map((product) => {
    const scored = profiles.map((profile) => score(product, profile)).flatMap((item) => item.score === null ? [] : [item.score]);
    return { product: `${product.brand} ${product.name}`, scoreRange: scored.length ? Math.max(...scored) - Math.min(...scored) : null };
  });
  const scoreHistogram = {};
  const counterintuitiveHighRisk = [];
  for (const profile of profiles) for (const product of products) {
    const result = score(product, profile);
    if (result.score === null) continue;
    scoreHistogram[result.score] = (scoreHistogram[result.score] || 0) + 1;
    if (result.score >= 70 && result.strongestConcerns.length >= result.strongestPositives.length + 2) {
      counterintuitiveHighRisk.push({ product: `${product.brand} ${product.name}`, score: result.score, concerns: result.strongestConcerns.slice(0, 2).map((item) => item.key) });
    }
  }
  t.diagnostic(JSON.stringify({ profiles: profiles.length, products: products.length, scoredPairs: profiles.length * products.length, formulaRows: products.reduce((n, item) => n + item.formulas.length, 0), scoreDistribution: Object.values(distributions).reduce((totals, row) => ({ complete: totals.complete + row.complete, partial: totals.partial + row.partial, insufficient: totals.insufficient + row.insufficient }), { complete: 0, partial: 0, insufficient: 0 }), scoreHistogram, counterintuitiveHighRisk: counterintuitiveHighRisk.slice(0, 10), counterintuitiveHighRiskCount: counterintuitiveHighRisk.length, mostDifferentiatedProducts: averages.sort((a, b) => b.scoreRange - a.scoreRange).slice(0, 5), profileSamples: profileKeyNames.slice(0, 5) }));
});

test('reported sample ratings show real products against contrasting skin profiles', (t) => {
  const cases = [
    { productId: 442, profile: baseProfile({ skinType: 'dry', sensitivity: 'high', concerns: ['redness'], goals: ['repair_barrier'] }), label: 'A.N.D. sunscreen · sensitive/dry/redness' },
    { productId: 442, profile: baseProfile({ skinType: 'dry', sensitivity: 'low', concerns: ['dryness'], goals: ['hydrate'] }), label: 'A.N.D. sunscreen · low sensitivity/dry/hydration' },
    { productId: 12556, profile: baseProfile({ skinType: 'oily', sensitivity: 'moderate', concerns: ['acne', 'pores'], goals: ['clear_acne'] }), label: 'Curenex cleanser · oily/acne' },
    { productId: 12556, profile: baseProfile({ skinType: 'dry', sensitivity: 'moderate', concerns: ['dryness'], goals: ['hydrate'] }), label: 'Curenex cleanser · dry/hydration' },
    { productId: 33844, profile: baseProfile({ skinType: 'normal', sensitivity: 'high', concerns: ['fine_lines', 'dullness'], goals: ['anti_aging', 'even_tone'] }), label: 'Max Factor Pan Stik · sensitive/anti-aging' },
    { productId: 56337, profile: baseProfile({ skinType: 'oily', sensitivity: 'moderate', concerns: ['acne', 'oiliness'], goals: ['clear_acne'] }), label: 'Vichy SPF · oily/acne' },
  ];
  const report = cases.flatMap(({ productId, profile, label }) => {
    const product = products.find((item) => item.productId === productId);
    if (!product) return [];
    const result = score(product, profile);
    return [{ label, score: result.score, subScores: result.subScores, confidence: result.confidence,
      positives: result.strongestPositives.slice(0, 2).map((item) => `${item.label}: ${item.ingredientNames.slice(0, 2).join(', ')}`),
      concerns: result.strongestConcerns.slice(0, 3).map((item) => `${item.label}: ${item.ingredientNames.slice(0, 2).join(', ')}`) }];
  });
  t.diagnostic(JSON.stringify({ realProductExamples: report }));
});

function profileKey(profile) {
  return `${profile.skinType}/${profile.sensitivity}/${profile.concerns.join('+')}/${profile.goals.join('+')}/${profile.preferences.join('+')}`;
}
