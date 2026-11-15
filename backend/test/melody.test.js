import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareMelodies, detectKey, melodyLine, rankByMelody, relativeKey, transposeKey } from '../src/lib/melody.js';

const famous = JSON.parse(readFileSync(new URL('../../data/piezas/famous-melodies.json', import.meta.url), 'utf8'));
const byName = (text) => famous.find((p) => p.nombre.includes(text));

// A sloppy human version of a piece: another key, another speed, an octave lower, a bit off the grid.
function hum(pieza, { shift = -5, speed = 1.3, drop = [], wrong = {} } = {}) {
  return pieza.notas
    .filter((_, i) => !drop.includes(i))
    .map((n, i) => ({
      tono: n.tono + shift - 12 + (wrong[i] ?? 0),
      inicio: Math.round(n.inicio * speed * 4) / 4 + (i % 3 === 1 ? 0.05 : 0),
      duracion: n.duracion * speed,
      velocidad: 0.8,
    }));
}

test('a melody matches itself perfectly', () => {
  const elise = byName('Für Elise');
  assert.equal(compareMelodies(elise.notas, elise.notas).similitud, 1);
});

test('transposed and slower humming still finds the right melody first', () => {
  for (const pieza of famous) {
    const [best] = rankByMelody(hum(pieza), famous);
    assert.equal(best?.pieza.id, pieza.id, `${pieza.nombre} was matched as ${best?.pieza.nombre}`);
    assert.ok(best.similitud >= 0.8, `${pieza.nombre}: ${best.similitud}`);
  }
});

test('a fragment with a missing note and a wrong note is still recognised', () => {
  const elise = byName('Für Elise');
  const fragment = hum(elise, { drop: [3, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34], wrong: { 6: 1 } });
  const [best] = rankByMelody(fragment, famous);
  assert.equal(best.pieza.id, elise.id);
  assert.ok(best.similitud >= 0.6, String(best.similitud));
});

test('repeated notes merged into one long note still match', () => {
  const ode = byName('Ode to Joy');
  // "E E F G G" hummed as "E F G": drop the second note of every repeated pair
  const merged = ode.notas.filter((n, i) => i === 0 || ode.notas[i - 1].tono !== n.tono);
  const [best] = rankByMelody(merged, famous);
  assert.equal(best.pieza.id, ode.id);
});

test('transposition is reported in semitones', () => {
  const twinkle = byName('Twinkle');
  const up2 = twinkle.notas.map((n) => ({ ...n, tono: n.tono + 2 }));
  assert.equal(compareMelodies(up2, twinkle.notas).transponer, 2);
  const down3 = twinkle.notas.map((n) => ({ ...n, tono: n.tono - 15 }));
  assert.equal(compareMelodies(down3, twinkle.notas).transponer, -3);
});

test('an unrelated tune scores low', () => {
  const jingle = byName('Jingle Bells');
  const mountain = byName('Mountain King');
  assert.ok(compareMelodies(hum(jingle), mountain.notas).similitud < 0.5);
});

test('melodyLine keeps the top note of chords', () => {
  const line = melodyLine([
    { tono: 60, inicio: 0, duracion: 1 },
    { tono: 64, inicio: 0, duracion: 1 },
    { tono: 67, inicio: 1, duracion: 1 },
  ]);
  assert.deepEqual(line.map((n) => n.tono), [64, 67]);
});

test('key detection', () => {
  assert.equal(detectKey(byName('Für Elise').notas), 'Am');
  assert.equal(detectKey(byName('Twinkle').notas), 'C');
  assert.equal(relativeKey('Am'), 'C');
  assert.equal(relativeKey('C'), 'Am');
  assert.equal(detectKey([]), null);
});

test('transposeKey moves a key by semitones', () => {
  assert.equal(transposeKey('Am', -5), 'Em');
  assert.equal(transposeKey('C', 2), 'D');
  assert.equal(transposeKey('Bm', 1), 'Cm');
  assert.equal(transposeKey(null, 3), null);
});
