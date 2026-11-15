// Song versions (v1, v2...): a snapshot every time a song is saved, like commits. Also the merge base and the
// credits, which read the same history.
import { db } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { computeCredits } from '../lib/credits.js';
import { describeDiff, diffCanciones, usedPiezaIds } from '../lib/songDiff.js';
import { mergeCanciones } from '../lib/songMerge.js';
import { getCancion } from './canciones.js';
import { getPiezasByIds, getPiezasWithAncestors } from './piezas.js';

const fromJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const isDuplicateKey = (err) => err?.code === '23505' || /duplicate key/i.test(String(err?.message));

// Stable JSON (sorted keys): JSONB does not keep key order, so compare snapshots with this.
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
      : JSON.stringify(value);

// Snapshot of a Cancion as stored in `versiones.snapshot`: the arrangement plus the pieces it uses.
export async function snapshotOf(cancion) {
  const piezas = await getPiezasByIds([...usedPiezaIds(cancion)]);
  return {
    nombre: cancion.nombre,
    tempo: cancion.tempo,
    pistas: cancion.pistas.map((pista) => ({ instrumento: pista.instrumento, bloques: pista.bloques.map(({ pieza_id, compas }) => ({ pieza_id, compas })) })),
    piezas: Object.fromEntries(
      piezas.map((p) => [p.id, { nombre: p.nombre, autor: p.autor, tipo: p.tipo, licencia: p.licencia, parent_id: p.parent_id, compases: p.compases, notas: p.notas }]),
    ),
  };
}

const COLUMNS = 'cancion_id, numero, autor, mensaje, snapshot, merge_de, merge_version, created_at';

function toVersion(row) {
  return {
    cancion_id: row.cancion_id,
    numero: Number(row.numero),
    autor: row.autor,
    mensaje: row.mensaje,
    fecha: new Date(row.created_at).toISOString(),
    merge: row.merge_de ? { cancion_id: row.merge_de, numero: Number(row.merge_version) } : null,
    snapshot: fromJson(row.snapshot),
  };
}

// Public shape of a version (no snapshot).
export const versionInfo = ({ snapshot, ...rest }) => rest; // eslint-disable-line no-unused-vars

export async function getVersion(cancionId, numero) {
  const result = await db.query(`SELECT ${COLUMNS} FROM versiones WHERE cancion_id = $1 AND numero = $2`, [cancionId, numero]);
  return result.rows.length ? toVersion(result.rows[0]) : null;
}

export async function latestVersion(cancionId) {
  const result = await db.query(`SELECT ${COLUMNS} FROM versiones WHERE cancion_id = $1 ORDER BY numero DESC LIMIT 1`, [cancionId]);
  return result.rows.length ? toVersion(result.rows[0]) : null;
}

// Newest first (at most `limit`).
export async function listVersions(cancionId, limit = 200) {
  const result = await db.query(`SELECT ${COLUMNS} FROM versiones WHERE cancion_id = $1 ORDER BY numero DESC LIMIT $2`, [cancionId, limit]);
  return result.rows.map(toVersion);
}

// What a version is compared with by default: the version before it; for the first version of a fork, the
// version of the original it was forked from; for the first version of an original, nothing (null).
export async function previousOf(cancion, version) {
  if (version.numero > 1) return getVersion(cancion.id, version.numero - 1);
  if (cancion.parent_id && cancion.parent_version) return getVersion(cancion.parent_id, cancion.parent_version);
  return null;
}

/**
 * Records the current state of a song as a new version, unless nothing changed since the last one (then
 * returns the last one with `nueva: false`). `force` records it anyway (merges always mark the sync point).
 * Without `mensaje`, the message is generated from the changes.
 */
export async function recordVersion(cancionId, { autor, mensaje = '', mergeDe = null, mergeVersion = null, force = false } = {}) {
  const cancion = await getCancion(cancionId);
  if (!cancion) throw notFound(`Cancion not found: ${cancionId}`);
  const snapshot = await snapshotOf(cancion);
  const last = await latestVersion(cancionId);
  if (last && !force && canonical(last.snapshot) === canonical(snapshot)) return { ...versionInfo(last), nueva: false };

  let text = mensaje.trim();
  if (!text && last) text = describeDiff(diffCanciones(last.snapshot, snapshot));
  else if (!text && cancion.parent_id && cancion.parent_version) {
    const forkPoint = await getVersion(cancion.parent_id, cancion.parent_version);
    const changes = describeDiff(diffCanciones(forkPoint?.snapshot ?? null, snapshot));
    text = `Forked from ${cancion.parent_id} v${cancion.parent_version}${changes === 'No musical changes' ? '' : `: ${changes[0].toLowerCase()}${changes.slice(1)}`}`;
  } else if (!text) text = 'First version';

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await db.query(
        `INSERT INTO versiones (cancion_id, numero, autor, mensaje, snapshot, merge_de, merge_version)
         SELECT $1, COALESCE(MAX(numero), 0) + 1, $2, $3, $4::jsonb, $5, $6 FROM versiones WHERE cancion_id = $1
         RETURNING ${COLUMNS}`,
        [cancionId, autor || cancion.autor, text, JSON.stringify(snapshot), mergeDe, mergeVersion],
      );
      return { ...versionInfo(toVersion(result.rows[0])), nueva: true };
    } catch (err) {
      if (!isDuplicateKey(err) || attempt >= 4) throw err; // two saves at once: take the next number
    }
  }
}

// Songs saved before versions existed (and seed songs) get their current state as v1. Returns the latest number.
export async function ensureVersions(cancionId) {
  const last = await latestVersion(cancionId);
  if (last) return last.numero;
  return (await recordVersion(cancionId, {})).numero;
}

// Default comparison for a version, as the API returns it.
export async function versionDiff(cancion, numero, contra) {
  const hasta = await getVersion(cancion.id, numero);
  if (!hasta) throw notFound(`Version not found: ${cancion.id} v${numero}`);
  let desde;
  if (contra !== undefined) {
    desde = await getVersion(cancion.id, contra);
    if (!desde) throw notFound(`Version not found: ${cancion.id} v${contra}`);
  } else {
    desde = await previousOf(cancion, hasta);
  }
  return {
    desde: desde && versionInfo(desde),
    hasta: versionInfo(hasta),
    ...diffCanciones(desde?.snapshot ?? null, hasta.snapshot),
  };
}

// Version list with a change summary per version (newest first). `snapshots` keeps each full snapshot (for
// the version tree), limited to the newest `limit` versions.
export async function versionHistory(cancion, { snapshots = false, limit = 200 } = {}) {
  await ensureVersions(cancion.id);
  const versions = await listVersions(cancion.id, limit);
  const forkPoint = cancion.parent_id && cancion.parent_version ? await getVersion(cancion.parent_id, cancion.parent_version) : null;
  return versions.map((version, k) => {
    const before = versions[k + 1]?.snapshot ?? (version.numero === 1 ? forkPoint?.snapshot : null) ?? null;
    const { resumen, piezas } = diffCanciones(before, version.snapshot);
    return {
      ...versionInfo(version),
      ...(snapshots && { snapshot: version.snapshot }),
      resumen,
      // pieces this version touched, for the "who changed what" line of each version
      piezas: piezas.map(({ id, nombre, autor, tipo, estado }) => ({ id, nombre, autor, tipo, estado })),
    };
  });
}

// --- Merge ------------------------------------------------------------------------------------------

// Common starting point of two related songs: the latest of the fork point and the past merges between them.
async function mergeBase(a, b) {
  const candidates = [];
  const forkPoint = async (child, parent) => {
    if (child.parent_id !== parent.id || !child.parent_version) return;
    const first = await getVersion(child.id, 1);
    candidates.push({ cancion_id: parent.id, numero: child.parent_version, at: first ? first.fecha : '' });
  };
  await forkPoint(a, b);
  await forkPoint(b, a);
  const merges = await db.query(
    `SELECT merge_de, merge_version, created_at FROM versiones
     WHERE (cancion_id = $1 AND merge_de = $2) OR (cancion_id = $2 AND merge_de = $1)`,
    [a.id, b.id],
  );
  for (const row of merges.rows) {
    candidates.push({ cancion_id: row.merge_de, numero: Number(row.merge_version), at: new Date(row.created_at).toISOString() });
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => (x.at < y.at ? 1 : -1));
  return getVersion(candidates[0].cancion_id, candidates[0].numero);
}

/**
 * Merge preview of song `otra` into song `cancion` (both Cancion objects the requester can see).
 * Returns { base, mio, suyo, conflictos, choques, cambios (diff of your song → merged result), resultado }.
 */
export async function prepareMerge(cancion, otra, resoluciones = {}) {
  if (cancion.id === otra.id) throw badRequest('A project cannot be merged with itself');
  await ensureVersions(cancion.id);
  await ensureVersions(otra.id);
  const base = await mergeBase(cancion, otra);
  if (!base) throw badRequest(`Only a project and its forks can be merged: ${otra.id} is not a fork or the original of ${cancion.id}`);
  const [mio, suyo] = await Promise.all([latestVersion(cancion.id), latestVersion(otra.id)]);
  const merged = mergeCanciones({ base: base.snapshot, mio: mio.snapshot, suyo: suyo.snapshot, resoluciones, quien: otra.autor });
  return {
    base: { cancion_id: base.cancion_id, numero: base.numero },
    mio: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor, version: mio.numero },
    suyo: { id: otra.id, nombre: otra.nombre, autor: otra.autor, version: suyo.numero },
    conflictos: merged.conflictos,
    choques: merged.choques,
    cambios: diffCanciones(mio.snapshot, merged.resultado),
    resultado: merged.resultado,
  };
}

// --- Credits ----------------------------------------------------------------------------------------

export async function songCredits(cancion) {
  await ensureVersions(cancion.id);
  const [piezas, versions] = await Promise.all([getPiezasWithAncestors([...usedPiezaIds(cancion)]), listVersions(cancion.id)]);
  const credits = computeCredits({ cancion, piezas: new Map(piezas.map((p) => [p.id, p])), versiones: versions.map((v) => ({ autor: v.autor, merge_de: v.merge?.cancion_id })) });
  return { cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor, parent_id: cancion.parent_id }, ...credits };
}
