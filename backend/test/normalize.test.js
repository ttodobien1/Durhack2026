import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeKey, normalizeText, splitTags } from '../src/lib/normalize.js';

test('normalizeText removes accents and case', () => {
  assert.equal(normalizeText('  Salsa  Romántica '), 'salsa romantica');
});

test('splitTags splits on commas, spaces and hyphens', () => {
  assert.deepEqual(splitTags('salsa romántica, Bolero'), ['salsa', 'romantica', 'bolero']);
  assert.deepEqual(splitTags(['Salsa', 'cha-cha']), ['salsa', 'cha', 'cha']);
});

test('normalizeKey understands common key spellings', () => {
  assert.equal(normalizeKey('Am'), 'Am');
  assert.equal(normalizeKey('a minor'), 'Am');
  assert.equal(normalizeKey('La menor'), 'Am');
  assert.equal(normalizeKey('Do mayor'), 'C');
  assert.equal(normalizeKey('F# major'), 'F#');
  assert.equal(normalizeKey('Sib'), 'Bb');
  assert.equal(normalizeKey('C#m'), 'C#m');
  assert.equal(normalizeKey('Bbm'), 'Bbm');
  assert.equal(normalizeKey(''), null);
  assert.equal(normalizeKey('modal'), 'modal');
});
