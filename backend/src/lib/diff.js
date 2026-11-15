// Musical diff between two lists of notes (CLAUDE.md, section 5).
//
//   1. Notes with the same (tono, inicio) in both lists          -> iguales
//   2. Leftovers paired as moved notes by a minimum-cost assignment -> movidas
//      (same tono at another inicio, or same inicio with another tono)
//   3. Whatever is left in `despues`                              -> nuevas
//      Whatever is left in `antes`                                -> borradas
//
// `antes` is the original (usually the parent), `despues` the modified piece (usually the fork).
// A note only counts as "moved" if it stays reasonably close (one 4/4 bar in time, one octave in
// pitch); farther changes are reported as a deleted note plus a new one.
//
// Step 2 finds the LARGEST possible set of moved notes at the minimum total distance: every allowed pair costs at most
// about 1 (|Δt|/4 or |Δp|/12, plus a small Tonnetz term), and leaving both notes unpaired costs 2 (one deleted + one
// new), so pairing always wins when allowed and, among those, the closest pairings win overall (Hungarian algorithm).

import { minCostAssignment } from './assignment.js';

const TIME_PRECISION = 1e4; // compare beats with 4 decimals to avoid float noise
const MAX_SHIFT = 4; // beats
const MAX_TRANSPOSE = 12; // semitones
const MAX_ASSIGNMENT = 300; // leftovers (n + m) solved optimally; above that the greedy pairing is used
const UNPAIRED = 1; // cost of a note that ends up deleted or new
const NOT_ALLOWED = 1e9;

// Steps on the Tonnetz between two pitch classes a given number of semitones apart: 0 for unison/octave, 1 for a
// third, fourth, fifth or sixth (neighbours on the Tonnetz), 2 for a second, seventh or tritone.
const TONNETZ_STEPS = [0, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2];
export const tonnetzSteps = (semitones) => TONNETZ_STEPS[((semitones % 12) + 12) % 12];

/** Cost of reading note a -> b as one moved note, or Infinity when they are too far apart to be the same note. */
export function moveCost(a, b) {
  if (a.tono === b.tono) {
    const dt = Math.abs(a.inicio - b.inicio);
    return dt <= MAX_SHIFT ? dt / MAX_SHIFT : Infinity;
  }
  if (ticks(a.inicio) === ticks(b.inicio)) {
    const dp = b.tono - a.tono;
    // The small Tonnetz term prefers harmonically related moves (a fifth over a semitone) when distances tie.
    return Math.abs(dp) <= MAX_TRANSPOSE ? Math.abs(dp) / MAX_TRANSPOSE + 0.05 * tonnetzSteps(dp) : Infinity;
  }
  return Infinity;
}

/** Optimal pairs [i, j] of free notes: square (n + m) matrix with dummy rows/columns for "deleted" and "new". */
function optimalPairs(antes, despues, freeAntes, freeDespues) {
  const n = freeAntes.length;
  const m = freeDespues.length;
  if (!n || !m) return [];
  const N = n + m;
  const cost = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => {
      if (r < n && c < m) {
        const k = moveCost(antes[freeAntes[r]], despues[freeDespues[c]]);
        return Number.isFinite(k) ? k : NOT_ALLOWED;
      }
      if (r < n) return UNPAIRED; // original note -> dummy: deleted
      if (c < m) return UNPAIRED; // dummy -> fork note: new
      return 0; // dummy -> dummy
    }),
  );
  const rowToCol = minCostAssignment(cost);
  const pairs = [];
  for (let r = 0; r < n; r++) {
    const c = rowToCol[r];
    if (c < m && cost[r][c] < NOT_ALLOWED) pairs.push([freeAntes[r], freeDespues[c]]);
  }
  return pairs;
}

/** The previous closest-first pairing: same pitch shifted in time first, then same onset transposed. */
function greedyPairs(antes, despues, freeAntes, freeDespues) {
  const candidates = [];
  for (const i of freeAntes) for (const j of freeDespues) {
    const sameTono = antes[i].tono === despues[j].tono;
    const k = moveCost(antes[i], despues[j]);
    if (Number.isFinite(k)) candidates.push({ i, j, phase: sameTono ? 0 : 1, cost: k });
  }
  candidates.sort((x, y) => x.phase - y.phase || x.cost - y.cost || x.i - y.i || x.j - y.j);
  const usedA = new Set();
  const usedD = new Set();
  const pairs = [];
  for (const { i, j } of candidates) {
    if (usedA.has(i) || usedD.has(j)) continue;
    usedA.add(i);
    usedD.add(j);
    pairs.push([i, j]);
  }
  return pairs;
}


const ticks = (inicio) => Math.round(inicio * TIME_PRECISION);
const keyOf = (nota) => `${nota.tono}@${ticks(nota.inicio)}`;
const byTime = (a, b) => a.inicio - b.inicio || a.tono - b.tono;

export function diffNotas(antes = [], despues = [], { greedy = false } = {}) {
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
  const freeAntes = antes.map((_, i) => i).filter((i) => !usedAntes[i]);
  const freeDespues = despues.map((_, j) => j).filter((j) => !usedDespues[j]);

  // 2. Pair the leftovers as moved notes.
  // shortcut: greedy above 300 leftovers, O(N³) too slow beyond that
  if (greedy || freeAntes.length + freeDespues.length > MAX_ASSIGNMENT) {
    for (const [i, j] of greedyPairs(antes, despues, freeAntes, freeDespues)) pair(i, j);
  } else {
    for (const [i, j] of optimalPairs(antes, despues, freeAntes, freeDespues)) pair(i, j);
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
