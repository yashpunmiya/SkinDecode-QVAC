import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPendingWaterLogs } from '../src/water/native-water-log-format.ts';

test('native closed-app water logs retain their local date and action ID for sync', () => {
  const grouped = groupPendingWaterLogs([
    '2026-10-10|action-a',
    '2026-10-10|action-b',
    '2026-10-09|action-c',
    'action-without-date',
    'not-a-date|action-d',
  ]);

  assert.deepEqual([...grouped], [
    ['2026-10-10', ['action-a', 'action-b']],
    ['2026-10-09', ['action-c']],
  ]);
});
