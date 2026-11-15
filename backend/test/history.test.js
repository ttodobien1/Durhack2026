// Song history: diff between versions, three-way merge, harmonic clashes and note credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignLanes, describeDiff, diffCanciones } from '../src/lib/songDiff.js';
import { mergeCanciones } from '../src/lib/songMerge.js';
import { blame, computeCredits } from '../src/lib/credits.js';

const n = (tono, inicio, duracion = 0.5) => ({ tono, inicio, duracion, velocidad: 0.8 });
const piece = (id, autor, tipo, notas, extra = {}) => ({ nombre: id, autor, tipo, licencia: 'CC BY 4.0', parent_id: null, compases: 4, notas, ...extra });

const PIEZAS = {
  'p-1': piece('p-1', 'cristobal', 'ritmo', [n(36, 0), n(38, 1)]),
  'p-2': piece('p-2', 'ana', 'acordes', [n(57, 0), n(60, 0), n(64, 0)]),
  'p-3': piece('p-3', 'chino', 'acordes', [n(57, 0), n(60, 0), n(65, 0)], { parent_id: 'p-2' }), // fork of p-2: 64 → 65
  'p-4': piece('p-4', 'luis', 'bajo', [n(45, 0, 2), n(40, 2, 2)]),
  'p-5': piece('p-5', 'luis', 'melodia', [n(76, 0, 1)]),
};
const lane = (instrumento, ...bloques) => ({ instrumento, bloques: bloques.map(([pieza_id, compas]) => ({ pieza_id, compas })) });
const snap = (pistas, tempo = 90) => {
  const used = new Set(pistas.flatMap((p) => p.bloques.map((b) => b.pieza_id)));
  return { nombre: 'Beat', tempo, pistas, piezas: Object.fromEntries(Object.entries(PIEZAS).filter(([id]) => used.has(id))) };
};

const BASE = snap([lane('bateria', ['p-1', 0], ['p-1', 4]), lane('piano', ['p-2', 0])]);

test('diffCanciones: first version lists everything as added', () => {
  const diff = diffCanciones(null, BASE);
  assert.equal(diff.resumen.pistas_nuevas, 2);
  assert.equal(diff.resumen.piezas_agregadas, 2);
  assert.equal(diff.resumen.notas_nuevas, 5);
  assert.equal(diff.tempo, null);
});

test('diffCanciones: a fork replacing its original is "reemplazada" with the musical diff', () => {
  const next = snap([lane('bateria', ['p-1', 0], ['p-1', 4]), lane('piano', ['p-3', 0]), lane('bajo', ['p-4', 0])], 96);
  const diff = diffCanciones(BASE, next);
  const replaced = diff.piezas.find((p) => p.estado === 'reemplazada');
  assert.equal(replaced.id, 'p-3');
  assert.equal(replaced.reemplaza.id, 'p-2');
  assert.equal(replaced.notas.movidas.length, 1); // 64 → 65 at the same onset
  assert.equal(replaced.notas.iguales.length, 2);
  assert.deepEqual(diff.piezas.find((p) => p.estado === 'agregada').id, 'p-4');
  assert.equal(diff.piezas.some((p) => p.estado === 'quitada'), false); // p-2 was replaced, not removed
  assert.deepEqual(diff.tempo, { antes: 90, despues: 96 });
  assert.equal(diff.resumen.pistas_nuevas, 1);
  assert.equal(diff.resumen.pistas_cambiadas, 1); // the piano lane swapped p-2 for p-3
  assert.equal(describeDiff(diff), 'Edited p-3, added p-4, tempo 90 → 96 BPM');
});

test('diffCanciones: an edited piece with the same id and a deleted track', () => {
  const edited = { ...BASE, piezas: { ...BASE.piezas, 'p-2': { ...PIEZAS['p-2'], notas: [n(57, 0), n(60, 0)] } } };
  edited.pistas = [BASE.pistas[1]];
  const diff = diffCanciones(BASE, edited);
  assert.equal(diff.resumen.pistas_borradas, 1);
  const p2 = diff.piezas.find((p) => p.id === 'p-2');
  assert.equal(p2.estado, 'editada');
  assert.equal(p2.notas.borradas.length, 1);
  assert.equal(diff.piezas.find((p) => p.id === 'p-1').estado, 'quitada');
  assert.equal(diffCanciones(BASE, BASE).resumen.vacio, true);
});

test('alignLanes: matches tracks by content even when they moved', () => {
  const other = [lane('piano', ['p-3', 0]), lane('bajo', ['p-4', 0]), lane('bateria', ['p-1', 0], ['p-1', 4])];
  assert.deepEqual(alignLanes(BASE.pistas, other, PIEZAS), [1, -1, 0]);
});

test('mergeCanciones: changes from both sides combine without conflicts', () => {
  const mio = snap([lane('bateria', ['p-1', 0], ['p-1', 4]), lane('piano', ['p-3', 0])]); // you forked the chords
  const suyo = snap([lane('bateria', ['p-1', 0], ['p-1', 4]), lane('piano', ['p-2', 0]), lane('bajo', ['p-4', 0])], 96); // they added bass + tempo
  const { resultado, conflictos } = mergeCanciones({ base: BASE, mio, suyo, quien: 'luis' });
  assert.deepEqual(conflictos, []);
  assert.equal(resultado.tempo, 96);
  assert.deepEqual(resultado.pistas.map((p) => p.bloques.map((b) => b.pieza_id).join()), ['p-1,p-1', 'p-3', 'p-4']);
  assert.ok(resultado.piezas['p-4']);
});

test('mergeCanciones: overlapping blocks, tempo and delete/modify are conflicts you can resolve', () => {
  const mio = snap([lane('bateria', ['p-1', 0], ['p-1', 4]), lane('piano', ['p-3', 0])], 100); // fork + tempo 100
  const suyo = snap([lane('piano', ['p-5', 0])], 80); // deleted drums untouched, replaced chords with a melody, tempo 80
  const first = mergeCanciones({ base: BASE, mio, suyo, quien: 'luis' });
  const ids = first.conflictos.map((c) => c.id).sort();
  assert.deepEqual(ids, ['bloque:1:0:p-5', 'tempo']);
  // They deleted the drums, which you did not touch: deleted without asking.
  assert.equal(first.resultado.pistas.length, 1);
  assert.equal(first.resultado.pistas[0].bloques[0].pieza_id, 'p-3'); // default: keep yours
  assert.equal(first.resultado.tempo, 100);

  const theirs = mergeCanciones({ base: BASE, mio, suyo, quien: 'luis', resoluciones: { 'bloque:1:0:p-5': 'suyo', tempo: 'suyo' } });
  assert.equal(theirs.resultado.pistas[0].bloques[0].pieza_id, 'p-5');
  assert.equal(theirs.resultado.tempo, 80);
  assert.deepEqual(theirs.conflictos.map((c) => c.eleccion).sort(), ['suyo', 'suyo']);

  // You changed the drums, they deleted them: a conflict.
  const mio2 = snap([lane('bateria', ['p-1', 0]), lane('piano', ['p-2', 0])]);
  const deleted = mergeCanciones({ base: BASE, mio: mio2, suyo: snap([lane('piano', ['p-2', 0])]) });
  assert.deepEqual(deleted.conflictos.map((c) => c.id), ['pista:0']);
  assert.equal(deleted.resultado.pistas.length, 2);
});

test('mergeCanciones: flags minor seconds created by the merge (drums ignored)', () => {
  const mio = snap([lane('piano', ['p-2', 0])]); // A C E
  const clashing = { ...PIEZAS['p-5'], notas: [n(65, 0, 1)] }; // F against E
  const suyo = { ...snap([lane('piano', ['p-2', 0]), lane('lead', ['p-5', 0])]), piezas: { 'p-2': PIEZAS['p-2'], 'p-5': clashing } };
  const { choques } = mergeCanciones({ base: snap([lane('piano', ['p-2', 0])]), mio, suyo });
  assert.equal(choques.length, 1);
  assert.deepEqual(choques[0].piezas, ['p-5', 'p-2']);
  assert.equal(choques[0].compas, 1);
  assert.match(choques[0].texto, /F against E/);
});

test('blame: notes kept from the parent stay credited to its author', () => {
  const piezas = new Map(Object.entries(PIEZAS).map(([id, p]) => [id, { id, ...p }]));
  assert.deepEqual(blame('p-3', piezas), ['ana', 'ana', 'chino']);
  const credits = computeCredits({
    cancion: { pistas: [lane('piano', ['p-3', 0], ['p-3', 4]), lane('bajo', ['p-4', 0])] },
    piezas,
    versiones: [{ autor: 'chino' }, { autor: 'chino', merge_de: 'c-2' }],
  });
  assert.equal(credits.total_notas, 8);
  const byName = Object.fromEntries(credits.autores.map((a) => [a.autor, a]));
  assert.equal(byName.ana.notas, 4);
  assert.equal(byName.ana.porcentaje, 50);
  assert.equal(byName.chino.notas, 2);
  assert.equal(byName.chino.versiones, 2);
  assert.equal(byName.chino.merges, 1);
  assert.equal(byName.ana.piezas.find((p) => p.id === 'p-2').rol, 'origen');
  assert.equal(byName.chino.piezas[0].rol, 'fork');
  assert.equal(byName.chino.piezas[0].notas_propias, 1);
  assert.deepEqual(credits.piezas.find((p) => p.id === 'p-3').notas.map((x) => x.autor), ['ana', 'ana', 'chino']);
});
