import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffNotas } from '../src/lib/diff.js';
import { barsWords, diffFacts, intervalName, templateExplanation, timeWords } from '../src/lib/diffFacts.js';

const n = (tono, inicio, duracion = 0.5, velocidad = 0.8) => ({ tono, inicio, duracion, velocidad });
const melody = [n(57, 0), n(60, 1), n(64, 2), n(62, 3), n(60, 4, 1), n(59, 6), n(57, 7)];
const facts = (antes, despues) => diffFacts(diffNotas(antes, despues), { notas: antes, compases: 2 }, { notas: despues, compases: 2 });

test('transposing every note +5 is uniform: the whole piece, a perfect 4th up', () => {
  const f = facts(melody, melody.map((x) => ({ ...x, tono: x.tono + 5 })));
  assert.equal(f.conteo.movidas, melody.length);
  assert.deepEqual(f.uniforme, { tipo: 'transposicion', semitonos: 5, intervalo: 'perfect 4th', direccion: 'up', toda_la_pieza: true });
  assert.match(templateExplanation(f), /whole piece was transposed up a perfect 4th/);
});

test('shifting one note by 0.5 is one time shift of half a beat, in the right bar', () => {
  const f = facts(melody, melody.map((x, i) => (i === 5 ? { ...x, inicio: x.inicio + 0.5 } : x)));
  assert.deepEqual(f.desplazamientos, [{ nota: 'B3', beats: 0.5, palabras: 'half a beat later', compas: 2 }]);
  assert.equal(f.uniforme, null, 'one move is not "uniform"');
  assert.deepEqual(f.compases_cambiados, [2]);
  assert.equal(f.conteo.iguales, melody.length - 1);
  assert.match(templateExplanation(f), /1 note played half a beat later in bar 2/);
});

test('everything a beat earlier is a uniform shift; range and notes per bar are reported', () => {
  const later = melody.map((x) => ({ ...x, inicio: x.inicio + 1 }));
  const f = facts(later, melody);
  assert.equal(f.uniforme.tipo, 'desplazamiento');
  assert.equal(f.uniforme.palabras, 'a beat earlier');
  assert.deepEqual(f.rango.antes, { min: 57, max: 64, desde: 'A3', hasta: 'E4' });
  assert.equal(f.notas_por_compas.despues.reduce((a, b) => a + b), melody.length);
});

test('words: intervals, time and bar lists', () => {
  assert.equal(intervalName(-2), 'major 2nd');
  assert.equal(intervalName(12), 'octave');
  assert.equal(timeWords(-1), 'a beat earlier');
  assert.equal(timeWords(1 / 3), '0.333 beats later');
  assert.equal(barsWords([4, 3, 3]), 'bars 3–4');
  assert.equal(barsWords([1, 3, 5]), 'bars 1, 3 and 5');
  assert.equal(templateExplanation(facts(melody, melody)), 'Nothing changed: the fork has exactly the same notes as the original.');
});
