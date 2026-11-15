import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, fingerprint, magnitudes, similitud, tooClose, TOO_CLOSE, typicalDistance, windowFingerprints } from '../src/lib/fingerprint.js';

const melody = { tipo: 'melodia', notas: [[60, 0, 1], [62, 1, 0.5], [64, 1.5, 0.5], [67, 2, 1], [65, 3, 0.5], [64, 3.5, 0.5], [62, 4, 2], [60, 6, 2]].map(([tono, inicio, duracion]) => ({ tono, inicio, duracion, velocidad: 0.8 })) };
const map = (p, fn) => ({ ...p, notas: p.notas.map(fn) });
const entry = (pieza, notasFrom = melody) => ({ pieza, f: fingerprint({ ...notasFrom, tipo: pieza.tipo }) });

test('fingerprints ignore transposition, inversion and time shifts', () => {
  const f = fingerprint(melody);
  for (const variant of [map(melody, (n) => ({ ...n, tono: n.tono + 5 })), map(melody, (n) => ({ ...n, tono: 120 - n.tono })), map(melody, (n) => ({ ...n, inicio: n.inicio + 1.25 }))]) {
    assert.ok(distance(f, fingerprint(variant)) < 1e-9);
  }
  assert.ok(distance(f, fingerprint(map(melody, (n, i) => (i === 2 ? { ...n, tono: n.tono + 1 } : n)))) > 0.01, 'a changed note does change it');
});

test('drums are fingerprinted per voice (kick, snare, hats, other percussion)', () => {
  const beat = { tipo: 'ritmo', notas: [{ tono: 36, inicio: 0, duracion: 0.25, velocidad: 1 }, { tono: 38, inicio: 1, duracion: 0.25, velocidad: 1 }] };
  const swapped = { tipo: 'ritmo', notas: [{ tono: 38, inicio: 0, duracion: 0.25, velocidad: 1 }, { tono: 36, inicio: 1, duracion: 0.25, velocidad: 1 }] };
  assert.equal(fingerprint(beat).length, 32);
  assert.ok(distance(fingerprint(beat), fingerprint(swapped)) < 1e-9, 'each voice alone is shift-invariant');
  assert.deepEqual(magnitudes(Array(16).fill(0), 8), Array(8).fill(0), 'an empty voice is all zeros, not NaN');
});

test('similitud is 100 for a copy and falls with distance', () => {
  assert.equal(similitud(0, 1), 100);
  assert.ok(similitud(0.09, 1) > similitud(0.3, 1));
  assert.equal(similitud(1.2, 1), 0, 'as far as two typical pieces = 0%');
  assert.equal(similitud(0.5, 2), 75, 'the scale is per type');
});

test('tooClose flags near-copies by others, but not your own pieces or your fork family', () => {
  const copy = map(melody, (n) => ({ ...n, tono: n.tono + 3 }));
  const lib = [
    entry({ id: 'p-1', autor: 'ana', tipo: 'melodia', parent_id: null }),
    entry({ id: 'p-2', autor: 'luis', tipo: 'melodia', parent_id: 'p-1' }),
  ];
  assert.equal(tooClose(copy, lib, { autor: 'bob' })?.id, 'p-1');
  assert.equal(tooClose(copy, lib, { autor: 'ana', id: 'p-9', parentId: null })?.id, 'p-2', 'your own piece is skipped, ana-family fork by luis still counts');
  assert.equal(tooClose(copy, lib, { autor: 'bob', id: 'p-3', parentId: 'p-2' }), null, 'a fork of p-2 is in the p-1 family');
  const different = { tipo: 'melodia', notas: [{ tono: 61, inicio: 0.5, duracion: 3, velocidad: 0.8 }, { tono: 66, inicio: 3.75, duracion: 0.25, velocidad: 0.8 }] };
  assert.equal(tooClose(different, lib, { autor: 'bob' }), null);
  assert.ok(TOO_CLOSE < 0.2);
});

test('typicalDistance is the median distance and never below twice the near-copy threshold', () => {
  const pts = [[0], [1], [3]].map((f) => ({ f }));
  assert.equal(typicalDistance(pts), 2); // distances 1, 2, 3
  assert.equal(typicalDistance([{ f: [0] }, { f: [0] }]), TOO_CLOSE * 2);
});

test('a 2-bar excerpt of a longer piece by someone else is caught (windows), even transposed', () => {
  const long = { tipo: 'melodia', compases: 4, notas: [
    ...[60, 62, 64, 65, 67, 69, 67, 65].map((tono, i) => ({ tono, inicio: i, duracion: 1, velocidad: 0.8 })),
    ...[72, 71, 69, 71, 72, 74, 76, 77].map((tono, i) => ({ tono, inicio: 8 + i * 0.5 + (i % 3) * 0.25, duracion: 0.5, velocidad: 0.7 })),
  ] };
  const lib = [{ pieza: { id: 'p-1', autor: 'ana', tipo: 'melodia', parent_id: null }, f: fingerprint(long), fs: windowFingerprints(long) }];
  const excerpt = { tipo: 'melodia', compases: 2, notas: long.notas.filter((n) => n.inicio < 8).map((n) => ({ ...n, tono: n.tono + 2 })) };
  assert.ok(distance(fingerprint(excerpt), fingerprint(long)) > TOO_CLOSE, 'whole pieces alone would miss it');
  assert.equal(tooClose(excerpt, lib, { autor: 'bob' })?.id, 'p-1');
});

test('pca2 finds the direction of largest spread and describes it in words', async () => {
  const { pca2, describeAxis } = await import('../src/lib/fingerprint.js');
  // Points spread along x = y (plus a little noise in the other direction): one main axis.
  const pts = Array.from({ length: 50 }, (_, i) => [i, i + ((i * 7) % 3) * 0.1, 5]);
  const { points, axes } = pca2(pts);
  assert.equal(points.length, 50);
  assert.ok(axes[0].share > 0.95, `PC1 carries the spread (${axes[0].share})`);
  assert.ok(Math.abs(Math.abs(axes[0].weights[0]) - Math.abs(axes[0].weights[1])) < 0.05, 'x and y weigh the same');
  const words = describeAxis([0.7, -0.2, 0.1], ['a', 'b', 'c']);
  assert.deepEqual(words, { menos: ['b'], mas: ['a', 'c'] });
  assert.deepEqual(pca2([[1, 2]]).axes, [], 'too few pieces: no axes');
});
