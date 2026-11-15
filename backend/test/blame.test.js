import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blame, blameSummary } from '../src/lib/credits.js';

const n = (tono, inicio) => ({ tono, inicio, duracion: 0.5, velocidad: 0.8 });

test('blame of a fork with one moved note: that note is the forker\'s, the rest the parent author\'s', () => {
  const parent = { id: 'p-1', autor: 'ana', parent_id: null, notas: [n(57, 0), n(60, 1), n(64, 2), n(62, 3)] };
  const fork = { id: 'p-2', autor: 'santiago', parent_id: 'p-1', notas: parent.notas.map((x, i) => (i === 2 ? { ...x, inicio: 2.5 } : x)) };
  const chain = new Map([parent, fork].map((p) => [p.id, p]));
  const summary = blameSummary(fork, blame(fork.id, chain));
  assert.deepEqual(summary.notas.map((x) => x.autor), ['ana', 'ana', 'santiago', 'ana']);
  assert.deepEqual(summary.autores, [
    { autor: 'ana', notas: 3, porcentaje: 75 },
    { autor: 'santiago', notas: 1, porcentaje: 25 },
  ]);
  assert.deepEqual(summary.notas[2], { ...fork.notas[2], autor: 'santiago' });
});

test('an original piece is all its author\'s; an empty piece has no authors', () => {
  const p = { id: 'p-9', autor: 'luis', parent_id: null, notas: [n(60, 0), n(62, 1)] };
  assert.deepEqual(blameSummary(p, blame(p.id, new Map([[p.id, p]]))).autores, [{ autor: 'luis', notas: 2, porcentaje: 100 }]);
  const empty = { id: 'p-8', autor: 'luis', parent_id: null, notas: [] };
  assert.deepEqual(blameSummary(empty, blame(empty.id, new Map([[empty.id, empty]]))), { autores: [], notas: [] });
});
