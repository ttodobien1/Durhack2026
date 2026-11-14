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
