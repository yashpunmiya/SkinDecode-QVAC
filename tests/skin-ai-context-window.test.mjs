import test from 'node:test';
import assert from 'node:assert/strict';
import { fitContextNotes } from '../src/skin-ai/context-window.ts';

test('keeps the notes relevant to the current question before less relevant history', () => {
  const notes = [
    'Private app notes for this question (use only what is relevant; do not describe these notes):',
    'Unrelated timeline detail: '.padEnd(120, 'x'),
    'Skin profile — skin type: combination; sensitivity: moderate.',
    '[E1] Face wash formula — listed ingredients: Glycerin; resolved findings: hydrating.',
  ].join('\n');
  const result = fitContextNotes(notes, 120, 'Compare these products for my skin');
  assert.match(result.text, /Skin profile/);
  assert.match(result.text, /\[E1\]/);
  assert.equal(result.omitted, 2);
});

test('shortens an oversized relevant evidence note without cutting context arbitrarily at the end', () => {
  const notes = [
    'Private app notes for this question (use only what is relevant; do not describe these notes):',
    'Skin profile — combination skin.',
    `[E1] Formula evidence — ${'Glycerin ingredient detail '.repeat(30)}`,
    'Data limitation: no concentration data is available.',
  ].join('\n');
  const result = fitContextNotes(notes, 180, 'Explain this product formula');
  assert.match(result.text, /Data limitation/);
  assert.match(result.text, /\[E1\]/);
  assert.match(result.text, /details shortened/);
  assert.ok(result.text.length <= 180);
});
