import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRemoteMerge, isOptimisticConflict, runSingleFlight, snapshotForUser } from '../src/routine/sync-policy.ts';
import { getAdherence, getStreak, localDateKey } from '../src/routine/models.ts';

const routine = (id, userId) => ({
  id, userId, name: 'Daily', isActive: true, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, cloudVersion: 0,
});

const step = (id, userId = 'user-a', routineId = 'routine-a') => ({
  id, routineId, userId, title: id, kind: 'cleanse', period: 'am', daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  frequencyPerWeek: 7, notes: null, position: 0, enabled: true, productId: null, sourceScanId: null,
  recommendationId: null, ingredientContext: null, conflictRefs: [], createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, cloudVersion: 0,
});

const log = (stepId, date, overrides = {}) => ({
  id: `${stepId}-${date}`, userId: 'user-a', routineId: 'routine-a', stepId, logDate: date,
  period: 'am', status: 'completed', occurredAt: `${date}T08:00:00.000Z`, notes: null,
  createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, deletedAt: null,
  cloudVersion: 0, ...overrides,
});

test('a clean install can accept remote routine rows for restore', () => {
  assert.equal(decideRemoteMerge({
    expectedUserId: 'user-a', localUserId: null, localDirty: false, localCloudVersion: 0,
    remoteUserId: 'user-a', remoteCloudVersion: 4,
  }), 'apply');
});

test('a local pending write remains when the cloud has not advanced its base version', () => {
  assert.equal(decideRemoteMerge({
    expectedUserId: 'user-a', localUserId: 'user-a', localDirty: true, localCloudVersion: 4,
    remoteUserId: 'user-a', remoteCloudVersion: 4,
  }), 'keep-local');
});

test('cloud wins a concurrent stale-version write so it cannot be silently overwritten', () => {
  assert.equal(decideRemoteMerge({
    expectedUserId: 'user-a', localUserId: 'user-a', localDirty: true, localCloudVersion: 4,
    remoteUserId: 'user-a', remoteCloudVersion: 5,
  }), 'cloud-conflict-wins');
});

test('owner mismatch is rejected and snapshots are isolated by user, routine, and step', () => {
  assert.equal(decideRemoteMerge({
    expectedUserId: 'user-b', localUserId: null, localDirty: false, localCloudVersion: 0,
    remoteUserId: 'user-a', remoteCloudVersion: 1,
  }), 'reject-owner');

  const mixed = {
    routines: [routine('routine-a', 'user-a'), routine('routine-b', 'user-b')],
    steps: [step('step-a', 'user-a', 'routine-a'), step('step-b', 'user-b', 'routine-b'), step('orphan', 'user-b', 'routine-a')],
    logs: [log('step-a', '2026-01-01'), log('step-b', '2026-01-01', { userId: 'user-b', routineId: 'routine-b' })],
  };
  const forUserA = snapshotForUser('user-a', mixed);
  assert.deepEqual(forUserA.routines.map((row) => row.id), ['routine-a']);
  assert.deepEqual(forUserA.steps.map((row) => row.id), ['step-a']);
  assert.deepEqual(forUserA.logs.map((row) => row.stepId), ['step-a']);
});

test('streak requires every scheduled step and ignores deleted check-ins', () => {
  const steps = [step('cleanse'), step('moisturizer')];
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const partialLogs = dates.map((date) => log('cleanse', date));
  assert.equal(getStreak(partialLogs, steps, 'am', new Date(2026, 0, 4, 12)), 0);

  const fullLogs = dates.flatMap((date) => [log('cleanse', date), log('moisturizer', date)]);
  fullLogs.push(log('cleanse', '2026-01-04', { deletedAt: '2026-01-04T09:00:00.000Z' }));
  assert.equal(getStreak(fullLogs, steps, 'am', new Date(2026, 0, 4, 12)), 3);
});

test('date-only adherence stays on local calendar days over a DST boundary', () => {
  const oldTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const from = new Date(2026, 2, 7, 12);
    const to = new Date(2026, 2, 10, 12);
    const localDates = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'];
    const steps = [step('cleanse'), step('moisturizer')];
    const logs = localDates.map((date) => log('cleanse', date));
    const result = getAdherence(logs, steps, from, to);
    assert.equal(localDateKey(new Date(2026, 2, 8, 0)), '2026-03-08');
    assert.equal(result.due, 8);
    assert.equal(result.completed, 4);
    assert.equal(result.percentage, 50);
  } finally {
    if (oldTz === undefined) delete process.env.TZ;
    else process.env.TZ = oldTz;
  }
});

test('optimistic conflict errors are recognized for bounded reconciliation retries', () => {
  assert.equal(isOptimisticConflict({ code: '40001', message: 'serialization_failure' }), true);
  assert.equal(isOptimisticConflict({ code: 'PGRST116', message: 'not found' }), false);
});

test('sync calls coalesce per user while separate accounts remain isolated', async () => {
  const active = new Map();
  let calls = 0;
  let release;
  const run = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const firstA = runSingleFlight(active, 'user-a', run);
  const secondA = runSingleFlight(active, 'user-a', run);
  const firstB = runSingleFlight(active, 'user-b', async () => 'account-b');
  assert.equal(await firstB, 'account-b');
  assert.equal(calls, 1);
  release('account-a');
  assert.equal(await firstA, 'account-a');
  assert.equal(await secondA, 'account-a');
  assert.equal(active.size, 0);
});
