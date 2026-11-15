// Three-way merge of two versions of a song, like `git merge`, plus harmonic clash detection (CLAUDE.md §5).
//
//   base  the common starting point (where the fork was made, or the last merge between the two songs)
//   mio   the song you merge into (it keeps its name, author and visibility)
//   suyo  the song you merge from
//
// Each side's changes are measured against the base. A change made on only one side is applied; the same
// change on both sides is applied once; different changes to the same spot are conflicts:
//   - pista        one side deleted a track the other side changed
//   - instrumento  both changed the instrument of the same track
//   - bloque       both placed new blocks over the same bars of the same track
//   - tempo        both changed the tempo
// `resoluciones` = { [conflict id]: 'mio' | 'suyo' } picks a side per conflict ('mio' when missing).
// Conflict ids depend only on the content, so a preview and the merge that follows agree on them.
import { alignLanes, usedPiezaIds } from './songDiff.js';

const blockKey = (bloque) => `${bloque.compas}:${bloque.pieza_id}`;
const byCompas = (a, b) => a.compas - b.compas || a.pieza_id.localeCompare(b.pieza_id);
const sameLane = (a, b) =>
  a.instrumento === b.instrumento && JSON.stringify([...a.bloques].sort(byCompas)) === JSON.stringify([...b.bloques].sort(byCompas));
const strip = ({ pieza_id, compas }) => ({ pieza_id, compas });

function invert(match) {
  const map = new Map();
  match.forEach((i, j) => i !== -1 && map.set(i, j));
  return map;
}

export function mergeCanciones({ base, mio, suyo, resoluciones = {}, quien = 'they' }) {
  const piezas = { ...base.piezas, ...mio.piezas, ...suyo.piezas };
  const len = (bloque) => piezas[bloque.pieza_id]?.compases ?? 1;
  const overlaps = (a, b) => a.compas < b.compas + len(b) && b.compas < a.compas + len(a);
  const side = (id) => (resoluciones[id] === 'suyo' ? 'suyo' : 'mio');
  const conflictos = [];
  const conflict = (c) => {
    conflictos.push({ ...c, eleccion: side(c.id) });
    return side(c.id);
  };
  const label = (i, instrumento) => `track ${i + 1} (${instrumento})`;
  const tag = (lane, origen) => ({ instrumento: lane.instrumento, bloques: lane.bloques.map((b) => ({ ...strip(b), origen })) });

  const toBase = { mio: alignLanes(base.pistas, mio.pistas, piezas), suyo: alignLanes(base.pistas, suyo.pistas, piezas) };
  const fromBase = { mio: invert(toBase.mio), suyo: invert(toBase.suyo) };

  // Blocks of one track changed on both sides (b = base, m = mine, s = theirs).
  function mergeLane(i, b, m, s, where) {
    const keys = (lane) => new Set(lane.bloques.map(blockKey));
    const [kb, km, ks] = [keys(b), keys(m), keys(s)];
    const kept = b.bloques.filter((x) => km.has(blockKey(x)) && ks.has(blockKey(x))).map((x) => ({ ...strip(x), origen: 'base' }));
    const addM = m.bloques.filter((x) => !kb.has(blockKey(x))).map((x) => ({ ...strip(x), origen: 'mio' }));
    const addS = s.bloques.filter((x) => !kb.has(blockKey(x)) && !km.has(blockKey(x))).map((x) => ({ ...strip(x), origen: 'suyo' }));

    let instrumento = m.instrumento;
    if (m.instrumento === b.instrumento) instrumento = s.instrumento;
    else if (s.instrumento !== b.instrumento && s.instrumento !== m.instrumento) {
      const choice = conflict({
        id: `instrumento:${i}`,
        tipo: 'instrumento',
        texto: `Both changed the instrument of ${where}: you chose ${m.instrumento}, ${quien} chose ${s.instrumento}.`,
        mio: m.instrumento,
        suyo: s.instrumento,
      });
      if (choice === 'suyo') instrumento = s.instrumento;
    }

    const dropped = new Set();
    for (const x of addS) {
      const clash = addM.filter((y) => overlaps(x, y));
      if (!clash.length) continue;
      const choice = conflict({
        id: `bloque:${i}:${x.compas}:${x.pieza_id}`,
        tipo: 'bloque',
        texto: `Both changed bars ${x.compas + 1}–${x.compas + len(x)} of ${where}: you placed ${clash.map((y) => y.pieza_id).join(', ')}, ${quien} placed ${x.pieza_id}.`,
        mio: clash.map(strip),
        suyo: strip(x),
      });
      if (choice === 'suyo') clash.forEach((y) => dropped.add(y));
      else dropped.add(x);
    }
    let bloques = [...kept, ...addM, ...addS].filter((x) => !dropped.has(x));
    // Leftover overlaps from mixed choices: your blocks win.
    bloques = bloques.filter((x) => x.origen !== 'suyo' || !bloques.some((y) => y.origen !== 'suyo' && overlaps(x, y)));
    return { instrumento, bloques: bloques.sort(byCompas) };
  }

  const pistas = [];
  // 1. Your tracks, in your order.
  mio.pistas.forEach((m, j) => {
    const i = toBase.mio[j];
    if (i === -1) return pistas.push(tag(m, 'mio')); // a track you added
    const b = base.pistas[i];
    const sj = fromBase.suyo.get(i);
    if (sj === undefined) {
      if (sameLane(m, b)) return; // they deleted a track you did not touch
      const choice = conflict({
        id: `pista:${i}`,
        tipo: 'pista',
        texto: `${quien[0].toUpperCase()}${quien.slice(1)} deleted ${label(j, m.instrumento)}, but you changed it.`,
        mio: 'conservar',
        suyo: 'borrar',
      });
      if (choice === 'mio') pistas.push(tag(m, 'mio'));
      return;
    }
    pistas.push(mergeLane(i, b, m, suyo.pistas[sj], label(j, m.instrumento)));
  });
  // 2. Base tracks you deleted.
  base.pistas.forEach((b, i) => {
    if (fromBase.mio.has(i)) return;
    const sj = fromBase.suyo.get(i);
    if (sj === undefined) return; // deleted on both sides
    const s = suyo.pistas[sj];
    if (sameLane(s, b)) return; // they did not touch it: it stays deleted
    const choice = conflict({
      id: `pista:${i}`,
      tipo: 'pista',
      texto: `You deleted ${label(i, b.instrumento)}, but ${quien} changed it.`,
      mio: 'borrar',
      suyo: 'conservar',
    });
    if (choice === 'suyo') pistas.push(tag(s, 'suyo'));
  });
  // 3. Tracks they added (unless you added the very same track).
  suyo.pistas.forEach((s, j) => {
    if (toBase.suyo[j] !== -1) return;
    if (mio.pistas.some((m, k) => toBase.mio[k] === -1 && sameLane(m, s))) return;
    pistas.push(tag(s, 'suyo'));
  });

  let tempo = mio.tempo;
  if (mio.tempo === base.tempo) tempo = suyo.tempo;
  else if (suyo.tempo !== base.tempo && suyo.tempo !== mio.tempo) {
    const choice = conflict({
      id: 'tempo',
      tipo: 'tempo',
      texto: `Both changed the tempo: you set ${mio.tempo} BPM, ${quien} set ${suyo.tempo} BPM.`,
      mio: mio.tempo,
      suyo: suyo.tempo,
    });
    if (choice === 'suyo') tempo = suyo.tempo;
  }

  const resultado = { nombre: mio.nombre, tempo, pistas: pistas.map((p) => ({ instrumento: p.instrumento, bloques: p.bloques.map(strip) })) };
  const used = usedPiezaIds(resultado);
  resultado.piezas = Object.fromEntries(Object.entries(piezas).filter(([id]) => used.has(id)));
  return { resultado, conflictos, choques: harmonicClashes(pistas, piezas) };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Notes a minor second apart (or a minor ninth...) sounding at the same time on two pitched tracks, where one
// note comes from the song merged in and the other was already in yours: the combination the merge creates.
// Drums are skipped. Returns up to 8 piece pairs, most clashes first.
export function harmonicClashes(pistas, piezas) {
  const notes = [];
  pistas.forEach((pista, lane) => {
    for (const bloque of pista.bloques) {
      const pieza = piezas[bloque.pieza_id];
      if (!pieza || pieza.tipo === 'ritmo') continue;
      for (const nota of pieza.notas) {
        const start = bloque.compas * 4 + nota.inicio;
        notes.push({ k: notes.length, lane, pieza: bloque.pieza_id, tono: nota.tono, start, end: start + nota.duracion, suyo: bloque.origen === 'suyo' });
      }
    }
  });
  const buckets = new Map(); // beat -> notes sounding during it
  for (const n of notes) {
    for (let beat = Math.floor(n.start); beat < Math.ceil(n.end); beat++) {
      if (!buckets.has(beat)) buckets.set(beat, []);
      buckets.get(beat).push(n);
    }
  }
  const seen = new Set();
  const groups = new Map();
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const [a, b] = [list[x], list[y]];
        if (a.lane === b.lane || a.suyo === b.suyo) continue;
        if (a.start >= b.end || b.start >= a.end) continue;
        const interval = Math.abs(a.tono - b.tono) % 12;
        if (interval !== 1 && interval !== 11) continue;
        const pairKey = a.k < b.k ? `${a.k}-${b.k}` : `${b.k}-${a.k}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const [suya, tuya] = a.suyo ? [a, b] : [b, a];
        const key = `${suya.pieza}|${tuya.pieza}`;
        const at = Math.max(a.start, b.start);
        const group = groups.get(key);
        if (!group) groups.set(key, { suya: suya.pieza, tuya: tuya.pieza, veces: 1, at, notas: [suya.tono, tuya.tono] });
        else {
          group.veces++;
          if (at < group.at) Object.assign(group, { at, notas: [suya.tono, tuya.tono] });
        }
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.veces - a.veces || a.at - b.at)
    .slice(0, 8)
    .map(({ suya, tuya, veces, at, notas }) => ({
      piezas: [suya, tuya],
      veces,
      compas: Math.floor(at / 4) + 1,
      texto: `${suya} (${piezas[suya]?.nombre ?? suya}) and ${tuya} (${piezas[tuya]?.nombre ?? tuya}) play a minor second apart ${veces} ${veces === 1 ? 'time' : 'times'}, first in bar ${Math.floor(at / 4) + 1} (${NOTE_NAMES[notas[0] % 12]} against ${NOTE_NAMES[notas[1] % 12]}).`,
    }));
}
