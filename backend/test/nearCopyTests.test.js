// The near-copy test pieces (data/scripts/make_near_copy_tests.py) must keep showing the warning: each disguised copy
// of a public-domain melody is caught, the original control tune is not, and no real library melody is flagged.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fingerprint, tooClose, typicalDistance, windowFingerprints } from '../src/lib/fingerprint.js';
import { isNearCopyTest } from '../src/repo/similares.js';

const dir = new URL('../../data/piezas/', import.meta.url);
const melodies = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => [JSON.parse(readFileSync(new URL(f, dir)))].flat())
  .filter((p) => p.tipo === 'melodia');
const isTest = isNearCopyTest;
const library = melodies.filter((p) => !isTest(p)).map((p) => ({ pieza: { id: p.id, nombre: p.nombre, autor: p.autor, parent_id: p.parent_id }, f: fingerprint(p), fs: windowFingerprints(p) }));
const scale = typicalDistance(library);
const check = (p) => tooClose(p, library, { autor: p.autor, id: p.id, parentId: p.parent_id, scale });

test('each near-copy test piece warns about the melody it copies; the control does not', () => {
  const expected = { 'p-9001': 'p-502', 'p-9002': 'p-503', 'p-9003': 'p-501', 'p-9004': 'p-504', 'p-9005': 'p-512', 'p-9006': null };
  for (const [id, original] of Object.entries(expected)) {
    const piece = melodies.find((p) => p.id === id);
    assert.ok(piece, `${id} exists`);
    assert.equal(check(piece)?.id ?? null, original, `${id} ${piece.nombre}`);
  }
});

test('the test tag is recognized as stored by the server (normalized) and as written in the data', () => {
  assert.ok(isNearCopyTest({ estilo: ['test', 'nearcopydemo'] }));
  assert.ok(isNearCopyTest({ estilo: ['near-copy-demo'] }));
  assert.ok(!isNearCopyTest({ estilo: ['rap', 'lo-fi'] }));
});

test('no real library melody is flagged as a near-copy', () => {
  const flagged = melodies.filter((p) => !isTest(p) && check(p)).map((p) => p.id);
  assert.deepEqual(flagged, []);
});
