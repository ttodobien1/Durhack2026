// Musical facts about a diff (lib/diff.js), for the copilot's "Explain" and its template fallback. Pure: no model.
// The copilot only describes these facts; it never suggests notes.

const INTERVALS = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th', 'octave'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TIME_WORDS = new Map([
  [0.125, 'a thirty-second note'],
  [0.25, 'a sixteenth note'],
  [0.5, 'half a beat'],
  [0.75, 'three sixteenth notes'],
  [1, 'a beat'],
  [1.5, 'a beat and a half'],
  [2, 'two beats'],
  [3, 'three beats'],
  [4, 'a bar'],
]);

export const noteName = (tono) => `${NAMES[((tono % 12) + 12) % 12]}${Math.floor(tono / 12) - 1}`;
export const barOf = (inicio) => Math.floor(inicio / 4) + 1;
const round = (x) => Math.round(x * 1000) / 1000;

/** "minor 3rd", "octave"... for a number of semitones (sign ignored). */
export function intervalName(semitones) {
  const s = Math.abs(semitones);
  return s <= 12 ? INTERVALS[s] : `${INTERVALS[s % 12]} plus ${Math.floor(s / 12)} octave${s >= 24 ? 's' : ''}`;
}

/** "half a beat later", "a beat earlier", "1.33 beats later". */
export function timeWords(beats) {
  const b = round(Math.abs(beats));
  const words = TIME_WORDS.get(b) ?? `${b} beats`;
  return `${words} ${beats > 0 ? 'later' : 'earlier'}`;
}

/** "bar 3", "bars 3–4", "bars 1, 3 and 5". */
export function barsWords(bars) {
  const list = [...new Set(bars)].sort((a, b) => a - b);
  if (!list.length) return '';
  if (list.length === 1) return `bar ${list[0]}`;
  const contiguous = list.every((b, i) => i === 0 || b === list[i - 1] + 1);
  if (contiguous) return `bars ${list[0]}–${list.at(-1)}`;
  return `bars ${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function range(notas) {
  if (!notas.length) return null;
  const lo = Math.min(...notas.map((n) => n.tono));
  const hi = Math.max(...notas.map((n) => n.tono));
  return { min: lo, max: hi, desde: noteName(lo), hasta: noteName(hi) };
}

function perBar(notas, compases) {
  const bars = Math.max(compases ?? 0, ...notas.map((n) => barOf(n.inicio)));
  const counts = Array(bars).fill(0);
  for (const n of notas) counts[barOf(n.inicio) - 1]++;
  return counts;
}

/**
 * diff: { nuevas, borradas, movidas, iguales } from diffNotas(original.notas, fork.notas).
 * original / fork: the two pieces (notas, compases). Returns plain data, see the route GET /piezas/:id/diff/:otra/explicacion.
 */
export function diffFacts(diff, original = {}, fork = {}) {
  const transposiciones = [];
  const desplazamientos = [];
  for (const { antes, despues } of diff.movidas) {
    if (antes.tono !== despues.tono) {
      const semitonos = despues.tono - antes.tono;
      transposiciones.push({ de: noteName(antes.tono), a: noteName(despues.tono), semitonos, intervalo: intervalName(semitonos), direccion: semitonos > 0 ? 'up' : 'down', compas: barOf(despues.inicio) });
    } else {
      const beats = round(despues.inicio - antes.inicio);
      desplazamientos.push({ nota: noteName(antes.tono), beats, palabras: timeWords(beats), compas: barOf(despues.inicio) });
    }
  }

  // Uniform: every moved note changed by the same amount, in the same way.
  let uniforme = null;
  const all = diff.movidas.length;
  if (all >= 2 && transposiciones.length === all && transposiciones.every((t) => t.semitonos === transposiciones[0].semitonos)) {
    const { semitonos, intervalo, direccion } = transposiciones[0];
    uniforme = { tipo: 'transposicion', semitonos, intervalo, direccion };
  } else if (all >= 2 && desplazamientos.length === all && desplazamientos.every((d) => d.beats === desplazamientos[0].beats)) {
    const { beats, palabras } = desplazamientos[0];
    uniforme = { tipo: 'desplazamiento', beats, palabras };
  }
  if (uniforme) uniforme.toda_la_pieza = !diff.iguales.length && !diff.nuevas.length && !diff.borradas.length;

  const compases = [
    ...diff.nuevas.map((n) => barOf(n.inicio)),
    ...diff.borradas.map((n) => barOf(n.inicio)),
    ...diff.movidas.flatMap((m) => [barOf(m.antes.inicio), barOf(m.despues.inicio)]),
  ];
  return {
    conteo: { nuevas: diff.nuevas.length, borradas: diff.borradas.length, movidas: all, iguales: diff.iguales.length },
    transposiciones,
    desplazamientos,
    uniforme,
    compases_cambiados: [...new Set(compases)].sort((a, b) => a - b),
    rango: { antes: range(original.notas ?? []), despues: range(fork.notas ?? []) },
    notas_por_compas: { antes: perBar(original.notas ?? [], original.compases), despues: perBar(fork.notas ?? [], fork.compases) },
  };
}

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Template explanation from the facts alone: the fallback when no model answers. Two or three sentences. */
export function templateExplanation(f) {
  const { conteo: c, uniforme: u } = f;
  if (!c.nuevas && !c.borradas && !c.movidas) return 'Nothing changed: the fork has exactly the same notes as the original.';
  const sentences = [];
  if (u?.toda_la_pieza) {
    sentences.push(
      u.tipo === 'transposicion'
        ? `The whole piece was transposed ${u.direccion} a ${u.intervalo} (${Math.abs(u.semitonos)} semitones): same rhythm, new key.`
        : `Everything was shifted ${u.palabras}: same notes, new placement in the bar.`,
    );
  } else {
    const groups = new Map();
    for (const t of f.transposiciones) {
      const key = `${t.direccion} a ${t.intervalo}`;
      groups.set(key, [...(groups.get(key) ?? []), t.compas]);
    }
    for (const d of f.desplazamientos) groups.set(d.palabras, [...(groups.get(d.palabras) ?? []), d.compas]);
    const moves = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 2)
      .map(([what, bars]) => (what.startsWith('up') || what.startsWith('down') ? `${plural(bars.length, 'note')} moved ${what} in ${barsWords(bars)}` : `${plural(bars.length, 'note')} played ${what} in ${barsWords(bars)}`));
    if (moves.length) sentences.push(`${moves.join(', and ')}.`.replace(/^./, (x) => x.toUpperCase()));
    const added = [c.nuevas && `added ${plural(c.nuevas, 'new note')}`, c.borradas && `deleted ${plural(c.borradas, 'note')}`].filter(Boolean);
    if (added.length) sentences.push(`You ${added.join(' and ')}.`);
  }
  const { antes, despues } = f.rango;
  if (antes && despues && (antes.min !== despues.min || antes.max !== despues.max) && sentences.length < 3) {
    sentences.push(`The range now runs ${despues.desde}–${despues.hasta} (it was ${antes.desde}–${antes.hasta}).`);
  }
  if (c.iguales && sentences.length < 3) sentences.push(`${plural(c.iguales, 'note')} stayed exactly as in the original.`);
  return sentences.slice(0, 3).join(' ');
}
