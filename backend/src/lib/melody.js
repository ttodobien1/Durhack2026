// Melody matching for "hum to DJ Stemy": the browser turns the user's humming into notes (contract 4.1 format), and
// this module finds the library melodies that sound like it. Nothing here writes music: it only compares and ranks
// pieces that already exist.
//
// How it compares (so a hum matches whatever key and speed it was sung in):
//   - pitch: the steps between consecutive notes, in semitones (transposition does not matter)
//   - rhythm: each note's length relative to the melody's typical note length (tempo does not matter)
//   - local alignment (Smith-Waterman): the hum may be just a fragment of the piece, start mid-phrase, or have a
//     note missing or added. Repeated notes are cheap to skip, since "da-da" often comes out as one long note.

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Krumhansl-Kessler key profiles (major / minor), index 0 = tonic.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Highest note at each onset, in time order: the tune of a piece even when it has chords. */
export function melodyLine(notas) {
  const byStart = new Map();
  for (const n of notas ?? []) {
    const key = Math.round(Number(n.inicio) * 1000);
    const current = byStart.get(key);
    if (!current || n.tono > current.tono) byStart.set(key, n);
  }
  return [...byStart.values()].sort((a, b) => a.inicio - b.inicio);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** One step per pair of consecutive notes: { interval (semitones), dur (log2 length vs the typical note), from }. */
export function steps(line) {
  if (line.length < 2) return [];
  // A note lasts until the next one starts (rests count as part of the note); the last one keeps its own length.
  const lengths = line.map((n, i) => Math.max(0.05, i < line.length - 1 ? line[i + 1].inicio - n.inicio : n.duracion));
  const typical = median(lengths);
  return line.slice(1).map((n, i) => ({
    interval: n.tono - line[i].tono,
    dur: Math.log2(lengths[i] / typical),
    from: line[i].tono,
  }));
}

const MATCH = 2; // same interval
const NEAR = 1; // one semitone off: normal when humming
const RHYTHM_BONUS = 0.5;
const PER_STEP = MATCH + RHYTHM_BONUS; // best score of one step
const GAP = -1.2;
const CHEAP_GAP = -0.3; // skipping a repeated note (interval 0)

function stepScore(h, c) {
  const off = Math.abs(h.interval - c.interval);
  let score;
  if (off === 0) score = MATCH;
  else if (off === 1) score = NEAR;
  else if (off === 2) score = -0.5;
  else score = -1.5;
  const rhythm = Math.abs(h.dur - c.dur);
  if (rhythm < 0.35) score += RHYTHM_BONUS;
  else if (rhythm > 1.2) score -= 0.25;
  return score;
}

/**
 * Local alignment of hum steps against piece steps. Returns { score, humStart, pieceStart } where the starts are
 * the indexes of the first aligned steps (used to work out the transposition).
 */
function align(hum, piece) {
  const m = hum.length;
  const n = piece.length;
  let prev = new Float64Array(n + 1);
  let prevStart = new Array(n + 1).fill(null);
  let best = { score: 0, humStart: 0, pieceStart: 0 };
  for (let i = 1; i <= m; i++) {
    const row = new Float64Array(n + 1);
    const rowStart = new Array(n + 1).fill(null);
    const skipHum = hum[i - 1].interval === 0 ? CHEAP_GAP : GAP;
    for (let j = 1; j <= n; j++) {
      const skipPiece = piece[j - 1].interval === 0 ? CHEAP_GAP : GAP;
      const diag = prev[j - 1] + stepScore(hum[i - 1], piece[j - 1]);
      const up = prev[j] + skipHum;
      const left = row[j - 1] + skipPiece;
      let value = 0;
      let start = null;
      if (diag > value) {
        value = diag;
        start = prevStart[j - 1] ?? [i - 1, j - 1];
      }
      if (up > value) {
        value = up;
        start = prevStart[j];
      }
      if (left > value) {
        value = left;
        start = rowStart[j - 1];
      }
      row[j] = value;
      rowStart[j] = value > 0 ? start : null;
      if (value > best.score && start) best = { score: value, humStart: start[0], pieceStart: start[1] };
    }
    prev = row;
    prevStart = rowStart;
  }
  return best;
}

/**
 * How much `pieceNotas` sounds like `humNotas`: 0 (nothing alike) to 1 (same tune and rhythm).
 * Also returns `transponer`: semitones to move the piece so it starts on the hummed pitch (-6..+5).
 */
export function compareMelodies(humNotas, pieceNotas) {
  const humLine = melodyLine(humNotas);
  const pieceLine = melodyLine(pieceNotas);
  const hum = steps(humLine);
  const piece = steps(pieceLine);
  if (hum.length < 2 || piece.length < 2) return { similitud: 0, transponer: 0 };
  const { score, humStart, pieceStart } = align(hum, piece);
  // A piece much shorter than the hum cannot explain all of it, so it is measured against most of the hum.
  const span = Math.max(Math.min(hum.length, piece.length), 0.6 * hum.length);
  const similitud = Math.max(0, Math.min(1, score / (PER_STEP * span)));
  const shift = (((humLine[humStart].tono - pieceLine[pieceStart].tono) % 12) + 12) % 12;
  return { similitud: Math.round(similitud * 100) / 100, transponer: shift > 5 ? shift - 12 : shift };
}

/** Most likely key of some notes ("Am", "C"...), weighting each pitch class by how long it sounds. */
export function detectKey(notas) {
  const weights = new Array(12).fill(0);
  for (const n of notas ?? []) weights[((n.tono % 12) + 12) % 12] += Math.max(0.25, Number(n.duracion) || 0.25);
  if (weights.every((w) => w === 0)) return null;
  const correlation = (profile, tonic) => {
    const xs = weights;
    const ys = xs.map((_, pc) => profile[(pc - tonic + 12) % 12]);
    const mx = xs.reduce((a, b) => a + b, 0) / 12;
    const my = ys.reduce((a, b) => a + b, 0) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < 12; k++) {
      num += (xs[k] - mx) * (ys[k] - my);
      dx += (xs[k] - mx) ** 2;
      dy += (ys[k] - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  let best = { r: -Infinity, key: null };
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = correlation(MAJOR_PROFILE, tonic);
    if (major > best.r) best = { r: major, key: NOTE_NAMES[tonic] };
    const minor = correlation(MINOR_PROFILE, tonic);
    if (minor > best.r) best = { r: minor, key: `${NOTE_NAMES[tonic]}m` };
  }
  return best.key;
}

/** A key moved by some semitones: transposeKey("Am", -5) -> "Em". Unknown keys come back as they are. */
export function transposeKey(key, semitones) {
  if (!key) return null;
  const minor = key.endsWith('m');
  const tonic = NOTE_NAMES.indexOf(minor ? key.slice(0, -1) : key);
  if (tonic < 0) return key;
  return NOTE_NAMES[(((tonic + semitones) % 12) + 12) % 12] + (minor ? 'm' : '');
}

/** The relative key: "Am" <-> "C". Accompaniment in either key fits the same melody. */
export function relativeKey(key) {
  if (!key) return null;
  const minor = key.endsWith('m');
  const tonic = NOTE_NAMES.indexOf(minor ? key.slice(0, -1) : key);
  if (tonic < 0) return null;
  return minor ? NOTE_NAMES[(tonic + 3) % 12] : `${NOTE_NAMES[(tonic + 9) % 12]}m`;
}

/**
 * Ranks `piezas` by how much they sound like the hum. Returns the best `limit` with similitud >= `min`:
 * [{ pieza, similitud, transponer }], best first.
 */
export function rankByMelody(humNotas, piezas, { limit = 5, min = 0.2 } = {}) {
  return piezas
    .map((pieza) => ({ pieza, ...compareMelodies(humNotas, pieza.notas) }))
    .filter((match) => match.similitud >= min)
    .sort((a, b) => b.similitud - a.similitud || a.pieza.id.localeCompare(b.pieza.id))
    .slice(0, limit);
}
