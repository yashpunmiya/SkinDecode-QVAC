import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeIntelligence, simulateRoutine, stableIntelligenceFingerprint } from '../src/skin-ai/skin-intelligence.ts';

const routine = { routines: [{ id:'r', userId:'u', name:'Daily', isActive:true, createdAt:'', updatedAt:'', deletedAt:null, cloudVersion:0 }], steps:[], logs:[] };
function dataset(checks=[]) { return { checks, water:[], routines:structuredClone(routine), products:new Map(), profile:null }; }

test('insufficient histories produce limitations without invented trends or water zeros', () => {
  const result = analyzeIntelligence(dataset(), new Date('2026-10-28T12:00:00'));
  assert.deepEqual(result.findings, []);
  assert.equal(result.trends.length, 0);
  assert.equal(result.water, null);
  assert.ok(result.limitations.some(value => /fewer than three/i.test(value)));
  assert.ok(result.limitations.some(value => /not zero/i.test(value)));
});

test('trend observations need at least three check-ins and preserve temporal caveats', () => {
  const base={userId:'u',ratings:{acne:1,redness:1,dryness:1,oiliness:1,irritation:1},amRoutineCompleted:true,pmRoutineCompleted:true,newProductStarted:false,photoUri:null,updatedAt:''};
  const checks=[0,1,2].map((offset)=>({...base,localDate:`2026-10-${String(26+offset).padStart(2,'0')}`,ratings:{...base.ratings,irritation:offset+1},newProductStarted:offset===1}));
  const result=analyzeIntelligence(dataset(checks),new Date('2026-10-28T12:00:00'));
  const finding=result.findings.find(item=>item.id==='trend:irritation');
  assert.ok(finding);
  assert.match(finding.detail,/timing does not establish a cause/i);
});

test('routine simulation changes only the proposed copy and fingerprint follows data', () => {
  const data=dataset();
  const before=JSON.stringify(data.routines);
  const simulated=simulateRoutine(data,{removeProductId:17});
  assert.equal(JSON.stringify(data.routines),before);
  assert.ok(simulated.changes.length);
  assert.equal(stableIntelligenceFingerprint({a:1}),stableIntelligenceFingerprint({a:1}));
  assert.notEqual(stableIntelligenceFingerprint({a:1}),stableIntelligenceFingerprint({a:2}));
});

test('dashboard data layer has no network or Supabase dependency', async () => {
  const source=await readFile(new URL('../src/skin-ai/intelligence-service.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\s+['"][^'"]*(?:supabase|axios|https?:\/\/)[^'"]*['"]/i);
  assert.doesNotMatch(source,/\bfetch\s*\(/i);
});

test('report cache uses the account-scoped local cache table and 30-day analysis remains bounded', async () => {
  const storage=await readFile(new URL('../src/skin-ai/storage.ts',import.meta.url),'utf8');
  assert.match(storage,/cache_key,value_json,cached_at\) VALUES\(\?,\?,\?,\?\)/);
  assert.match(storage,/userId, key, JSON\.stringify\(value\)/);
  const base={userId:'u',ratings:{acne:2,redness:2,dryness:2,oiliness:2,irritation:2},amRoutineCompleted:true,pmRoutineCompleted:false,newProductStarted:false,photoUri:null,updatedAt:''};
  const checks=Array.from({length:30},(_,i)=>({...base,localDate:`2026-10-${String(i+1).padStart(2,'0')}`}));
  const started=performance.now(); const result=analyzeIntelligence(dataset(checks),new Date('2026-10-30T12:00:00'));
  assert.ok(performance.now()-started<500,'30 check-ins should analyze locally within a generous 500ms budget');
  assert.equal(result.checkins,7);
});
