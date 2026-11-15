import { db, placeholders } from '../db/client.js';
import { insertWithNewId } from '../lib/ids.js';
import { normalizeKey, normalizeText, searchableText, splitTags } from '../lib/normalize.js';
import { validateTipo } from '../lib/validate.js';

const COLUMNS = 'id, nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo, compases, parent_id, notas, publica';

// JSONB columns come back already parsed; keep a fallback in case a driver returns text.
const fromJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

// DB row -> Pieza (contract 4.1)
function toPieza(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    autor: row.autor,
    licencia: row.licencia,
    fuente: row.fuente,
    tonalidad: row.tonalidad,
    tempo: Number(row.tempo),
    estilo: fromJson(row.estilo),
    compases: Number(row.compases),
    parent_id: row.parent_id,
    notas: fromJson(row.notas),
    publica: row.publica !== false, // extra: false while only its author can see it (cambios.md §10)
  };
}

// SQL condition: pieces `viewer` may see (public ones, plus their own private ones). `param` adds a value.
const visibleTo = (param, viewerId) => (viewerId ? `(publica OR usuario_id = ${param(viewerId)})` : 'publica');

// Values for the 12 data columns, in the order used by INSERT_SQL / UPDATE.
function rowValues(pieza) {
  return [
    pieza.nombre,
    pieza.tipo,
    pieza.autor,
    pieza.licencia,
    pieza.fuente ?? '',
    pieza.tonalidad ?? null,
    pieza.tempo,
    JSON.stringify(pieza.estilo ?? []),
    pieza.compases,
    pieza.parent_id ?? null,
    JSON.stringify(pieza.notas ?? []),
    searchableText(pieza),
  ];
}

export async function getPieza(id) {
  const result = await db.query(`SELECT ${COLUMNS} FROM piezas WHERE id = $1`, [id]);
  return result.rows.length ? toPieza(result.rows[0]) : null;
}

// The piece if `viewerId` may see it (public, or their own private piece), else null.
export async function getVisiblePieza(id, viewerId = null) {
  const result = await db.query(`SELECT ${COLUMNS} FROM piezas WHERE id = $1 AND (publica OR usuario_id = $2)`, [id, viewerId]);
  return result.rows.length ? toPieza(result.rows[0]) : null;
}

// Makes pieces public, with every ancestor (a public song never shows a private piece, nor its origins).
export async function publishPiezas(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await db.query(
    `WITH RECURSIVE linaje(id) AS (
       SELECT id FROM piezas WHERE id IN (${placeholders(unique)})
       UNION
       SELECT p.parent_id FROM piezas p JOIN linaje l ON p.id = l.id WHERE p.parent_id IS NOT NULL
     )
     UPDATE piezas SET publica = true WHERE id IN (SELECT id FROM linaje) AND NOT publica`,
    unique,
  );
}

export async function getPiezasByIds(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const result = await db.query(`SELECT ${COLUMNS} FROM piezas WHERE id IN (${placeholders(unique)})`, unique);
  return result.rows.map(toPieza);
}

// Filters (all optional):
//   estilo    "rap" or "rap,boombap" -> every tag must be present
//   tipo      ritmo | acordes | melodia | bajo
//   tonalidad "Am", "La menor", "A minor"...
//   q         free text; every word must appear in nombre/autor/tipo/tonalidad/fuente/estilo
//   autor     exact author (case-insensitive)
// Private pieces are only found by their author (`viewerId`).
export async function searchPiezas({ estilo, tipo, tonalidad, q, autor, limit, viewerId = null } = {}) {
  const where = [];
  const args = [];
  const param = (value) => {
    args.push(value);
    return `$${args.length}`;
  };

  if (tipo) where.push(`tipo = ${param(validateTipo(tipo))}`);
  if (tonalidad) where.push(`tonalidad = ${param(normalizeKey(tonalidad))}`);
  const tags = splitTags(estilo);
  if (tags.length) where.push(`estilo @> ${param(JSON.stringify(tags))}::jsonb`);
  for (const word of normalizeText(q).split(' ').filter(Boolean)) {
    where.push(`busqueda LIKE ${param(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
  }
  if (autor) where.push(`lower(autor) = lower(${param(String(autor).trim())})`);
  where.push(visibleTo(param, viewerId));

  let sql = `SELECT ${COLUMNS} FROM piezas`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY id';
  if (limit) sql += ` LIMIT ${param(limit)}`;

  const result = await db.query(sql, args);
  return result.rows.map(toPieza);
}

const INSERT_SQL = `INSERT INTO piezas
  (id, nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo, compases, parent_id, notas, busqueda, usuario_id, publica)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14, $15)`;

// Creates a piece with a new sequential id (ignores pieza.id). `usuarioId` is the owner account, or null
// for anonymous work; `pieza.publica === false` keeps it private to that account. Returns the stored Pieza.
export async function createPieza(pieza, usuarioId = null) {
  const publica = !(usuarioId && pieza.publica === false);
  const id = await insertWithNewId('piezas', 'p', (newId) =>
    db.query(INSERT_SQL, [newId, ...rowValues(pieza), usuarioId, publica]),
  );
  return getPieza(id);
}

// Owner account of a piece: { usuario_id } (null when unowned), or null if the piece does not exist.
export async function getPiezaOwner(id) {
  const result = await db.query('SELECT usuario_id FROM piezas WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

// Insert or overwrite a piece keeping its id (used by the seed script; never changes the owner).
export async function upsertPieza(pieza) {
  await db.query(
    `${INSERT_SQL}
     ON CONFLICT (id) DO UPDATE SET
       nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, autor = EXCLUDED.autor,
       licencia = EXCLUDED.licencia, fuente = EXCLUDED.fuente, tonalidad = EXCLUDED.tonalidad,
       tempo = EXCLUDED.tempo, estilo = EXCLUDED.estilo, compases = EXCLUDED.compases,
       parent_id = EXCLUDED.parent_id, notas = EXCLUDED.notas, busqueda = EXCLUDED.busqueda,
       updated_at = now()`,
    [pieza.id, ...rowValues(pieza), null, true],
  );
}

// Applies validated changes (see validatePiezaUpdate) and returns the updated Pieza, or null.
export async function updatePieza(id, changes) {
  const current = await getPieza(id);
  if (!current) return null;
  const merged = { ...current, ...changes };
  await db.query(
    `UPDATE piezas SET nombre = $1, tipo = $2, autor = $3, licencia = $4, fuente = $5, tonalidad = $6,
       tempo = $7, estilo = $8::jsonb, compases = $9, parent_id = $10, notas = $11::jsonb, busqueda = $12,
       updated_at = now()
     WHERE id = $13`,
    [...rowValues(merged), id],
  );
  return getPieza(id);
}

// Copies a piece as a fork: same notes and metadata, new id, parent_id = original. A fork of a private piece
// stays private (only its author can fork it anyway).
export async function forkPieza(original, { autor, nombre, usuarioId = null }) {
  return createPieza(
    {
      ...original,
      nombre: nombre || `${original.nombre} (fork)`,
      autor,
      fuente: `Fork of ${original.id}`,
      parent_id: original.id,
    },
    usuarioId,
  );
}

// true if `ancestorId` appears somewhere up the parent_id chain of `pieceId`.
export async function isAncestor(ancestorId, pieceId) {
  const result = await db.query(
    `WITH RECURSIVE ancestros(id) AS (
       SELECT parent_id FROM piezas WHERE id = $1
       UNION
       SELECT p.parent_id FROM piezas p JOIN ancestros a ON p.id = a.id
     )
     SELECT 1 AS found FROM ancestros WHERE id = $2 LIMIT 1`,
    [pieceId, ancestorId],
  );
  return result.rows.length > 0;
}

// The given pieces plus every ancestor up their parent_id chains (full Pieza objects).
export async function getPiezasWithAncestors(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const result = await db.query(
    `WITH RECURSIVE linaje(id) AS (
       SELECT id FROM piezas WHERE id IN (${placeholders(unique)})
       UNION
       SELECT p.parent_id FROM piezas p JOIN linaje l ON p.id = l.id WHERE p.parent_id IS NOT NULL
     )
     SELECT ${COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')} FROM piezas p JOIN linaje l ON p.id = l.id ORDER BY p.id`,
    unique,
  );
  return result.rows.map(toPieza);
}

// Returns the subset of ids that exist in the database and `viewerId` may see.
export async function existingPiezaIds(ids, viewerId = null) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const result = await db.query(
    `SELECT id FROM piezas WHERE id IN (${placeholders(unique)}) AND (publica OR usuario_id = $${unique.length + 1})`,
    [...unique, viewerId],
  );
  return new Set(result.rows.map((row) => row.id));
}
