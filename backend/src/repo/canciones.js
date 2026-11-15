import { db } from '../db/client.js';
import { badRequest } from '../lib/errors.js';
import { insertWithNewId } from '../lib/ids.js';
import { existingPiezaIds, privatePiezasAmong } from './piezas.js';

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
      actualizado: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      // Connections (cambios.md §14): what the author lets others do, the open help request, and counters.
      permite_fork: row.permite_fork !== false,
      permite_propuestas: row.permite_propuestas !== false,
      pide_ayuda: row.pide_ayuda ?? null,
      pide_ayuda_at: row.pide_ayuda_at ? new Date(row.pide_ayuda_at).toISOString() : null,
      comentarios: Number(row.comentarios ?? 0),
      forks: Number(row.forks ?? 0),
      propuestas_abiertas: Number(row.propuestas_abiertas ?? 0),
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
// left out of all of these; `trashOf` (an account id) lists only that account's songs in the trash, `sharedWith`
// (an account id) the songs it collaborates on, and `ids` exactly those songs, in that order.
async function loadCanciones({ id, ids, autor, withPrivate = false, trashOf = null, sharedWith = null } = {}) {
  const [where, args] = id
    ? ['WHERE id = $1 AND borrada_at IS NULL', [id]]
    : ids
      ? ['WHERE id = ANY($1::text[]) AND borrada_at IS NULL', [ids]]
      : trashOf
        ? ['WHERE usuario_id = $1 AND borrada_at IS NOT NULL', [trashOf]]
        : sharedWith
          ? ['WHERE id IN (SELECT cancion_id FROM colaboradores WHERE usuario_id = $1) AND borrada_at IS NULL', [sharedWith]]
          : autor
            ? ['WHERE autor = $1 AND (publica OR $2) AND borrada_at IS NULL', [autor, withPrivate]]
            : ['WHERE publica AND borrada_at IS NULL', []];
  const ofSongs = `WHERE cancion_id IN (SELECT id FROM canciones ${where})`;
  const [canciones, pistas, bloques] = await Promise.all([
    db.query(
      `SELECT id, nombre, autor, tempo, publica, descripcion, parent_id, parent_version, borrada_at, updated_at,
              permite_fork, permite_propuestas, pide_ayuda, pide_ayuda_at,
              (SELECT MAX(numero) FROM versiones v WHERE v.cancion_id = canciones.id) AS version,
              (SELECT COUNT(*) FROM comentarios m WHERE m.objetivo = 'cancion' AND m.objetivo_id = canciones.id) AS comentarios,
              (SELECT COUNT(*) FROM canciones f WHERE f.parent_id = canciones.id AND f.borrada_at IS NULL) AS forks,
              (SELECT COUNT(*) FROM propuestas p WHERE p.cancion_id = canciones.id AND p.estado = 'abierta') AS propuestas_abiertas
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

// --- Who may see and edit a song (cambios.md §14) ----------------------------------------------------------

// The account's role in a song: 'autor' (its owner, or the author of a song with no owner account),
// 'colaborador' (joined with an invitation link) or null.
export async function rolEn(cancionId, usuario) {
  if (!usuario) return null;
  const result = await db.query(
    `SELECT c.usuario_id, c.autor,
            EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = $2) AS colabora
     FROM canciones c WHERE c.id = $1 AND c.borrada_at IS NULL`,
    [cancionId, usuario.id],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.usuario_id === usuario.id || (!row.usuario_id && row.autor === usuario.nombre)) return 'autor';
  return row.colabora ? 'colaborador' : null;
}

// Whether `usuario` (or nobody, when signed out) may see a song: public songs, its author, its collaborators, and
// whoever reviews a proposal made from it (the owner and collaborators of the project it was proposed to).
export async function canView(cancion, usuario) {
  if (!cancion) return false;
  if (cancion.publica || (usuario && cancion.autor === usuario.nombre)) return true;
  if (!usuario) return false;
  const result = await db.query(
    `SELECT EXISTS (SELECT 1 FROM colaboradores WHERE cancion_id = $1 AND usuario_id = $2)
         OR EXISTS (SELECT 1 FROM propuestas p JOIN canciones t ON t.id = p.cancion_id
                    WHERE p.desde_id = $1 AND (t.usuario_id = $2 OR EXISTS (
                      SELECT 1 FROM colaboradores k WHERE k.cancion_id = t.id AND k.usuario_id = $2))) AS ok`,
    [cancion.id, usuario.id],
  );
  return Boolean(result.rows[0].ok);
}

// Projects an account collaborates on (any visibility), for "Shared with you" in My projects.
export async function listCompartidas(usuarioId) {
  return loadCanciones({ sharedWith: usuarioId });
}

// Settings only the author changes, outside of the music: who may fork / propose, and the help request
// (a text sets it and dates it; null removes it). Returns the song.
export async function updateAjustes(id, { permite_fork, permite_propuestas, pide_ayuda }) {
  await db.query(
    `UPDATE canciones SET
       permite_fork = COALESCE($2, permite_fork),
       permite_propuestas = COALESCE($3, permite_propuestas),
       pide_ayuda = CASE WHEN $4::boolean THEN NULLIF($5, '') ELSE pide_ayuda END,
       pide_ayuda_at = CASE WHEN $4::boolean THEN (CASE WHEN NULLIF($5, '') IS NULL THEN NULL ELSE now() END) ELSE pide_ayuda_at END
     WHERE id = $1`,
    [id, permite_fork ?? null, permite_propuestas ?? null, pide_ayuda !== undefined, pide_ayuda ?? ''],
  );
  return getCancion(id);
}

// Home page: the most popular public projects (forks weigh most, then comments, then proposals) and the open help
// requests, newest first. Work saved without an account ("you", "anonymous") is left out, like on Explore.
export async function comunidad() {
  const [populares, ayuda] = await Promise.all([
    db.query(
      `SELECT id FROM canciones c
       WHERE publica AND borrada_at IS NULL AND autor NOT IN ('you', 'anonymous')
       ORDER BY 3 * (SELECT COUNT(*) FROM canciones f WHERE f.parent_id = c.id AND f.borrada_at IS NULL)
              + 2 * (SELECT COUNT(*) FROM comentarios m WHERE m.objetivo = 'cancion' AND m.objetivo_id = c.id)
              + (SELECT COUNT(*) FROM propuestas p WHERE p.cancion_id = c.id) DESC,
                updated_at DESC
       LIMIT 6`,
    ),
    db.query(
      `SELECT id FROM canciones
       WHERE publica AND borrada_at IS NULL AND pide_ayuda IS NOT NULL AND autor NOT IN ('you', 'anonymous')
       ORDER BY pide_ayuda_at DESC LIMIT 12`,
    ),
  ]);
  const inOrder = async (rows) => {
    const ids = rows.map((row) => row.id);
    if (!ids.length) return [];
    const byId = new Map((await loadCanciones({ ids })).map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  };
  return { populares: await inOrder(populares.rows), ayuda: await inOrder(ayuda.rows) };
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
    await tx.query(`DELETE FROM comentarios WHERE objetivo = 'cancion' AND objetivo_id = $1`, [id]);
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

// A public song can only use public pieces: whether a piece is public is its author's choice (cambios.md §14), so
// saving no longer publishes pieces by itself (the old rule of cambios.md §10).
async function assertPublicPieces(cancion) {
  if (cancion.publica === false) return;
  const hidden = await privatePiezasAmong(cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id)));
  if (hidden.length) {
    const list = hidden.map((p) => `${p.nombre} (${p.id}, by ${p.autor})`).join(', ');
    throw badRequest(`A public project can only use public pieces, and these are private: ${list}. Make them public (the lock next to the piece name in the piano roll), or keep the project private.`);
  }
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
  await assertPublicPieces(cancion);
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
  return getCancion(id);
}

// Inserts or fully replaces a song keeping its id (PUT, merge and seed). `viewerId`: the account saving it.
// Returns the stored Cancion.
export async function saveCancion(id, cancion, viewerId = null) {
  await assertPiezasExist(cancion, viewerId);
  await assertPublicPieces(cancion);
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
