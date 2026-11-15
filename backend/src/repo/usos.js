// Reuse counters: how many times a piece or a project has been reused by the community. A piece is reused when a
// project uses it or someone forks it; a project is reused when someone saves a copy (fork) of it.
// Counts include private work (it is still reuse), but lists only name what the viewer may open.
import { db, placeholders } from '../db/client.js';

const LIST_LIMIT = 30;

/**
 * Batch counters for cards and lists.
 *   piezaIds    -> { [id]: { canciones, forks, total } }
 *   cancionIds  -> { [id]: { forks, total } }
 */
export async function usageCounts({ piezaIds = [], cancionIds = [] } = {}) {
  const piezas = [...new Set(piezaIds)];
  const canciones = [...new Set(cancionIds)];
  const [inSongs, pieceForks, songForks] = await Promise.all([
    piezas.length
      ? db.query(
          `SELECT b.pieza_id AS id, COUNT(DISTINCT b.cancion_id) AS n FROM bloques b JOIN canciones c ON c.id = b.cancion_id
           WHERE b.pieza_id IN (${placeholders(piezas)}) AND c.borrada_at IS NULL GROUP BY b.pieza_id`,
          piezas,
        )
      : { rows: [] },
    piezas.length
      ? db.query(`SELECT parent_id AS id, COUNT(*) AS n FROM piezas WHERE parent_id IN (${placeholders(piezas)}) GROUP BY parent_id`, piezas)
      : { rows: [] },
    canciones.length
      ? db.query(
          `SELECT parent_id AS id, COUNT(*) AS n FROM canciones
           WHERE parent_id IN (${placeholders(canciones)}) AND borrada_at IS NULL GROUP BY parent_id`,
          canciones,
        )
      : { rows: [] },
  ]);
  const count = (result) => new Map(result.rows.map((row) => [row.id, Number(row.n)]));
  const songsOf = count(inSongs);
  const forksOf = count(pieceForks);
  const copiesOf = count(songForks);
  return {
    piezas: Object.fromEntries(
      piezas.map((id) => {
        const usedIn = songsOf.get(id) ?? 0;
        const forks = forksOf.get(id) ?? 0;
        return [id, { canciones: usedIn, forks, total: usedIn + forks }];
      }),
    ),
    canciones: Object.fromEntries(canciones.map((id) => [id, { forks: copiesOf.get(id) ?? 0, total: copiesOf.get(id) ?? 0 }])),
  };
}

/**
 * Where a piece is reused: the projects that use it and the pieces forked from it. Each list has the full count and
 * the entries `viewerId` may open (public ones and their own), newest first.
 */
export async function piezaUsage(id, viewerId = null) {
  const [songs, forks] = await Promise.all([
    db.query(
      `SELECT c.id, c.nombre, c.autor, c.publica, (c.publica OR c.usuario_id = $2) AS visible, MAX(c.updated_at) AS fecha
       FROM bloques b JOIN canciones c ON c.id = b.cancion_id
       WHERE b.pieza_id = $1 AND c.borrada_at IS NULL
       GROUP BY c.id ORDER BY fecha DESC, c.id`,
      [id, viewerId],
    ),
    db.query(
      `SELECT id, nombre, autor, publica, (publica OR usuario_id = $2) AS visible FROM piezas
       WHERE parent_id = $1 ORDER BY created_at DESC, id`,
      [id, viewerId],
    ),
  ]);
  const shown = (rows) =>
    rows
      .filter((row) => row.visible)
      .slice(0, LIST_LIMIT)
      .map(({ id: itemId, nombre, autor, publica }) => ({ id: itemId, nombre, autor, publica: publica !== false }));
  return {
    id,
    total: songs.rows.length + forks.rows.length,
    canciones: { total: songs.rows.length, lista: shown(songs.rows) },
    forks: { total: forks.rows.length, lista: shown(forks.rows) },
  };
}
