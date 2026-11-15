import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCancion } from '../src/lib/validate.js';

const song = { nombre: 'Beat', autor: 'ana', tempo: 90, pistas: [] };

test('validateCancion: publica defaults to true and accepts booleans only', () => {
  assert.equal(validateCancion(song).publica, true);
  assert.equal(validateCancion({ ...song, publica: false }).publica, false);
  assert.throws(() => validateCancion({ ...song, publica: 'no' }), /"publica" must be true or false/);
});
