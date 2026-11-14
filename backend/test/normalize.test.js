import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeKey, normalizeText, splitTags } from '../src/lib/normalize.js';

test('normalizeText removes accents and case', () => {
  assert.equal(normalizeText('  Salsa  Romántica '), 'salsa romantica');
});

test('splitTags splits on commas and spaces', () => {
  assert.deepEqual(splitTags('salsa romántica, Bolero'), ['salsa', 'romantica', 'bolero']);
  assert.deepEqual(splitTags(['Rap', 'trap']), ['rap', 'trap']);
});

test('splitTags joins compound style names into one tag', () => {
  assert.deepEqual(splitTags('Rap, boom bap, Lo-Fi'), ['rap', 'boombap', 'lofi']);
  assert.deepEqual(splitTags(['rap', 'lo-fi']), ['rap', 'lofi']);
  assert.deepEqual(splitTags('hip-hop new orleans'), ['hiphop', 'neworleans']);
  assert.deepEqual(splitTags('cha-cha-chá'), ['chachacha']);
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
