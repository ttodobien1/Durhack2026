import { db } from '../db/client.js';
import { insertWithNewId } from '../lib/ids.js';
import { normalizeKey, normalizeText, searchableText, splitTags } from '../lib/normalize.js';
import { validateTipo } from '../lib/validate.js';

const COLUMNS = 'id, nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo, compases, parent_id, notas';

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
    estilo: JSON.parse(row.estilo),
    compases: Number(row.compases),
    parent_id: row.parent_id,
    notas: JSON.parse(row.notas),
  };
}

function rowArgs(pieza) {
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
  const result = await db.execute({ sql: `SELECT ${COLUMNS} FROM piezas WHERE id = ?`, args: [id] });
  return result.rows.length ? toPieza(result.rows[0]) : null;
}

export async function getPiezasByIds(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const result = await db.execute({
    sql: `SELECT ${COLUMNS} FROM piezas WHERE id IN (${unique.map(() => '?').join(', ')})`,
    args: unique,
  });
  return result.rows.map(toPieza);
}

// Filters (all optional):
//   estilo    "salsa" or "salsa,romantica" -> every tag must be present
//   tipo      ritmo | acordes | melodia | bajo
//   tonalidad "Am", "La menor", "A minor"...
//   q         free text; every word must appear in nombre/autor/tipo/tonalidad/fuente/estilo
//   autor     exact author (case-insensitive)
export async function searchPiezas({ estilo, tipo, tonalidad, q, autor, limit } = {}) {
  const where = [];
  const args = [];

  if (tipo) {
    where.push('tipo = ?');
    args.push(validateTipo(tipo));
  }
  if (tonalidad) {
    where.push('tonalidad = ?');
    args.push(normalizeKey(tonalidad));
  }
  for (const tag of splitTags(estilo)) {
    where.push('EXISTS (SELECT 1 FROM json_each(piezas.estilo) WHERE json_each.value = ?)');
    args.push(tag);
  }
  for (const word of normalizeText(q).split(' ').filter(Boolean)) {
    where.push("busqueda LIKE ? ESCAPE '\\'");
    args.push(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (autor) {
    where.push('lower(autor) = lower(?)');
    args.push(String(autor).trim());
  }

  let sql = `SELECT ${COLUMNS} FROM piezas`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY id';
  if (limit) {
    sql += ' LIMIT ?';
    args.push(limit);
  }

  const result = await db.execute({ sql, args });
  return result.rows.map(toPieza);
}

const INSERT_SQL = `INSERT INTO piezas
  (id, nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo, compases, parent_id, notas, busqueda)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Creates a piece with a new sequential id (ignores pieza.id). Returns the stored Pieza.
export async function createPieza(pieza) {
  const id = await insertWithNewId('piezas', 'p', (newId) =>
    db.execute({ sql: INSERT_SQL, args: [newId, ...rowArgs(pieza)] }),
  );
  return getPieza(id);
}

// Insert or overwrite a piece keeping its id (used by the seed script).
export async function upsertPieza(pieza) {
  await db.execute({
    sql: `${INSERT_SQL}
      ON CONFLICT(id) DO UPDATE SET
        nombre = excluded.nombre, tipo = excluded.tipo, autor = excluded.autor,
        licencia = excluded.licencia, fuente = excluded.fuente, tonalidad = excluded.tonalidad,
        tempo = excluded.tempo, estilo = excluded.estilo, compases = excluded.compases,
        parent_id = excluded.parent_id, notas = excluded.notas, busqueda = excluded.busqueda,
        updated_at = datetime('now')`,
    args: [pieza.id, ...rowArgs(pieza)],
  });
}

// Applies validated changes (see validatePiezaUpdate) and returns the updated Pieza, or null.
export async function updatePieza(id, changes) {
  const current = await getPieza(id);
  if (!current) return null;
  const merged = { ...current, ...changes };
  await db.execute({
    sql: `UPDATE piezas SET nombre = ?, tipo = ?, autor = ?, licencia = ?, fuente = ?, tonalidad = ?,
            tempo = ?, estilo = ?, compases = ?, parent_id = ?, notas = ?, busqueda = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
    args: [...rowArgs(merged), id],
  });
  return getPieza(id);
}

// Copies a piece as a fork: same notes and metadata, new id, parent_id = original.
export async function forkPieza(original, { autor, nombre }) {
  return createPieza({
    ...original,
    nombre: nombre || `${original.nombre} (fork)`,
    autor,
    fuente: `Fork of ${original.id}`,
    parent_id: original.id,
  });
}

// true if `ancestorId` appears somewhere up the parent_id chain of `pieceId`.
export async function isAncestor(ancestorId, pieceId) {
  const result = await db.execute({
    sql: `WITH RECURSIVE ancestros(id) AS (
            SELECT parent_id FROM piezas WHERE id = ?
            UNION
            SELECT p.parent_id FROM piezas p JOIN ancestros a ON p.id = a.id
          )
          SELECT 1 AS found FROM ancestros WHERE id = ? LIMIT 1`,
    args: [pieceId, ancestorId],
  });
  return result.rows.length > 0;
}

// Returns the subset of ids that exist in the database.
export async function existingPiezaIds(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const result = await db.execute({
    sql: `SELECT id FROM piezas WHERE id IN (${unique.map(() => '?').join(', ')})`,
    args: unique,
  });
  return new Set(result.rows.map((row) => row.id));
}
