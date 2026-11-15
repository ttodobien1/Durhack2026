// What changed between two versions of a song (a "commit diff" for music).
//
// Both sides are snapshots, the shape stored in the `versiones` table:
//   { nombre, tempo, pistas: [{ instrumento, bloques: [{ pieza_id, compas }] }],
//     piezas: { "p-017": { nombre, autor, tipo, licencia, parent_id, compases, notas } } }
//
// Tracks have no ids, so the tracks of both sides are first matched by content (alignLanes). Pieces are
// compared by id: same id with other notes = edited; a fork that took the place of its original = replaced.
import { diffNotas } from './diff.js';

export const EMPTY_SNAPSHOT = { nombre: '', tempo: null, pistas: [], piezas: {} };

const blockKey = (bloque) => `${bloque.compas}:${bloque.pieza_id}`;
const byCompas = (a, b) => a.compas - b.compas || a.pieza_id.localeCompare(b.pieza_id);

export const usedPiezaIds = (snapshot) => new Set(snapshot.pistas.flatMap((pista) => pista.bloques.map((b) => b.pieza_id)));

// Two pieces are related when one is a direct fork of the other (a fork replacing its original).
export const related = (piezas, a, b) => a === b || piezas[a]?.parent_id === b || piezas[b]?.parent_id === a;

// Matches the tracks of `other` to the tracks of `base`. Returns, for each track of `other`, the index of the
// matching base track or -1 (a new track). Score: same instrument, same position, and blocks at the same bar
// (same piece > a fork of it > any piece).
export function alignLanes(base, other, piezas = {}) {
  const pairs = [];
  other.forEach((o, j) => {
    base.forEach((b, i) => {
      let score = (b.instrumento === o.instrumento ? 2 : 0) + (i === j ? 0.5 : 0);
      const atBar = new Map(b.bloques.map((x) => [x.compas, x.pieza_id]));
      for (const x of o.bloques) {
        if (!atBar.has(x.compas)) continue;
        const y = atBar.get(x.compas);
        score += y === x.pieza_id ? 3 : related(piezas, x.pieza_id, y) ? 2 : 1;
      }
      if (score >= 2) pairs.push({ i, j, score });
    });
  });
  pairs.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
  const match = new Array(other.length).fill(-1);
  const taken = new Set();
  for (const { i, j } of pairs) {
    if (match[j] !== -1 || taken.has(i)) continue;
    match[j] = i;
    taken.add(i);
  }
  return match;
}

const info = (id, pieza) => ({
  id,
  nombre: pieza?.nombre ?? id,
  autor: pieza?.autor ?? '',
  tipo: pieza?.tipo ?? '',
  compases: pieza?.compases ?? 1,
});

const sameNotes = (a, b) => a.compases === b.compases && JSON.stringify(a.notas) === JSON.stringify(b.notas);

// diffCanciones(antes, despues): `antes` null means "nothing before" (the first version of an original song).
export function diffCanciones(antes, despues) {
  antes ??= EMPTY_SNAPSHOT;
  const piezas = { ...antes.piezas, ...despues.piezas };

  // Tracks
  const match = alignLanes(antes.pistas, despues.pistas, piezas);
  const matched = new Set();
  const pistas = [];
  despues.pistas.forEach((d, j) => {
    const i = match[j];
    if (i === -1) {
      pistas.push({ estado: 'nueva', posicion: j, instrumento: d.instrumento, nuevos: [...d.bloques].sort(byCompas), borrados: [] });
      return;
    }
    matched.add(i);
    const a = antes.pistas[i];
    const aKeys = new Set(a.bloques.map(blockKey));
    const dKeys = new Set(d.bloques.map(blockKey));
    const nuevos = d.bloques.filter((b) => !aKeys.has(blockKey(b))).sort(byCompas);
    const borrados = a.bloques.filter((b) => !dKeys.has(blockKey(b))).sort(byCompas);
    if (nuevos.length || borrados.length || a.instrumento !== d.instrumento) {
      pistas.push({
        estado: 'cambiada',
        posicion: j,
        instrumento: d.instrumento,
        ...(a.instrumento !== d.instrumento && { instrumento_antes: a.instrumento }),
        nuevos,
        borrados,
      });
    }
  });
  antes.pistas.forEach((a, i) => {
    if (!matched.has(i)) pistas.push({ estado: 'borrada', posicion: i, instrumento: a.instrumento, nuevos: [], borrados: [...a.bloques].sort(byCompas) });
  });

  // Pieces
  const usedA = usedPiezaIds(antes);
  const usedD = usedPiezaIds(despues);
  const cambios = [];
  const replaced = new Set();
  for (const id of usedD) {
    const d = despues.piezas[id];
    if (usedA.has(id)) {
      const a = antes.piezas[id];
      if (!a || !d || sameNotes(a, d)) continue;
      cambios.push({
        estado: 'editada',
        ...info(id, d),
        ...(a.compases !== d.compases && { compases_antes: a.compases }),
        notas: diffNotas(a.notas, d.notas),
      });
    } else if (d?.parent_id && usedA.has(d.parent_id) && !usedD.has(d.parent_id)) {
      const a = antes.piezas[d.parent_id];
      replaced.add(d.parent_id);
      cambios.push({ estado: 'reemplazada', ...info(id, d), reemplaza: info(d.parent_id, a), notas: diffNotas(a?.notas ?? [], d.notas) });
    } else {
      cambios.push({ estado: 'agregada', ...info(id, d), notas: diffNotas([], d?.notas ?? []) });
    }
  }
  for (const id of usedA) {
    if (usedD.has(id) || replaced.has(id)) continue;
    cambios.push({ estado: 'quitada', ...info(id, antes.piezas[id]), notas: diffNotas(antes.piezas[id]?.notas ?? [], []) });
  }

  const count = (list, estado) => list.filter((x) => x.estado === estado).length;
  const sum = (field) => cambios.reduce((total, c) => total + c.notas[field].length, 0);
  const nombre = antes.nombre && antes.nombre !== despues.nombre ? { antes: antes.nombre, despues: despues.nombre } : null;
  const tempo = antes.tempo != null && antes.tempo !== despues.tempo ? { antes: antes.tempo, despues: despues.tempo } : null;

  return {
    nombre,
    tempo,
    pistas,
    piezas: cambios,
    resumen: {
      pistas_nuevas: count(pistas, 'nueva'),
      pistas_borradas: count(pistas, 'borrada'),
      pistas_cambiadas: count(pistas, 'cambiada'),
      piezas_agregadas: count(cambios, 'agregada'),
      piezas_quitadas: count(cambios, 'quitada'),
      piezas_editadas: count(cambios, 'editada') + count(cambios, 'reemplazada'),
      notas_nuevas: sum('nuevas'),
      notas_borradas: sum('borradas'),
      notas_movidas: sum('movidas'),
      vacio: !nombre && !tempo && pistas.length === 0 && cambios.length === 0,
    },
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (list) => {
  const shown = list.slice(0, 2).map((c) => c.nombre);
  return list.length > 2 ? `${shown.join(', ')} and ${list.length - 2} more` : shown.join(' and ');
};

// Default version message, like a commit title: "Edited Montuno (fork), added Anticipated tumbao, tempo 90 → 96 BPM".
export function describeDiff(diff) {
  const parts = [];
  const of = (estado) => diff.piezas.filter((c) => c.estado === estado);
  const editadas = [...of('editada'), ...of('reemplazada')];
  if (editadas.length) parts.push(`edited ${names(editadas)}`);
  if (of('agregada').length) parts.push(`added ${names(of('agregada'))}`);
  if (of('quitada').length) parts.push(`removed ${names(of('quitada'))}`);
  const { pistas_nuevas: nuevas, pistas_borradas: borradas } = diff.resumen;
  const movedOnly = diff.pistas.filter((p) => p.estado === 'cambiada').length;
  if (!parts.length && (nuevas || borradas)) parts.push([nuevas && `added ${plural(nuevas, 'track')}`, borradas && `removed ${plural(borradas, 'track')}`].filter(Boolean).join(', '));
  if (!parts.length && movedOnly) parts.push(`rearranged ${plural(movedOnly, 'track')}`);
  if (diff.tempo) parts.push(`tempo ${diff.tempo.antes} → ${diff.tempo.despues} BPM`);
  if (diff.nombre) parts.push(`renamed to "${diff.nombre.despues}"`);
  if (!parts.length) return 'No musical changes';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}
