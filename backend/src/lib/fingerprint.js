// Musical fingerprints: |DFT| magnitudes of a piece's pitch-class profile and onset grid (Lewin / Quinn / Amiot).
// Magnitudes do not change when the music is transposed, inverted, or shifted in time, so a copy in another key or
// starting on another beat still matches. Used for "similar pieces" and the "too close to someone else's" warning.

const KICK = new Set([35, 36]);
const SNARE = new Set([37, 38, 39, 40]);
const HAT = new Set([22, 26, 42, 44, 46]);
const KIT = new Set([...KICK, ...SNARE, ...HAT]);
const STEPS = 16; // 16th-note grid, folded onto one bar

/** |F_1..F_K| of a cyclic vector, divided by |F_0| (its total) so the amount of notes does not matter. */
export function magnitudes(v, K) {
  const total = v.reduce((a, b) => a + b, 0);
  if (!total) return Array(K).fill(0);
  return Array.from({ length: K }, (_, i) => {
    const k = i + 1;
    let re = 0;
    let im = 0;
    v.forEach((x, n) => {
      re += x * Math.cos((2 * Math.PI * k * n) / v.length);
      im -= x * Math.sin((2 * Math.PI * k * n) / v.length);
    });
    return Math.hypot(re, im) / total;
  });
}

function onsets(notas, keep = () => true) {
  const grid = Array(STEPS).fill(0);
  for (const n of notas) if (keep(n)) grid[((Math.round(n.inicio * 4) % STEPS) + STEPS) % STEPS] += n.velocidad;
  return grid;
}

/**
 * Drums: rhythm of kick, snare, hats and other percussion (4 x 8 numbers; drum "pitches" are sounds, not notes).
 * Pitched pieces: 6 pitch-class magnitudes (|f5| ~ diatonic, |f3| ~ triadic, |f6| ~ whole-tone...) + 8 rhythm ones.
 */
export function fingerprint(pieza) {
  const notas = pieza.notas ?? [];
  if (pieza.tipo === 'ritmo') {
    return [KICK, SNARE, HAT].flatMap((set) => magnitudes(onsets(notas, (n) => set.has(n.tono)), 8)).concat(magnitudes(onsets(notas, (n) => !KIT.has(n.tono)), 8));
  }
  const pcs = Array(12).fill(0);
  for (const n of notas) pcs[((n.tono % 12) + 12) % 12] += n.duracion;
  return [...magnitudes(pcs, 6), ...magnitudes(onsets(notas), 8)];
}

export const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));

/**
 * The piece itself plus its bar-aligned 2-bar windows (for pieces longer than 2 bars), as fingerprints. Copies are
 * usually excerpts, so near-copy checks compare windows too. Windows with fewer than 4 notes are too thin to compare.
 */
export function windowFingerprints(pieza) {
  const bars = pieza.compases ?? Math.ceil(Math.max(0, ...(pieza.notas ?? []).map((n) => n.inicio + n.duracion)) / 4);
  const out = [fingerprint(pieza)];
  for (let s = 0; s + 2 < bars + 0.001 && bars > 2; s++) {
    const notas = pieza.notas.filter((n) => n.inicio >= s * 4 - 1e-6 && n.inicio < (s + 2) * 4 - 1e-6);
    if (notas.length >= 4) out.push(fingerprint({ ...pieza, notas }));
  }
  return out;
}

// --- Ranking (pure, so it is testable without a database) ----------------------------------------------------------

export const TOO_CLOSE = 0.15; // below this distance two pieces are near-copies (2 notes changed in a melody ~ 0.09)

/**
 * Distance as a readable 0-100 score: 100 = same notes up to transposition, inversion or a time shift;
 * 0 = as far apart as two typical pieces of that type (`scale`: their median distance, see typicalDistance).
 */
export const similitud = (d, scale = 1) => Math.max(0, Math.round(100 * (1 - d / scale)));

/** Median distance between pieces of one type (from at most 200 of them), the 0% point of similitud. */
export function typicalDistance(entries) {
  const sample = entries.slice(0, 200);
  const ds = [];
  for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < sample.length; j++) ds.push(distance(sample[i].f, sample[j].f));
  ds.sort((a, b) => a - b);
  return ds.length ? Math.max(ds[ds.length >> 1], TOO_CLOSE * 2) : 1;
}

/** Library entries: { pieza (without notas), f (fingerprint) }. Returns the n nearest of the same type, closest first. */
export function nearest(f, entries, { n = 8, skip = () => false, scale = 1 } = {}) {
  return entries
    .filter((e) => !skip(e))
    .map((e) => ({ e, d: distance(f, e.f) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ e, d }) => ({ ...e.pieza, similitud: similitud(d, scale), distancia: Math.round(d * 1000) / 1000 }));
}

/** First piece of the fork chain a piece belongs to (its family), using parent_id links among `byId`. */
export function familyRoot(id, parentId, byId) {
  let root = id ?? parentId;
  let parent = parentId;
  for (let hops = 0; parent && hops < 50; hops++) {
    root = parent;
    parent = byId.get(parent)?.pieza.parent_id;
  }
  return root;
}

/**
 * The closest piece by someone else, outside the candidate's own fork family, if it is a near-copy; else null.
 * Forks are meant to be similar to their parents, and your own pieces are yours to reuse.
 */
export function tooClose(candidate, entries, { autor, id = null, parentId = null, scale = 1 }) {
  const byId = new Map(entries.map((e) => [e.pieza.id, e]));
  const family = familyRoot(id, parentId, byId);
  const skip = (e) => e.pieza.id === id || e.pieza.autor === autor || (family && familyRoot(e.pieza.id, e.pieza.parent_id, byId) === family);
  const mine = windowFingerprints(candidate);
  let best = null;
  for (const e of entries) {
    if (skip(e)) continue;
    for (const a of mine) for (const b of e.fs ?? [e.f]) {
      const d = distance(a, b);
      if (!best || d < best.d) best = { e, d };
    }
  }
  return best && best.d < TOO_CLOSE ? { ...best.e.pieza, similitud: similitud(best.d, scale), distancia: Math.round(best.d * 1000) / 1000 } : null;
}
