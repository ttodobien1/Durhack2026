// Fingerprints of the public library, kept in memory: computing them is cheap, reading every piece is not.
import { describeAxis, featureNames, fingerprint, nearest, pca, tooClose, typicalDistance, windowFingerprints } from '../lib/fingerprint.js';
import { searchPiezas } from './piezas.js';
import { db } from '../db/client.js';
import { features } from '../db/features.js';
import { huellaVector, similitud } from '../lib/fingerprint.js';

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

/**
 * The n public pieces of one type nearest to fingerprint `vec` (a pgvector literal), by the HNSW index on huella.
 * `conn` is the database (a parameter so tests can pass their own). Returns [{ id, distancia }], closest first.
 */
export async function nearestInSql(conn, vec, tipo, excludeId, n) {
  const { rows } = await conn.query(
    `SELECT id, huella <-> $1::vector AS distancia FROM piezas
     WHERE tipo = $2 AND publica AND huella IS NOT NULL AND id <> $3
     ORDER BY huella <-> $1::vector LIMIT $4`,
    [vec, tipo, excludeId ?? '', n],
  );
  return rows.map((r) => ({ id: r.id, distancia: Number(r.distancia) }));
}

/**
 * Public pieces of the same type that sound most like `pieza` (which may be unsaved), closest first.
 * One indexed pgvector query when the database has it; the in-memory scan otherwise (or if the query fails).
 * similitud keeps the per-type scale (typical distance) of the cached library either way.
 */
export async function similarTo(pieza, { n = 8 } = {}) {
  const { byTipo, scale } = await library();
  const entries = byTipo[pieza.tipo] ?? [];
  if (features.vectores) {
    try {
      const byId = new Map(entries.map((e) => [e.pieza.id, e]));
      const rows = await nearestInSql(db, huellaVector(pieza), pieza.tipo, pieza.id, n);
      return rows
        .filter((r) => byId.has(r.id))
        .map((r) => ({ ...byId.get(r.id).pieza, similitud: similitud(r.distancia, scale[pieza.tipo]), distancia: Math.round(r.distancia * 1000) / 1000 }));
    } catch (err) {
      console.warn(`SQL similarity failed, using the in-memory scan: ${err.message}`);
    }
  }
  return nearest(fingerprint(pieza), entries, { n, skip: (e) => e.pieza.id === pieza.id, scale: scale[pieza.tipo] });
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

const round = (x, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * 3D map of the public pieces of one type (PCA of their fingerprints): close dots sound alike, in any key.
 * Each axis comes with the features that push pieces to each side, in words. Cached with the library.
 */
export async function mapOf(tipo) {
  const lib = await library();
  lib.maps ??= {};
  if (!lib.maps[tipo]) {
    const entries = lib.byTipo[tipo] ?? [];
    const { points, axes } = pca(entries.map((e) => e.f), 3);
    const names = featureNames(tipo);
    lib.maps[tipo] = {
      tipo,
      total: entries.length,
      ejes: axes.map((a) => ({ varianza: round(a.share), ...describeAxis(a.weights, names) })),
      puntos: entries.map(({ pieza }, i) => ({
        id: pieza.id,
        nombre: pieza.nombre,
        autor: pieza.autor,
        tonalidad: pieza.tonalidad,
        tempo: pieza.tempo,
        estilo: pieza.estilo,
        licencia: pieza.licencia,
        x: round(points[i][0]),
        y: round(points[i][1]),
        z: round(points[i][2] ?? 0),
      })),
    };
  }
  return lib.maps[tipo];
}

