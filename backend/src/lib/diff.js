// Musical diff between two lists of notes (CLAUDE.md, section 5).
//
//   1. Notes with the same (tono, inicio) in both lists          -> iguales
//   2. Leftovers with the same tono but another inicio, or the
//      same inicio but another tono, paired closest-first        -> movidas
//   3. Whatever is left in `despues`                              -> nuevas
//      Whatever is left in `antes`                                -> borradas
//
// `antes` is the original (usually the parent), `despues` the modified piece (usually the fork).
// A note only counts as "moved" if it stays reasonably close (one 4/4 bar in time, one octave in
// pitch); farther changes are reported as a deleted note plus a new one.

const TIME_PRECISION = 1e4; // compare beats with 4 decimals to avoid float noise
const MAX_SHIFT = 4; // beats
const MAX_TRANSPOSE = 12; // semitones

const ticks = (inicio) => Math.round(inicio * TIME_PRECISION);
const keyOf = (nota) => `${nota.tono}@${ticks(nota.inicio)}`;
const byTime = (a, b) => a.inicio - b.inicio || a.tono - b.tono;

export function diffNotas(antes = [], despues = []) {
  const usedAntes = new Array(antes.length).fill(false);
  const usedDespues = new Array(despues.length).fill(false);

  // 1. Exact matches on (tono, inicio). Handles duplicated notes by consuming one at a time.
  const iguales = [];
  const pending = new Map();
  antes.forEach((nota, i) => {
    const key = keyOf(nota);
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push(i);
  });
  despues.forEach((nota, j) => {
    const candidates = pending.get(keyOf(nota));
    if (candidates && candidates.length > 0) {
      usedAntes[candidates.shift()] = true;
      usedDespues[j] = true;
      iguales.push(nota);
    }
  });

  const movidas = [];
  const pair = (i, j) => {
    usedAntes[i] = true;
    usedDespues[j] = true;
    movidas.push({ antes: antes[i], despues: despues[j] });
  };
  const freeAntes = () => antes.map((_, i) => i).filter((i) => !usedAntes[i]);
  const freeDespues = () => despues.map((_, j) => j).filter((j) => !usedDespues[j]);

  // 2a. Same pitch, shifted in time (at most MAX_SHIFT beats). Closest pairs first.
  const shifts = [];
  for (const i of freeAntes()) {
    for (const j of freeDespues()) {
      const distance = Math.abs(antes[i].inicio - despues[j].inicio);
      if (antes[i].tono === despues[j].tono && distance <= MAX_SHIFT) shifts.push({ i, j, cost: distance });
    }
  }
  shifts.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);
  for (const { i, j } of shifts) if (!usedAntes[i] && !usedDespues[j]) pair(i, j);

  // 2b. Same onset, transposed (at most MAX_TRANSPOSE semitones). Within each onset, when both
  //     sides have the same number of notes they are paired low-to-high (keeps chord voices
  //     together); otherwise closest pitches first.
  const byOnset = (indices, notes) => {
    const groups = new Map();
    for (const index of indices) {
      const t = ticks(notes[index].inicio);
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(index);
    }
    return groups;
  };
  const antesByOnset = byOnset(freeAntes(), antes);
  for (const [t, js] of byOnset(freeDespues(), despues)) {
    const is = antesByOnset.get(t);
    if (!is) continue;
    const near = (i, j) => Math.abs(antes[i].tono - despues[j].tono) <= MAX_TRANSPOSE;
    if (is.length === js.length) {
      const lowToHigh = (notes) => (x, y) => notes[x].tono - notes[y].tono;
      is.sort(lowToHigh(antes));
      js.sort(lowToHigh(despues));
      is.forEach((i, k) => near(i, js[k]) && pair(i, js[k]));
    } else {
      const candidates = is.flatMap((i) => js.filter((j) => near(i, j)).map((j) => ({ i, j, cost: Math.abs(antes[i].tono - despues[j].tono) })));
      candidates.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);
      for (const { i, j } of candidates) if (!usedAntes[i] && !usedDespues[j]) pair(i, j);
    }
  }

  // 3. Leftovers.
  const nuevas = despues.filter((_, j) => !usedDespues[j]);
  const borradas = antes.filter((_, i) => !usedAntes[i]);

  return {
    nuevas: nuevas.sort(byTime),
    borradas: borradas.sort(byTime),
    movidas: movidas.sort((x, y) => byTime(x.despues, y.despues)),
    iguales: iguales.sort(byTime),
  };
}
