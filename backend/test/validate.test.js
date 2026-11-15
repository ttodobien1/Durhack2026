import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCancion } from '../src/lib/validate.js';

const song = { nombre: 'Beat', autor: 'ana', tempo: 90, pistas: [] };

test('validateCancion: publica defaults to true and accepts booleans only', () => {
  assert.equal(validateCancion(song).publica, true);
  assert.equal(validateCancion({ ...song, publica: false }).publica, false);
  assert.throws(() => validateCancion({ ...song, publica: 'no' }), /"publica" must be true or false/);
});

test('validateCancion: descripcion is optional, trimmed and capped at 300 characters', () => {
  assert.equal(validateCancion(song).descripcion, null);
  assert.equal(validateCancion({ ...song, descripcion: '  Late-night boom bap  ' }).descripcion, 'Late-night boom bap');
  assert.equal(validateCancion({ ...song, descripcion: '' }).descripcion, '');
  assert.throws(() => validateCancion({ ...song, descripcion: 'x'.repeat(301) }), /at most 300/);
  assert.throws(() => validateCancion({ ...song, descripcion: 5 }), /must be a string/);
});
