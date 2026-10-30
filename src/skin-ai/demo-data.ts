/** Fully synthetic data for the demo. It is never written to SQLite or mixed with account data. */
export const SKIN_AI_DEMO_QUESTION = 'Why has my irritation rating increased this week?';

export const SKIN_AI_DEMO_CONTEXT: Record<string, unknown> = {
  'skin-profile': {
    skinType: 'combination', sensitivity: 'sensitive', concerns: ['dryness', 'redness'],
    goals: ['support skin barrier'], preferences: [],
  },
  personalFacts: [
    'DEMO SAMPLE ONLY: These are fictional user reports for demonstration.',
    'Seven-day self-reported irritation ratings: average 2.7/5 across 6 recorded check-ins, 1/5 on 2026-04-02 to 4/5 on 2026-04-08 (+3). This is a report, not a diagnosis.',
    'On 2026-04-05 the demo user marked starting a new product. Irritation was 2/5 on the previous recorded day and 3/5 that day. Timing alone cannot show cause; the product was not identified in the check-in.',
    'AM routine: gentle cleanser, moisturizer, sunscreen. PM routine: cleanser, demo exfoliating serum, moisturizer.',
    'Routine logs: 8 completed and 2 explicitly skipped step logs this week; other scheduled days have no recorded outcome.',
    'Water intake: 5.0 glasses/day average across 4 logged days this week. Missing days are unrecorded, not zero. This does not establish a cause for skin changes.',
  ],
  'local-product-cache': [
    { productId: 'demo-1', name: 'Demo Exfoliating Serum', brand: 'Synthetic demo brand', formulaAvailable: true, ingredients: [{ name: 'Lactic Acid', functions: ['exfoliant'], attributes: [] }, { name: 'Glycerin', functions: ['humectant'], attributes: [] }] },
    { productId: 'demo-2', name: 'Demo Barrier Moisturizer', brand: 'Synthetic demo brand', formulaAvailable: true, ingredients: [{ name: 'Glycerin', functions: ['humectant'], attributes: [] }, { name: 'Ceramide NP', functions: ['skin-conditioning agent'], attributes: [] }] },
  ],
  catalogEvidence: [
    { kind: 'product', title: 'Demo serum ingredient list', text: 'Synthetic demo fixture: Lactic Acid and Glycerin are shown as listed ingredients. This is fictional product data for the demonstration.', source: 'Synthetic demo fixture' },
    { kind: 'product', title: 'Demo moisturizer ingredient list', text: 'Synthetic demo fixture: Glycerin and Ceramide NP are shown as listed ingredients. This is fictional product data for the demonstration.', source: 'Synthetic demo fixture' },
  ],
  dataLimitations: ['All profile, routine, check-in, water, and product records in this demo are synthetic. Do not interpret them as real user data or verified product formulations.'],
  photoAnalysisStatus: 'AI photo analysis is disabled; no visual observations are being made.',
};
