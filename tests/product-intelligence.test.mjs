import test from 'node:test';
import assert from 'node:assert/strict';
import { ageRanges, skinConcerns, skinGoals, skinPreferences, skinTypes, sensitivityLevels } from '../src/onboarding/types.ts';
import { decodeCompactFormula } from '../src/products/compact-formula.ts';
import { resolveFormulaAnalysis } from '../src/products/catalog-evidence.ts';
import { auditCatalogMapping, CATALOG_ATTRIBUTE_KEYS, CATALOG_FLAG_KEYS, CONCERN_MAPPING, FORMULA_ATTRIBUTE_IDS, GOAL_MAPPING, PREFERENCE_MAPPING, PROFILE_FLAG_MAPPING, SKIN_TYPE_MAPPING, SENSITIVITY_MAPPING, mappedAttributeKeys } from '../src/products/intelligence-mapping.ts';
import { scoreProductMatch } from '../src/products/product-intelligence.ts';

const flags = CATALOG_FLAG_KEYS.map((key, index) => ({ id: index + 1, key, label: key.replaceAll('_', ' ') }));
const profile = (overrides = {}) => ({ ageRange: '25_34', skinType: 'normal', sensitivity: 'not_sure', concerns: [], goals: [], preferences: [], ...overrides });
const formulaAnalysis = (key, id, ingredient, kind = 'benefit') => ({
  attributeId: id, stateId: 1, reportedCount: 1, ingredientIds: [ingredient.id], key, label: key.replaceAll('_', ' '),
  description: null, state: 'resolved_endpoint', resolved: true, ingredientPositions: [ingredient.position + 1], responsibleIngredients: [ingredient], kind,
});
const formula = (analyses = [], ingredients = [], productFlags = []) => ({
  id: 1, region: null, formulation: null, variant: null, imageUrl: null, ingredients, flags: productFlags, analysis: analyses, decodeWarnings: [],
});
const detail = (selectedFormula) => ({
  productId: 442, brandId: 1, brand: 'A.N.D. Beauty', name: 'Clear Sun Spray SPF 50', category: 'Sunscreen', subcategory: null,
  imageUrl: null, description: null, flags: selectedFormula.flags, matchedIngredients: [], formulas: [selectedFormula], hasParsedFormula: selectedFormula.ingredients.length > 0,
});

test('all current onboarding options have explicit mapping entries and all referenced keys exist live', () => {
  assert.deepEqual(Object.keys(SKIN_TYPE_MAPPING).sort(), [...skinTypes].sort());
  assert.deepEqual(Object.keys(SENSITIVITY_MAPPING).sort(), [...sensitivityLevels].sort());
  assert.deepEqual(Object.keys(CONCERN_MAPPING).sort(), [...skinConcerns].sort());
  assert.deepEqual(Object.keys(GOAL_MAPPING).sort(), [...skinGoals].sort());
  assert.deepEqual(Object.keys(PREFERENCE_MAPPING).sort(), [...skinPreferences].sort());
  assert.equal(ageRanges.length, 5); // age is collected but intentionally does not alter product chemistry scoring.
  const unknown = [...mappedAttributeKeys()].filter((key) => !CATALOG_ATTRIBUTE_KEYS.includes(key));
  assert.deepEqual(unknown, []);
  const mappedFlags = new Set([...Object.values(PREFERENCE_MAPPING).flatMap((item) => item.matchFlags), ...Object.keys(PROFILE_FLAG_MAPPING)]);
  assert.deepEqual([...mappedFlags].filter((key) => !CATALOG_FLAG_KEYS.includes(key)), []);
  const audit = auditCatalogMapping();
  assert.deepEqual(audit.mappingKeysMissingFromCatalog, []);
  assert.deepEqual(audit.mappingFlagsMissingFromCatalog, []);
  assert.deepEqual(audit.supportedOptions, { skinTypes: 5, sensitivity: 4, concerns: 9, goals: 8, preferences: 5 });
});

test('all 46 live formula attribute IDs resolve to the 66-key catalog dictionary', () => {
  assert.equal(FORMULA_ATTRIBUTE_IDS.length, 46);
  assert.equal(CATALOG_ATTRIBUTE_KEYS.length, 66);
  for (const id of FORMULA_ATTRIBUTE_IDS) assert.ok(CATALOG_ATTRIBUTE_KEYS[id - 1], `attribute id ${id} is unmapped`);
  assert.equal(new Set(FORMULA_ATTRIBUTE_IDS).size, 46);
});

test('integration: live compact A.N.D. Beauty formula decodes exact ordinal links into named ingredients and a profile result', () => {
  // Captured from live catalog formula 442; ingredient positions in analysis_json are 1-based.
  const raw = {
    ingredient_ids_json: '[1624,5204,20419,11724,4828,9790,4133,32532,21867,33923]',
    flag_ids_json: '[2,3,5,6,7,8,10,11,12]',
    analysis_json: '[[6,1,null,[8]],[16,1,null,[8]],[43,1,null,[8]],[3,1,null,[8]],[13,1,null,[8]],[18,1,null,[8]],[11,1,null,[8]],[23,1,5,[3,4,5,6,7]],[63,1,null,[8]],[42,1,null,[1]],[9,1,3,[1,3,9]],[7,1,2,[1,3]],[40,1,2,[1,9]]]'
  };
  const actualIngredients = [
    ['ALCOHOL DENAT.', ['may_cause_irritation','can_worsen_eczema','can_worsen_perioral_dermatitis','can_worsen_psoriasis','can_worsen_seborrheic_dermatitis','can_worsen_keratosis_pilaris','can_worsen_rosacea','alcohol','can_worsen_dry_skin']],
    ['C12-15 ALKYL BENZOATE', []], ['OCTOCRYLENE', ['may_cause_irritation','can_worsen_eczema']],
    ['ETHYLHEXYL SALICYLATE', []], ['BUTYL METHOXYDIBENZOYLMETHANE', []], ['DIETHYLAMINO HYDROXYBENZOYL HEXYL BENZOATE', []],
    ['BIS-ETHYLHEXYLOXYPHENOL METHOXYPHENYL TRIAZINE', []],
    ['TOCOPHEROL', ['hydrating','antioxidant','helps_with_dark_spots','brightening','helps_with_anti_aging','reduces_redness','helps_with_barrier_repair','vitamin_e']],
    ['PARFUM', ['synthetic_fragrance','fragrance','can_worsen_eczema','can_worsen_perioral_dermatitis','can_worsen_psoriasis','can_worsen_seborrheic_dermatitis','can_worsen_keratosis_pilaris','can_worsen_rosacea']], ['WATER', []],
  ];
  const decoded = decodeCompactFormula(raw);
  assert.deepEqual(decoded.warnings, []);
  const ingredients = decoded.ingredientIds.map((id, position) => ({
    id, position, name: actualIngredients[position][0], inciName: actualIngredients[position][0], rawToken: null,
    functions: [], description: null, attributes: actualIngredients[position][1].map((key) => ({ id: CATALOG_ATTRIBUTE_KEYS.indexOf(key) + 1, key, label: key, description: null, kind: key.includes('irritat') || key === 'fragrance' || key === 'alcohol' ? 'concern' : 'benefit' })),
  }));
  const attrs = new Map(CATALOG_ATTRIBUTE_KEYS.map((key, index) => [index + 1, { key, label: key, description: null }]));
  const states = new Map([[0, { key: 'unknown' }], [1, { key: 'resolved_endpoint' }], [2, { key: 'unresolved_count_mismatch' }], [3, { key: 'unresolved_lazy' }], [4, { key: 'unresolved_mapping_mismatch' }]]);
  const analysis = resolveFormulaAnalysis(decoded.analysis, attrs, states, ingredients);
  const hydration = analysis.find((item) => item.key === 'hydrating');
  assert.deepEqual(hydration.responsibleIngredients.map((item) => item.id), [32532]);
  assert.deepEqual(hydration.ingredientPositions, [8]);
  const product = detail(formula(analysis, ingredients, decoded.flagIds.map((id) => flags[id - 1])));
  const sensitive = scoreProductMatch(product, profile({ sensitivity: 'high', skinType: 'dry', concerns: ['redness'], goals: ['repair_barrier'], preferences: ['fragrance_free','avoid_alcohol'] }));
  const tolerant = scoreProductMatch(product, profile({ sensitivity: 'low', skinType: 'dry', concerns: ['redness'], goals: ['repair_barrier'], preferences: ['fragrance_free','avoid_alcohol'] }));
  assert.notEqual(sensitive.score, null);
  assert.notEqual(tolerant.score, null);
  assert.ok(sensitive.score < tolerant.score, `${sensitive.score} should be below ${tolerant.score}`);
  assert.ok(sensitive.subScores.sensitivity < tolerant.subScores.sensitivity);
  assert.ok(sensitive.strongestConcerns.some((item) => item.ingredientNames.includes('ALCOHOL DENAT.')));
  assert.ok(sensitive.strongestConcerns.some((item) => item.ingredientNames.includes('PARFUM')));
  assert.ok(tolerant.strongestPositives.some((item) => item.ingredientNames.includes('TOCOPHEROL')));
  assert.equal(sensitive.preferenceResults.find((item) => item.preference === 'fragrance_free').status, 'conflict');
  assert.equal(sensitive.preferenceResults.find((item) => item.preference === 'avoid_alcohol').status, 'conflict');
});

test('live Haus Labs and Tarte formula samples retain their exact linked concerns and differentiate sensitivity', () => {
  const attributes = new Map(CATALOG_ATTRIBUTE_KEYS.map((key, index) => [index + 1, { key, label: key, description: null }]));
  const states = new Map([[1, { key: 'resolved_endpoint' }]]);
  const cases = [
    {
      productId: 23616, name: 'Triclone Skin Tech Medium Coverage Foundation with Fermented Arnica', formulaId: 24712,
      ids: [33923,10560,23625,6172,33045,26295,15756,12706,4861,18984,17295,5268,24846,1624,1326,25064,30692,10842,14,21663,2745,14745,30859,26592,26584,26408,30531,11011,13302,32532,1921,31792,23388,21774,12981,6889,6528,26618,6163,11730,18082,25120,1283,32830,10156,1960,7319,7309,7310,7311],
      names: { 8:'GLYCERIN',9:'BUTYLENE GLYCOL',14:'ALCOHOL DENAT.',19:'1,2-HEXANEDIOL',22:'HYDROLYZED HYALURONIC ACID',23:'SQUALANE',30:'TOCOPHEROL',35:'GLYCYRRHIZA GLABRA ROOT EXTRACT',36:'CHAMOMILLA RECUTITA EXTRACT',37:'CENTELLA ASIATICA EXTRACT' },
      tuples: [[3,1,8,[8,9,19,22,23,26,30,35]],[7,1,null,[14]],[11,1,2,[30,35]],[13,1,2,[30,35]],[18,1,4,[30,35,36,37]],[24,1,3,[35,36,37]],[42,1,null,[14]],[43,1,6,[8,9,23,30,35,37]]],
    },
    {
      productId: 52242, name: 'Shape Tape Contour Concealer', formulaId: 54796,
      ids: [33923,8952,8917,18907,4861,21983,33045,29850,10842,6825,1960,2285,3798,8330,10156,10695,11730,12482,12981,13324,13729,15120,17420,17558,17588,17604,18114,18256,20545,21395,21867,23597,32532,32830,32837,4908,33413,12706,23136,31830,7319,7309,7310,7311],
      names: { 4:'METHYL METHACRYLATE CROSSPOLYMER',5:'BUTYLENE GLYCOL',12:'AMYL CINNAMAL',13:'BENZYL SALICYLATE',18:'GERANIOL',19:'GLYCYRRHIZA GLABRA ROOT EXTRACT',21:'HEXYL CINNAMAL',22:'HYDROXYCITRONELLAL',25:'LIMONENE',26:'LINALOOL',33:'TOCOPHEROL',36:'BUTYROSPERMUM PARKII BUTTER',37:'ULMUS DAVIDIANA ROOT EXTRACT',38:'GLYCERIN' },
      tuples: [[3,1,8,[5,19,20,29,33,36,37,38]],[7,1,7,[12,13,18,21,22,25,26]],[11,1,2,[19,33]],[18,1,2,[19,33]],[24,1,2,[19,37]],[35,1,null,[36]],[39,1,null,[4]],[43,1,5,[5,19,33,36,38]]],
    },
  ];
  const buildSample = (sample) => {
    const raw = { ingredient_ids_json: JSON.stringify(sample.ids), flag_ids_json: '[]', analysis_json: JSON.stringify(sample.tuples) };
    const decoded = decodeCompactFormula(raw);
    assert.deepEqual(decoded.warnings, [], sample.name);
    const ordered = decoded.ingredientIds.map((id, index) => ({ id, position: index, name: sample.names[index + 1] || `Catalog ingredient ${id}`, inciName: sample.names[index + 1] || `Catalog ingredient ${id}`, rawToken: null, functions: [], description: null, attributes: [] }));
    const analysis = resolveFormulaAnalysis(decoded.analysis, attributes, states, ordered);
    for (const entry of analysis) for (const position of entry.ingredientPositions) assert.equal(entry.responsibleIngredients.find((item) => item.position === position - 1)?.id, decoded.ingredientIds[position - 1]);
    return { ...sample, product: { ...detail(formula(analysis, ordered)), productId: sample.productId, name: sample.name } };
  };
  const [haus, tarte] = cases.map(buildSample);
  assert.deepEqual(haus.product.formulas[0].analysis.find((item) => item.key === 'may_cause_irritation').responsibleIngredients.map((item) => item.inciName), ['ALCOHOL DENAT.']);
  assert.deepEqual(tarte.product.formulas[0].analysis.find((item) => item.key === 'may_cause_irritation').responsibleIngredients.map((item) => item.inciName), ['AMYL CINNAMAL','BENZYL SALICYLATE','GERANIOL','HEXYL CINNAMAL','HYDROXYCITRONELLAL','LIMONENE','LINALOOL']);
  const sensitiveTarte = scoreProductMatch(tarte.product, profile({ sensitivity: 'high', concerns: ['redness'] }));
  const lowSensitivityTarte = scoreProductMatch(tarte.product, profile({ sensitivity: 'low', concerns: ['redness'] }));
  assert.ok(sensitiveTarte.score < lowSensitivityTarte.score);
  assert.ok(sensitiveTarte.strongestConcerns.some((item) => item.ingredientNames.includes('AMYL CINNAMAL')));
  const hausDry = scoreProductMatch(haus.product, profile({ skinType: 'dry', goals: ['hydrate','repair_barrier'] }));
  assert.ok(hausDry.subScores.goals !== null);
  assert.ok(hausDry.strongestPositives.some((item) => item.key === 'hydrating' || item.key === 'helps_with_barrier_repair'));
});

test('additional live catalog samples decode to differentiated results from their stored evidence', () => {
  const attributes = new Map(CATALOG_ATTRIBUTE_KEYS.map((key, index) => [index + 1, { key, label: key, description: null }]));
  const states = new Map([[1, { key: 'resolved_endpoint' }]]);
  const samples = [
    { id: 1000, brand: 'Adwoa Beauty', name: 'Baomint Moisturizing Curl Defining Gel', formulaId: 1010,
      ids: [33923,12706,26386,1429,6113,4908,21035,21867,8710,1275,25132,33999,9464,3774,6221,2089,12429,18539,18514,27731,33511],
      tuples: [[43,1,3,[2,5,6]],[3,1,6,[2,3,5,6,7,9]],[20,1,null,[2]],[36,1,2,[3,6]],[42,1,null,[19]],[9,1,2,[8,14]],[7,1,3,[14,18,19]],[35,1,null,[6]],[40,1,3,[8,17,19]]] },
    { id: 30000, brand: 'La Roche-Posay', name: 'Toleriane Double Repair Matte Moisturizer UV SPF 30', formulaId: 31545,
      ids: [4828,13901,11724,20419,33923,12706,10094,29414,19914,12841,22034,23304,9712,31202,31233,6575,10156,19541,23398,21477,2210,6139,6163,7535,33264,33999,32532,23597],
      tuples: [[3,1,6,[6,15,16,18,20,27]],[7,1,null,[4]],[24,1,2,[9,16]],[35,1,2,[15,20]],[39,1,4,[8,9,19,22]],[43,1,5,[6,9,12,16,27]]] },
  ];
  const results = samples.map((sample) => {
    const decoded = decodeCompactFormula({ ingredient_ids_json: JSON.stringify(sample.ids), flag_ids_json: '[]', analysis_json: JSON.stringify(sample.tuples) });
    assert.deepEqual(decoded.warnings, []);
    const ordered = decoded.ingredientIds.map((id, position) => ({ id, position, name: `Catalog ingredient ${id}`, inciName: null, rawToken: null, functions: [], description: null, attributes: [] }));
    const analysis = resolveFormulaAnalysis(decoded.analysis, attributes, states, ordered);
    for (const item of analysis) for (const position of item.ingredientPositions) assert.equal(item.responsibleIngredients.find((ingredient) => ingredient.position === position - 1)?.id, decoded.ingredientIds[position - 1]);
    const product = { ...detail(formula(analysis, ordered)), productId: sample.id, brand: sample.brand, name: sample.name };
    return { sample, product };
  });
  const [adwoa, laRoche] = results;
  const oilyAdwoa = scoreProductMatch(adwoa.product, profile({ skinType: 'oily', sensitivity: 'high', concerns: ['acne'] }));
  const dryLaRoche = scoreProductMatch(laRoche.product, profile({ skinType: 'dry', goals: ['hydrate','repair_barrier'] }));
  const oilyLaRoche = scoreProductMatch(laRoche.product, profile({ skinType: 'oily', concerns: ['oiliness'] }));
  assert.ok(oilyAdwoa.strongestConcerns.some((item) => item.key === 'may_cause_irritation'));
  assert.ok(dryLaRoche.score > oilyLaRoche.score);
  assert.ok(dryLaRoche.strongestPositives.some((item) => item.key === 'hydrating' || item.key === 'helps_with_barrier_repair'));
});

test('oily and dry profiles score the same catalog formula differently with coherent evidence', () => {
  const oil = { id: 35, position: 0, name: 'Oil marker', inciName: 'Oil marker', attributes: [] };
  const dry = { id: 3, position: 8, name: 'Hydration marker', inciName: 'Hydration marker', attributes: [] };
  const analyses = [formulaAnalysis('can_worsen_oily_skin', 35, oil, 'concern'), formulaAnalysis('hydrating', 3, dry)];
  const product = detail(formula(analyses, [oil, dry]));
  const oily = scoreProductMatch(product, profile({ skinType: 'oily' }));
  const dryProfile = scoreProductMatch(product, profile({ skinType: 'dry' }));
  assert.ok(oily.score < dryProfile.score);
  assert.ok(oily.strongestConcerns.some((item) => item.key === 'can_worsen_oily_skin'));
  assert.ok(dryProfile.strongestPositives.some((item) => item.key === 'hydrating'));
});

test('sensitivity risk outweighs one weak generic benefit', () => {
  const irritant = { id: 7, position: 0, name: 'Irritation marker', inciName: 'Irritation marker', attributes: [] };
  const soothing = { id: 24, position: 6, name: 'Soothing marker', inciName: 'Soothing marker', attributes: [] };
  const product = detail(formula([formulaAnalysis('may_cause_irritation', 7, irritant, 'concern'), formulaAnalysis('reduces_irritation', 24, soothing)], [irritant, soothing]));
  const high = scoreProductMatch(product, profile({ sensitivity: 'high' }));
  const low = scoreProductMatch(product, profile({ sensitivity: 'low' }));
  assert.ok(high.score < low.score);
  assert.ok(high.strongestConcerns.some((item) => item.key === 'may_cause_irritation'));
});

test('every positive profile mapping produces its corresponding evidence; unsupported options stay explicitly neutral', () => {
  for (const [value, mapping] of Object.entries(CONCERN_MAPPING)) {
    const analysis = mapping.positive.map((item, index) => formulaAnalysis(item.key, CATALOG_ATTRIBUTE_KEYS.indexOf(item.key) + 1, { id: index + 1, position: index, name: item.key, inciName: item.key, attributes: [] }));
    const ingredients = analysis.map((item) => item.responsibleIngredients[0]);
    const result = scoreProductMatch(detail(formula(analysis, ingredients)), profile({ concerns: [value] }));
    assert.equal(result.strongestPositives.length > 0, mapping.positive.length > 0, `concern ${value}`);
  }
  for (const [value, mapping] of Object.entries(GOAL_MAPPING)) {
    const analysis = mapping.positive.map((item, index) => formulaAnalysis(item.key, CATALOG_ATTRIBUTE_KEYS.indexOf(item.key) + 1, { id: index + 1, position: index, name: item.key, inciName: item.key, attributes: [] }));
    const ingredients = analysis.map((item) => item.responsibleIngredients[0]);
    const result = scoreProductMatch(detail(formula(analysis, ingredients)), profile({ goals: [value] }));
    assert.equal(result.strongestPositives.length > 0, mapping.positive.length > 0, `goal ${value}`);
  }
  for (const [value, mapping] of Object.entries(CONCERN_MAPPING)) {
    const analysis = mapping.negative.map((item, index) => formulaAnalysis(item.key, CATALOG_ATTRIBUTE_KEYS.indexOf(item.key) + 1, { id: index + 1, position: index, name: item.key, inciName: item.key, attributes: [] }, 'concern'));
    const result = scoreProductMatch(detail(formula(analysis, analysis.map((item) => item.responsibleIngredients[0]))), profile({ concerns: [value] }));
    assert.equal(result.strongestConcerns.length > 0, mapping.negative.length > 0, `concern risk ${value}`);
  }
  for (const [value, mapping] of Object.entries(GOAL_MAPPING)) {
    const analysis = mapping.negative.map((item, index) => formulaAnalysis(item.key, CATALOG_ATTRIBUTE_KEYS.indexOf(item.key) + 1, { id: index + 1, position: index, name: item.key, inciName: item.key, attributes: [] }, 'concern'));
    const result = scoreProductMatch(detail(formula(analysis, analysis.map((item) => item.responsibleIngredients[0]))), profile({ goals: [value] }));
    assert.equal(result.strongestConcerns.length > 0, mapping.negative.length > 0, `goal risk ${value}`);
  }
});

test('no-INCI and unresolved relationships do not invent ingredient evidence or alter the score', () => {
  const noInci = scoreProductMatch({ ...detail(formula()), productId: 19, brand: '10 Degrees Cooler', name: 'S01 Pure Scandinavian Wild Rose Face Oil' }, profile({ sensitivity: 'high', concerns: ['acne'] }));
  assert.equal(noInci.scoreStatus, 'insufficient_data');
  assert.equal(noInci.confidence, 'none');
  assert.equal(noInci.strongestPositives.length + noInci.strongestConcerns.length, 0);
  // Live 1.618 Betula Calming Dual Mist formula 6: catalog counts exist, but all
  // state-3 relationships have empty position arrays and cannot name ingredients.
  const mistRaw = {
    ingredient_ids_json: '[33923,13324,3926,10583,11717,19914,4861,21807,6528,15096,6163,14,26234,10573,1684,13190,21412,28820,4481,25493,7935,11730,32532,2921,18004,2920,1447,1263,2691,18422,18420,8059,30550,2028,8786,20292,19359,8404,10695,21867]',
    flag_ids_json: '[1,3,7,9,10,11]', analysis_json: '[[3,3,13,[]],[7,3,7,[]],[43,3,10,[]]]',
  };
  const mistDecoded = decodeCompactFormula(mistRaw);
  const mistIngredients = mistDecoded.ingredientIds.map((id, position) => ({ id, position, name: `Catalog ingredient ${id}`, inciName: null, rawToken: null, functions: [], description: null, attributes: [] }));
  const mistAnalysis = resolveFormulaAnalysis(mistDecoded.analysis, new Map(CATALOG_ATTRIBUTE_KEYS.map((key, i) => [i + 1, { key, label: key, description: null }])), new Map([[3, { key: 'unresolved_lazy' }]]), mistIngredients);
  const mist = scoreProductMatch({ ...detail(formula(mistAnalysis, mistIngredients)), productId: 6, brand: '1.618', name: 'Betula Calming Dual Mist' }, profile({ skinType: 'dry', concerns: ['dryness'], goals: ['hydrate'] }));
  assert.equal(mist.scoreStatus, 'insufficient_data');
  assert.equal(mist.evidenceCounts.unresolvedFormula, 2);
  assert.equal(mist.strongestPositives.length + mist.strongestConcerns.length, 0);
  // Additional live sample, product 300. It has an INCI list but its analysis
  // tuples are state 3 with empty ordinal links, so reported counts cannot name evidence.
  const creamRaw = {
    ingredient_ids_json: '[33923,6798,4861,6683,12706,14,12841,14605,25481,33439,7027,2691,3889,2890,7630,7760,7829,7926,7728,7581,8383,20889,20870,946,20278,23459,23461,8214,10094,30692,32535,3643,22034,15198,1263,21867,11730,10695]',
    flag_ids_json: '[1,2,3,6,7,9,11]', analysis_json: '[[3,3,6,[]],[43,3,4,[]],[7,3,null,[]],[35,3,2,[]]]',
  };
  const creamDecoded = decodeCompactFormula(creamRaw);
  const creamIngredients = creamDecoded.ingredientIds.map((id, position) => ({ id, position, name: `Catalog ingredient ${id}`, inciName: null, rawToken: null, functions: [], description: null, attributes: [] }));
  const creamAnalysis = resolveFormulaAnalysis(creamDecoded.analysis, new Map(CATALOG_ATTRIBUTE_KEYS.map((key, i) => [i + 1, { key, label: key, description: null }])), new Map([[3, { key: 'unresolved_lazy' }]]), creamIngredients);
  const cream = scoreProductMatch({ ...detail(formula(creamAnalysis, creamIngredients)), productId: 300, brand: '7 Days', name: 'My Beauty Week Face And Neck Cream With 3D Massager' }, profile({ skinType: 'dry', sensitivity: 'high', goals: ['hydrate','repair_barrier'] }));
  assert.equal(cream.scoreStatus, 'insufficient_data');
  assert.equal(cream.evidenceCounts.exactFormula, 0);
  assert.ok(cream.dataLimitations.some((item) => item.includes('unresolved')));
  const unresolved = { ...formulaAnalysis('hydrating', 3, { id: 4, position: 2, name: 'not linked', inciName: null }, 'benefit'), resolved: false, state: 'unresolved_lazy', reportedCount: 4, responsibleIngredients: [], ingredientIds: [] };
  const unknown = scoreProductMatch(detail(formula([unresolved], [])), profile({ skinType: 'dry', concerns: ['dryness'], goals: ['hydrate'] }));
  assert.equal(unknown.scoreStatus, 'insufficient_data');
  assert.equal(unknown.evidenceCounts.exactFormula, 0);
  assert.ok(unknown.dataLimitations.some((item) => item.includes('unresolved')));
});

test('missing flags remain unknown and do not count as a preference conflict', () => {
  const result = scoreProductMatch(detail(formula()), profile({ preferences: ['vegan','cruelty_free'] }));
  assert.deepEqual(result.preferenceResults.map((item) => item.status), ['unknown','unknown']);
  assert.equal(result.scoreStatus, 'insufficient_data');
});

test('explicit product flags improve only the matching profile dimensions', () => {
  const product = detail(formula([], [], [
    { id: 6, key: 'oil_free', label: 'Oil-free' },
    { id: 8, key: 'pore_clogger_free', label: 'Pore-clogger-free' },
  ]));
  const oily = scoreProductMatch(product, profile({ skinType: 'oily', concerns: ['acne'], goals: ['clear_acne'] }));
  const dry = scoreProductMatch(product, profile({ skinType: 'dry', concerns: ['dryness'] }));
  assert.ok(oily.subScores.skin_type > 50);
  assert.ok(oily.subScores.concerns > 50);
  assert.equal(oily.score, null, 'product flags alone do not establish a formula-based Skin Match');
  assert.equal(oily.evidenceCounts.productFlags, 3);
  assert.equal(dry.evidenceCounts.productFlags, 0);
});

test('cached product summaries use only flags and mark their score partial', () => {
  const summary = {
    productId: 12, brandId: null, brand: 'Sample', name: 'Oil-free moisturizer', category: 'Moisturizer', subcategory: null,
    imageUrl: null, description: null, flags: [{ id: 6, key: 'oil_free', label: 'Oil-free' }], matchedIngredients: [],
  };
  const result = scoreProductMatch(summary, profile({ skinType: 'oily' }));
  assert.equal(result.scoreStatus, 'partial');
  assert.equal(result.score, null);
  assert.equal(result.evidenceCounts.productFlags, 1);
  assert.equal(result.evidenceCounts.exactFormula, 0);
  assert.equal(result.confidence, 'low');
  assert.equal(result.strongestPositives[0]?.source, 'product_flag');
});

test('invalid or stale stored profile values are ignored safely', () => {
  const result = scoreProductMatch(detail(formula()), profile({ skinType: 'dryish', sensitivity: 'unknown-value', concerns: ['rosacea'], goals: ['calm'], preferences: ['no_fragrance'] }));
  assert.equal(result.scoreStatus, 'insufficient_data');
  assert.equal(result.evidenceCounts.preference, 0);
});

test('each supported preference uses its exact catalog flag and missing flags stay unknown', () => {
  for (const [preference, mapping] of Object.entries(PREFERENCE_MAPPING)) {
    if (preference === 'none') continue;
    const preferenceFlags = mapping.matchFlags.map((key, index) => ({ id: index + 1, key, label: key.replaceAll('_', ' ') }));
    const result = scoreProductMatch(detail(formula([], [], preferenceFlags)), profile({ preferences: [preference] }));
    assert.equal(result.preferenceResults[0]?.status, 'match', preference);
  }
});

test('zero-valued components are excluded from the aggregate and kept out of displayed sub-scores', () => {
  const keys = ['may_cause_irritation', 'fragrance', 'synthetic_fragrance', 'essential_oil', 'eu_allergen'];
  const exactIngredients = keys.map((key, index) => ({
    id: 100 + index, position: index, name: `Ingredient ${index + 1}`, inciName: `INGREDIENT ${index + 1}`,
    rawToken: null, functions: [], description: null, attributes: [],
  }));
  const genericIngredients = keys.map((key, index) => ({
    id: 200 + index, position: index + keys.length, name: `Related ingredient ${index + 1}`, inciName: `RELATED INGREDIENT ${index + 1}`,
    rawToken: null, functions: [], description: null,
    attributes: [{ id: CATALOG_ATTRIBUTE_KEYS.indexOf(key) + 1, key, label: key, description: null, kind: 'concern' }],
  }));
  const ingredients = [...exactIngredients, ...genericIngredients];
  const analysis = keys.map((key, index) => formulaAnalysis(key, CATALOG_ATTRIBUTE_KEYS.indexOf(key) + 1, exactIngredients[index], 'concern'));
  const product = detail(formula(analysis, ingredients));
  const result = scoreProductMatch(product, profile({ concerns: ['redness'] }));
  assert.equal(result.subScores.concerns, null, 'a zero component is represented as unscored');
  assert.equal(result.score, null, 'zero-only evidence cannot create an arbitrary overall score');
  assert.ok(result.strongestConcerns.length > 0, 'the underlying warnings remain explainable');

  const hydrating = { id: 300, position: ingredients.length, name: 'Glycerin', inciName: 'GLYCERIN', rawToken: null, functions: [], description: null, attributes: [] };
  const withHydration = detail(formula([
    ...analysis,
    formulaAnalysis('hydrating', 3, hydrating, 'benefit'),
  ], [...ingredients, hydrating]));
  const mixed = scoreProductMatch(withHydration, profile({ skinType: 'dry', concerns: ['redness'] }));
  assert.equal(mixed.subScores.concerns, null, 'the zero concern component stays hidden');
  assert.ok(mixed.subScores.skin_type > 0);
  assert.equal(mixed.score, mixed.subScores.skin_type, 'the zero concern component is excluded from the weighted average');
});
