import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityGuardAnswer } from '../src/skin-ai/response-guard.ts';
import { buildEvidenceSynthesisInstructions } from '../src/skin-ai/prompt.ts';

test('attached photos never produce a claimed visual comparison', () => {
  const answer=buildCapabilityGuardAnswer({question:'Can you compare my face?',context:{photos:[{explicitlySelected:true}]}});
  assert.match(answer,/can’t inspect photo pixels/i);
  assert.match(answer,/haven’t compared your face/i);
});

test('routine request goes to QVAC with instructions to synthesize exact evidence, not invent a calendar', () => {
  const answer=buildCapabilityGuardAnswer({question:'Take this routine',context:{routine:{steps:[{period:'am',name:'Salicylic cleanser',status:'pending'}]}}});
  assert.equal(answer,null);
  const instructions=buildEvidenceSynthesisInstructions('Take this routine',{routine:{steps:[{period:'am',name:'Salicylic cleanser',status:'pending'}]}});
  assert.match(instructions,/Synthesize the routine instead of echoing its rows/);
  assert.match(instructions,/pending means unrecorded/i);
});

test('product suitability uses a synthesis rubric grounded in calculated app signals', () => {
  const instructions=buildEvidenceSynthesisInstructions('Will this suit my skin type?',{product:{skinMatch:{score:42,confidence:'low',concerns:['irritation signal']}}});
  assert.match(instructions,/app-calculated Skin Match score and confidence/);
  assert.match(instructions,/connect the strongest supplied positive and caution signals/);
});

test('routine suitability questions use routine evidence instead of a generic Skin Match explainer', () => {
  const instructions = buildEvidenceSynthesisInstructions(
    'Check my routine and see what ingredients or products do not suit my skin type',
    {
      routine: { steps: [{ name: 'Barrier Face Wash', period: 'am' }] },
      'skin-profile': { skinType: 'combination', sensitivity: 'high' },
      'local-product-cache': [{ name: 'Barrier Face Wash', formulaFindings: [{ kind: 'concern', label: 'Potential irritation', ingredients: ['Fragrance'] }] }],
    },
  );
  assert.match(instructions, /Analyze the routine products, not SkinDecode as an app/);
  assert.match(instructions, /Name each relevant product exactly as supplied/);
  assert.doesNotMatch(instructions, /Explain what the app-calculated Skin Match score/);
  assert.match(instructions, /Do not explain the Skin Match scoring system/);
});

test('product synthesis explicitly states limits and rejects unsupported alternatives', () => {
  const instructions=buildEvidenceSynthesisInstructions('Is it suitable for me?',{product:{name:'Unknown cream',formulaAvailable:false}});
  assert.match(instructions,/If no calculated score exists/);
  assert.match(instructions,/Do not add ingredients, concentrations, symptoms/);
});

test('formula analysis uses only the evidence references actually included in the request', () => {
  const withEvidence=buildEvidenceSynthesisInstructions('Analyse ingredients',{catalogEvidence:[{title:'Exact cleanser formula'},{title:'Second product formula'}],product:{}});
  assert.match(withEvidence,/Available reference IDs: \[E1\], \[E2\]/);
  assert.match(withEvidence,/Do not dump or enumerate the whole formula/);
  assert.match(withEvidence,/Ingredient names must match the exact supplied formula/);
  const withoutEvidence=buildEvidenceSynthesisInstructions('Analyse ingredients',{product:{}});
  assert.match(withoutEvidence,/No reference IDs were supplied; do not create citations/);
});
