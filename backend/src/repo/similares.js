// Fingerprints of the public library, kept in memory: computing them is cheap, reading every piece is not.
import { fingerprint, nearest, tooClose, typicalDistance, windowFingerprints } from '../lib/fingerprint.js';
import { searchPiezas } from './piezas.js';

const MAX_AGE = 30_000; // also refresh on a timer: pieces can change through routes that do not call forget()
let cache = null; // { at, byTipo: { tipo: [{ pieza, f }] }, scale: { tipo: typical distance } }

/** Call after a piece is created or edited. */
export const forgetFingerprints = () => {
  cache = null;
};

async function library() {
  if (cache && Date.now() - cache.at < MAX_AGE) return cache;
  const byTipo = {};
  for (const { notas, ...pieza } of await searchPiezas({})) {
    const full = { ...pieza, notas };
    (byTipo[pieza.tipo] ??= []).push({ pieza: { ...pieza, numero_de_notas: notas.length }, f: fingerprint(full), fs: windowFingerprints(full) });
  }
  const scale = Object.fromEntries(Object.entries(byTipo).map(([tipo, entries]) => [tipo, typicalDistance(entries)]));
  cache = { at: Date.now(), byTipo, scale };
  return cache;
}

/** Public pieces of the same type that sound most like `pieza` (which may be unsaved), closest first. */
export async function similarTo(pieza, { n = 8 } = {}) {
  const { byTipo, scale } = await library();
  return nearest(fingerprint(pieza), byTipo[pieza.tipo] ?? [], { n, skip: (e) => e.pieza.id === pieza.id, scale: scale[pieza.tipo] });
}

/**
 * A public melody by someone else (outside the fork family) that `pieza` nearly copies, or null.
 * Melodies only: CLAUDE.md section 6 lets anyone reuse chord progressions and basic rhythms, and the pitch fingerprint
 * cannot tell chord order apart (i-iv-V7 and ii-V-i in A minor look the same), so warning on those would be noise.
 */
export async function nearCopyOf(pieza, autor) {
  if (pieza.tipo !== 'melodia') return null;
  const { byTipo, scale } = await library();
  return tooClose(pieza, byTipo[pieza.tipo] ?? [], { autor, id: pieza.id ?? null, parentId: pieza.parent_id ?? null, scale: scale[pieza.tipo] });
}
