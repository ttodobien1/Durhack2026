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

// --- Map (PCA to 2D) ---------------------------------------------------------------------------------------------

// Plain words for the website. |f5| and |f7| of a 16-step grid both rise with off-beat, irregular accents: "syncopation".
const PITCH_TERMS = ['chromatic clusters', 'fourths (quartal) colour', 'triad colour', 'octatonic colour', 'major/minor scale colour', 'whole-tone colour'];
const RHYTHM_TERMS = ['one accent per bar', 'half-note pulse', 'tresillo (3+3+2) feel', 'quarter-note pulse', 'syncopation', 'triplet feel', 'syncopation', 'eighth-note pulse'];
/** Plain-words name of each fingerprint number, in the order fingerprint() returns them. */
export function featureNames(tipo) {
  if (tipo === 'ritmo') return ['kick', 'snare', 'hats', 'other percussion'].flatMap((voice) => RHYTHM_TERMS.map((t) => `${voice}: ${t}`));
  return [...PITCH_TERMS, ...RHYTHM_TERMS]; // pitch terms all end in "colour", so rhythm terms need no prefix
}

/**
 * 2D map of fingerprints by PCA: standardize each number, then the two directions of largest spread (Jacobi
 * eigen-decomposition of the covariance; the matrices are at most 32x32). Returns points [x, y] and, per axis, the
 * share of the spread it shows and its weights.
 */
export function pca2(vectors) {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;
  if (n < 3 || !d) return { points: vectors.map(() => [0, 0]), axes: [] };
  const mean = Array.from({ length: d }, (_, j) => vectors.reduce((s, v) => s + v[j], 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(vectors.reduce((s, v) => s + (v[j] - mean[j]) ** 2, 0) / n) || 1);
  const Z = vectors.map((v) => v.map((x, j) => (x - mean[j]) / sd[j]));
  const A = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => Z.reduce((s, r) => s + r[a] * r[b], 0) / n));
  const V = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) off += A[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
      const c = Math.cos(th);
      const s = Math.sin(th);
      for (let k = 0; k < d; k++) {
        const [kp, kq] = [A[k][p], A[k][q]];
        A[k][p] = c * kp - s * kq;
        A[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < d; k++) {
        const [pk, qk] = [A[p][k], A[q][k]];
        A[p][k] = c * pk - s * qk;
        A[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < d; k++) {
        const [kp, kq] = [V[k][p], V[k][q]];
        V[k][p] = c * kp - s * kq;
        V[k][q] = s * kp + c * kq;
      }
    }
  }
  const order = A.map((row, i) => [row[i], i]).sort((a, b) => b[0] - a[0]);
  const total = order.reduce((s, [l]) => s + Math.max(l, 0), 0) || 1;
  const axes = order.slice(0, 2).map(([l, i]) => ({ share: Math.max(l, 0) / total, weights: V.map((row) => row[i]) }));
  return { points: Z.map((z) => axes.map((ax) => z.reduce((s, x, j) => s + x * ax.weights[j], 0))), axes };
}

/** "less X · more Y" description of one axis: the two strongest features on each side. */
export function describeAxis(weights, names) {
  const ranked = weights.map((w, i) => [w, names[i]]).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  const side = (sign) => [...new Set(ranked.filter(([w]) => Math.sign(w) === sign).map(([, name]) => name))].slice(0, 2);
  return { menos: side(-1), mas: side(1) };
}
