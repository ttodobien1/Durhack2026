import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffNotas } from '../src/lib/diff.js';

const n = (tono, inicio, duracion = 0.5, velocidad = 0.8) => ({ tono, inicio, duracion, velocidad });

test('identical pieces: everything is igual', () => {
  const notas = [n(57, 0), n(60, 0), n(64, 1)];
  const diff = diffNotas(notas, notas);
  assert.equal(diff.iguales.length, 3);
  assert.deepEqual([diff.nuevas, diff.borradas, diff.movidas], [[], [], []]);
});

test('same pitch at another time is a movida', () => {
  const diff = diffNotas([n(64, 2, 1)], [n(64, 2.5, 1)]);
  assert.deepEqual(diff.movidas, [{ antes: n(64, 2, 1), despues: n(64, 2.5, 1) }]);
  assert.deepEqual([diff.nuevas, diff.borradas, diff.iguales], [[], [], []]);
});

test('same onset with another pitch is a movida (contract example)', () => {
  const diff = diffNotas([n(59, 1)], [n(60, 1)]);
  assert.equal(diff.movidas.length, 1);
  assert.equal(diff.movidas[0].antes.tono, 59);
  assert.equal(diff.movidas[0].despues.tono, 60);
});

test('unrelated notes are nuevas and borradas', () => {
  const diff = diffNotas([n(59, 1)], [n(72, 3)]);
  assert.deepEqual(diff.borradas, [n(59, 1)]);
  assert.deepEqual(diff.nuevas, [n(72, 3)]);
  assert.equal(diff.movidas.length, 0);
});

test('transposed chord keeps voices paired low-to-high', () => {
  const diff = diffNotas([n(64, 0), n(76, 0)], [n(71, 0), n(83, 0)]);
  assert.deepEqual(
    diff.movidas.map((m) => [m.antes.tono, m.despues.tono]),
    [[64, 71], [76, 83]],
  );
});

test('far away changes are not considered moves', () => {
  const diff = diffNotas([n(60, 0)], [n(60, 12)]);
  assert.equal(diff.movidas.length, 0);
  assert.equal(diff.nuevas.length, 1);
  assert.equal(diff.borradas.length, 1);
});

test('duplicated notes are matched one by one', () => {
  const diff = diffNotas([n(60, 0), n(60, 0)], [n(60, 0)]);
  assert.equal(diff.iguales.length, 1);
  assert.equal(diff.borradas.length, 1);
});

test('float noise in inicio does not break equality', () => {
  const diff = diffNotas([n(60, 1 / 3)], [n(60, 0.33333)]);
  assert.equal(diff.iguales.length, 1);
});

test('every note ends up in exactly one bucket', () => {
  const antes = [n(57, 0), n(60, 0), n(64, 0), n(62, 1), n(65, 2), n(67, 3)];
  const despues = [n(57, 0), n(60, 0), n(65, 0), n(62, 1.5), n(69, 2), n(72, 3.5), n(48, 3)];
  const diff = diffNotas(antes, despues);
  assert.equal(diff.iguales.length + diff.movidas.length + diff.borradas.length, antes.length);
  assert.equal(diff.iguales.length + diff.movidas.length + diff.nuevas.length, despues.length);
});

// --- Optimal pairing (Hungarian assignment) ----------------------------------------------------------------------

import { moveCost, tonnetzSteps } from '../src/lib/diff.js';
import { minCostAssignment } from '../src/lib/assignment.js';

const totalCost = (d) => d.movidas.reduce((s, m) => s + moveCost(m.antes, m.despues), 0) + d.nuevas.length + d.borradas.length;

test('optimal pairing beats closest-first: the riff moved about a beat later', () => {
  const antes = [n(60, 0), n(60, 1)];
  const despues = [n(60, 0.9), n(60, 2)];
  const diff = diffNotas(antes, despues);
  assert.deepEqual(diff.movidas.map((m) => [m.antes.inicio, m.despues.inicio]), [[0, 0.9], [1, 2]]);
  const greedy = diffNotas(antes, despues, { greedy: true });
  assert.deepEqual(greedy.movidas.map((m) => [m.antes.inicio, m.despues.inicio]).sort(), [[0, 2], [1, 0.9]]);
  assert.ok(totalCost(diff) < totalCost(greedy));
});

test('minCostAssignment matches brute force on small matrices', () => {
  const perms = (k) => (k === 0 ? [[]] : perms(k - 1).flatMap((p) => Array.from({ length: k }, (_, i) => [...p.slice(0, i), k - 1, ...p.slice(i)])));
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 30; trial++) {
    const k = 1 + (trial % 5);
    const cost = Array.from({ length: k }, () => Array.from({ length: k }, () => Math.round(rand() * 20)));
    const best = Math.min(...perms(k).map((p) => p.reduce((s, c, r) => s + cost[r][c], 0)));
    const got = minCostAssignment(cost).reduce((s, c, r) => s + cost[r][c], 0);
    assert.equal(got, best);
  }
});

test('on random inputs the optimal diff never costs more than greedy, and keeps every note', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (k) => Math.floor(rand() * k);
  for (let trial = 0; trial < 200; trial++) {
    const make = (len) => Array.from({ length: len }, () => n(57 + pick(8), pick(8) * 0.5));
    const antes = make(1 + pick(8));
    const despues = make(1 + pick(8));
    const opt = diffNotas(antes, despues);
    const greedy = diffNotas(antes, despues, { greedy: true });
    assert.ok(totalCost(opt) <= totalCost(greedy) + 1e-9, `trial ${trial}`);
    assert.equal(opt.iguales.length + opt.movidas.length + opt.borradas.length, antes.length);
    assert.equal(opt.iguales.length + opt.movidas.length + opt.nuevas.length, despues.length);
  }
});

test('Tonnetz steps: fifths and thirds are 1, seconds and the tritone 2, octaves 0', () => {
  assert.deepEqual([0, 7, 5, 4, 3, 8, 9, 2, 1, 6, 10, 11, 12, -7].map(tonnetzSteps), [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 0, 1]);
});
