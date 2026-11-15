import { db } from '../db/client.js';
import { badRequest } from '../lib/errors.js';
import { insertWithNewId } from '../lib/ids.js';
import { existingPiezaIds, publishPiezas } from './piezas.js';

// Builds Cancion objects (contract 4.2) from the three tables.
function assemble(cancionRows, pistaRows, bloqueRows) {
  const canciones = new Map();
  for (const row of cancionRows) {
    canciones.set(row.id, {
      id: row.id,
      nombre: row.nombre,
      autor: row.autor,
      tempo: Number(row.tempo),
      publica: row.publica,
      descripcion: row.descripcion ?? null,
      // Extras (cambios.md §9): the project it was forked from, and its latest version number (0 = none yet).
      parent_id: row.parent_id ?? null,
      parent_version: row.parent_version == null ? null : Number(row.parent_version),
      version: row.version == null ? 0 : Number(row.version),
      // Only songs in the trash: when they were deleted and when they are removed for good.
      ...(row.borrada_at && {
        borrada: new Date(row.borrada_at).toISOString(),
        se_borra: new Date(new Date(row.borrada_at).getTime() + TRASH_DAYS * 86400e3).toISOString(),
      }),
      pistas: [],
    });
  }
  const pistas = new Map();
  for (const row of pistaRows) {
    const pista = { instrumento: row.instrumento, bloques: [] };
    pistas.set(`${row.cancion_id}#${row.posicion}`, pista);
    canciones.get(row.cancion_id)?.pistas.push(pista);
  }
  for (const row of bloqueRows) {
    pistas.get(`${row.cancion_id}#${row.pista_posicion}`)?.bloques.push({
      pieza_id: row.pieza_id,
      compas: Number(row.compas),
    });
  }
  return [...canciones.values()];
}

// One song by id (any visibility: the route decides who may see it), or a list: public songs, or the songs by
// `autor`, private ones included only when `withPrivate` (the author is the one asking). Songs in the trash are
// left out of all of these; `trashOf` (an account id) lists only that account's songs in the trash.
async function loadCanciones({ id, autor, withPrivate = false, trashOf = null } = {}) {
  const [where, args] = id
    ? ['WHERE id = $1 AND borrada_at IS NULL', [id]]
    : trashOf
      ? ['WHERE usuario_id = $1 AND borrada_at IS NOT NULL', [trashOf]]
      : autor
        ? ['WHERE autor = $1 AND (publica OR $2) AND borrada_at IS NULL', [autor, withPrivate]]
        : ['WHERE publica AND borrada_at IS NULL', []];
  const ofSongs = `WHERE cancion_id IN (SELECT id FROM canciones ${where})`;
  const [canciones, pistas, bloques] = await Promise.all([
    db.query(
      `SELECT id, nombre, autor, tempo, publica, descripcion, parent_id, parent_version, borrada_at,
              (SELECT MAX(numero) FROM versiones v WHERE v.cancion_id = canciones.id) AS version
       FROM canciones ${where} ORDER BY ${trashOf ? 'borrada_at DESC' : 'id'}`,
      args,
    ),
    db.query(`SELECT cancion_id, posicion, instrumento FROM pistas ${ofSongs} ORDER BY cancion_id, posicion`, args),
    db.query(
      `SELECT cancion_id, pista_posicion, pieza_id, compas FROM bloques ${ofSongs}
       ORDER BY cancion_id, pista_posicion, compas, id`,
      args,
    ),
  ]);
  return assemble(canciones.rows, pistas.rows, bloques.rows);
}

export async function listCanciones(autor, withPrivate = false) {
  return loadCanciones({ autor, withPrivate });
}

export async function getCancion(id) {
  const [cancion] = await loadCanciones({ id });
  return cancion ?? null;
}

// Owner of a song: { usuario_id (null when unowned), autor }, or null if the song does not exist or is in the trash.
export async function getCancionOwner(id) {
  const result = await db.query('SELECT usuario_id, autor FROM canciones WHERE id = $1 AND borrada_at IS NULL', [id]);
  return result.rows[0] ?? null;
}

// --- Trash ----------------------------------------------------------------------------------------------

export const TRASH_DAYS = 20;

// Owner, visibility and trash state of a song, in the trash or not: { usuario_id, autor, publica, borrada_at }.
export async function getCancionState(id) {
  const result = await db.query('SELECT usuario_id, autor, publica, borrada_at FROM canciones WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

// Songs in the trash of an account, most recently deleted first (each with `borrada` and `se_borra`).
export async function listPapelera(usuarioId) {
  return loadCanciones({ trashOf: usuarioId });
}

// Moves a song to the trash. A song with no owner account (saved before accounts, or signed out) becomes the
// deleting account's, so it shows in that account's trash; one authored "you" (signed out) is credited to it too.
export async function trashCancion(id, usuario) {
  await db.query(
    `UPDATE canciones SET borrada_at = now(),
       autor = CASE WHEN usuario_id IS NULL AND autor = 'you' THEN $3 ELSE autor END,
       usuario_id = COALESCE(usuario_id, $2)
     WHERE id = $1 AND borrada_at IS NULL`,
    [id, usuario.id, usuario.nombre],
  );
}

export async function restoreCancion(id) {
  await db.query('UPDATE canciones SET borrada_at = NULL, updated_at = now() WHERE id = $1', [id]);
  return getCancion(id);
}

// Removes a song for good: its tracks, blocks and versions go with it (ON DELETE CASCADE). Projects forked from it
// stay, as originals. Its pieces stay too: they are reusable and other songs or forks may use them.
export async function purgeCancion(id) {
  await db.transaction(async (tx) => {
    await tx.query('UPDATE canciones SET parent_id = NULL, parent_version = NULL WHERE parent_id = $1', [id]);
    await tx.query('DELETE FROM canciones WHERE id = $1', [id]);
  });
}

// Removes the songs that have been in the trash for more than TRASH_DAYS. There is no cron (Vercel functions), so
// the routes call it: at most once an hour per server instance, unless `force`.
let lastPurge = 0;
export async function purgeExpiredCanciones({ force = false } = {}) {
  if (!force && Date.now() - lastPurge < 3600e3) return;
  lastPurge = Date.now();
  const expired = await db.query(`SELECT id FROM canciones WHERE borrada_at < now() - interval '${TRASH_DAYS} days'`);
  for (const { id } of expired.rows) await purgeCancion(id);
}

// The project a song was forked from and the projects forked from it (any visibility: the route filters).
export async function getRelatedCanciones(id) {
  const result = await db.query(
    `SELECT c.id, c.nombre, c.autor, c.publica, c.parent_id, c.parent_version, c.updated_at,
            (SELECT MAX(numero) FROM versiones v WHERE v.cancion_id = c.id) AS version
     FROM canciones c
     WHERE (c.parent_id = $1 OR c.id = (SELECT parent_id FROM canciones WHERE id = $1)) AND c.borrada_at IS NULL
     ORDER BY c.updated_at DESC`,
    [id],
  );
  const toItem = (row) => ({
    id: row.id,
    nombre: row.nombre,
    autor: row.autor,
    publica: row.publica,
    parent_id: row.parent_id,
    parent_version: row.parent_version == null ? null : Number(row.parent_version),
    version: row.version == null ? 0 : Number(row.version),
    actualizado: new Date(row.updated_at).toISOString(),
  });
  return {
    parent: result.rows.filter((row) => row.parent_id !== id).map(toItem)[0] ?? null,
    forks: result.rows.filter((row) => row.parent_id === id).map(toItem),
  };
}

// Every piece must exist and be visible to whoever saves the song (someone else's private piece is "unknown").
async function assertPiezasExist(cancion, viewerId) {
  const ids = cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id));
  const found = await existingPiezaIds(ids, viewerId);
  const missing = [...new Set(ids.filter((id) => !found.has(id)))];
  if (missing.length) throw badRequest(`Unknown pieza_id: ${missing.join(', ')}`);
}

// A public song makes the pieces it uses public (cambios.md §10).
async function publishIfPublic(cancion) {
  if (cancion.publica === false) return;
  await publishPiezas(cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id)));
}

// (Re)writes the tracks and blocks of a song inside a transaction.
async function writeTracks(tx, id, cancion) {
  await tx.query('DELETE FROM bloques WHERE cancion_id = $1', [id]);
  await tx.query('DELETE FROM pistas WHERE cancion_id = $1', [id]);
  for (const [posicion, pista] of cancion.pistas.entries()) {
    await tx.query('INSERT INTO pistas (cancion_id, posicion, instrumento) VALUES ($1, $2, $3)', [
      id,
      posicion,
      pista.instrumento,
    ]);
    for (const bloque of pista.bloques) {
      await tx.query('INSERT INTO bloques (cancion_id, pista_posicion, pieza_id, compas) VALUES ($1, $2, $3, $4)', [
        id,
        posicion,
        bloque.pieza_id,
        bloque.compas,
      ]);
    }
  }
}

// Creates a song with a new sequential id, owned by `usuarioId` (null = anonymous). Returns the stored Cancion.
// `fork` = { parent_id, parent_version } when the song is a copy of another project.
export async function createCancion(cancion, usuarioId = null, fork = null) {
  await assertPiezasExist(cancion, usuarioId);
  const id = await insertWithNewId('canciones', 'c', (newId) =>
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO canciones (id, nombre, autor, tempo, publica, usuario_id, parent_id, parent_version, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newId, cancion.nombre, cancion.autor, cancion.tempo, cancion.publica ?? true, usuarioId, fork?.parent_id ?? null, fork?.parent_version ?? null, cancion.descripcion || null],
      );
      await writeTracks(tx, newId, cancion);
    }),
  );
  await publishIfPublic(cancion);
  return getCancion(id);
}

// Inserts or fully replaces a song keeping its id (PUT, merge and seed). `viewerId`: the account saving it.
// Returns the stored Cancion.
export async function saveCancion(id, cancion, viewerId = null) {
  await assertPiezasExist(cancion, viewerId);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO canciones (id, nombre, autor, tempo, publica, descripcion) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, autor = EXCLUDED.autor,
         tempo = EXCLUDED.tempo, publica = EXCLUDED.publica, updated_at = now(),
         -- not sent (NULL) keeps the stored description; "" clears it
         descripcion = CASE WHEN $6::text IS NULL THEN canciones.descripcion ELSE NULLIF($6, '') END`,
      [id, cancion.nombre, cancion.autor, cancion.tempo, cancion.publica ?? true, cancion.descripcion ?? null],
    );
    await writeTracks(tx, id, cancion);
  });
  await publishIfPublic(cancion);
  return getCancion(id);
}

// Lineage tree: every piece used in the song plus its full chain of parents.
// Edges go from parent (desde) to fork (hacia).
export async function getArbol(cancionId) {
  const [cancionResult, nodesResult] = await Promise.all([
    db.query('SELECT id, nombre, autor FROM canciones WHERE id = $1 AND borrada_at IS NULL', [cancionId]),
    db.query(
      `WITH RECURSIVE
         usadas(id) AS (SELECT DISTINCT pieza_id FROM bloques WHERE cancion_id = $1),
         linaje(id) AS (
           SELECT id FROM usadas
           UNION
           SELECT p.parent_id FROM piezas p JOIN linaje l ON p.id = l.id WHERE p.parent_id IS NOT NULL
         )
       SELECT p.id, p.nombre, p.autor, p.tipo, p.licencia, p.fuente, p.parent_id,
              EXISTS (SELECT 1 FROM usadas u WHERE u.id = p.id) AS en_cancion
       FROM piezas p JOIN linaje l ON p.id = l.id
       ORDER BY p.id`,
      [cancionId],
    ),
  ]);
  if (cancionResult.rows.length === 0) return null;

  const rows = nodesResult.rows;
  const ids = new Set(rows.map((row) => row.id));
  const nodos = rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    autor: row.autor,
    tipo: row.tipo,
    licencia: row.licencia,
    fuente: row.fuente,
    en_cancion: Boolean(row.en_cancion),
  }));
  const aristas = rows
    .filter((row) => row.parent_id && ids.has(row.parent_id))
    .map((row) => ({ desde: row.parent_id, hacia: row.id }));

  const cancion = cancionResult.rows[0];
  return {
    cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor },
    nodos,
    aristas,
    // "This song has N pieces by M authors" (authors of the whole tree, origins included).
    resumen: {
      piezas: nodos.filter((nodo) => nodo.en_cancion).length,
      autores: [...new Set(nodos.map((nodo) => nodo.autor))],
    },
  };
}
