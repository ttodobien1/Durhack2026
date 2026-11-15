import { forgetEmbedding, setHuella } from './vectores.js';
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

// SQL condition for searches: pieces `viewer` may find (public ones, plus their own private ones). `param` adds a value.
const visibleTo = (param, viewerId) => (viewerId ? `(publica OR usuario_id = ${param(viewerId)})` : 'publica');

// SQL condition: pieces the account in placeholder `p` may open. Besides public pieces and its own private ones,
// the private pieces used in a project it owns or collaborates on (cambios.md §14), so a shared private project opens
// for everyone in it.
const openableBy = (p) => `(piezas.publica OR piezas.usuario_id = ${p} OR EXISTS (
  SELECT 1 FROM bloques b JOIN canciones c ON c.id = b.cancion_id
  WHERE b.pieza_id = piezas.id AND c.borrada_at IS NULL
    AND (c.usuario_id = ${p} OR EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = ${p}))))`;

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

// The piece if `viewerId` may open it (see openableBy), else null.
export async function getVisiblePieza(id, viewerId = null) {
  const result = await db.query(`SELECT ${COLUMNS} FROM piezas WHERE id = $1 AND ${openableBy('$2')}`, [id, viewerId]);
  return result.rows.length ? toPieza(result.rows[0]) : null;
}

// The private pieces among `ids`: [{ id, nombre, autor }] (a public project cannot use them).
export async function privatePiezasAmong(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const result = await db.query(`SELECT id, nombre, autor FROM piezas WHERE id IN (${placeholders(unique)}) AND NOT publica ORDER BY id`, unique);
  return result.rows;
}

// Why the author of a piece cannot switch it to `publica` right now (a message), or null if they can.
//   private: not while a public project uses it, nor while other people's projects use it or their forks come from it
//            (that would break their work); and pieces with no owner account stay public.
//   public:  not while the piece it was forked from is private (the origin tree would show it).
export async function visibilityBlocker(id, publica) {
  if (publica) {
    const parent = await db.query(
      'SELECT p.id, p.nombre FROM piezas c JOIN piezas p ON p.id = c.parent_id WHERE c.id = $1 AND NOT p.publica',
      [id],
    );
    const row = parent.rows[0];
    return row ? `It comes from your private piece ${row.nombre} (${row.id}): make that one public first.` : null;
  }
  const owner = (await db.query('SELECT usuario_id FROM piezas WHERE id = $1', [id])).rows[0];
  if (!owner?.usuario_id) return 'Only pieces owned by an account can be private.';
  const [publicUse, othersUse, othersForks] = await Promise.all([
    db.query(
      `SELECT DISTINCT c.id, c.nombre FROM bloques b JOIN canciones c ON c.id = b.cancion_id
       WHERE b.pieza_id = $1 AND c.publica AND c.borrada_at IS NULL ORDER BY c.id LIMIT 3`,
      [id],
    ),
    db.query(
      `SELECT DISTINCT c.id FROM bloques b JOIN canciones c ON c.id = b.cancion_id
       WHERE b.pieza_id = $1 AND c.borrada_at IS NULL AND c.usuario_id IS DISTINCT FROM $2 LIMIT 1`,
      [id, owner.usuario_id],
    ),
    db.query('SELECT id FROM piezas WHERE parent_id = $1 AND usuario_id IS DISTINCT FROM $2 LIMIT 1', [id, owner.usuario_id]),
  ]);
  if (publicUse.rows.length) {
    const names = publicUse.rows.map((c) => `${c.nombre} (${c.id})`).join(', ');
    return `It is used in public projects: ${names}. Make them private or take the piece out first.`;
  }
  if (othersUse.rows.length || othersForks.rows.length) return 'Other people already use it or forked it, so it has to stay public.';
  return null;
}

// Sets who may see a piece (checked first with visibilityBlocker). Returns the piece.
export async function setPiezaPublica(id, publica) {
  await db.query('UPDATE piezas SET publica = $2, updated_at = now() WHERE id = $1', [id, publica]);
  if (!publica) await forgetEmbedding(id);
  return getPieza(id);
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
  const created = await getPieza(id);
  await setHuella(created);
  return created;
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
  await setHuella(pieza);
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
  if (changes.notas) await setHuella({ ...merged, id });
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

// Returns the subset of ids that exist in the database and `viewerId` may open (see openableBy).
export async function existingPiezaIds(ids, viewerId = null) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const result = await db.query(
    `SELECT id FROM piezas WHERE id IN (${placeholders(unique)}) AND ${openableBy(`$${unique.length + 1}`)}`,
    [...unique, viewerId],
  );
  return new Set(result.rows.map((row) => row.id));
}
