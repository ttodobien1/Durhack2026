import { db } from '../db/client.js';

// Favourite pieces of an account (the star in the project Browser). Only pieces the account can still see are
// listed: public ones and its own. A piece its author makes private drops out of everyone else's favourites.

/** Ids of the account's favourite pieces, most recently starred first. */
export async function listFavoritos(usuarioId) {
  const result = await db.query(
    `SELECT f.pieza_id FROM favoritos f JOIN piezas p ON p.id = f.pieza_id
      WHERE f.usuario_id = $1 AND (p.publica OR p.usuario_id = $1)
      ORDER BY f.created_at DESC, f.pieza_id`,
    [usuarioId],
  );
  return result.rows.map((row) => row.pieza_id);
}

/** Stars a piece (no-op if already starred). Returns false when the piece does not exist or is hidden from the account. */
export async function addFavorito(usuarioId, piezaId) {
  const visible = await db.query('SELECT 1 FROM piezas WHERE id = $1 AND (publica OR usuario_id = $2)', [piezaId, usuarioId]);
  if (!visible.rows.length) return false;
  await db.query('INSERT INTO favoritos (usuario_id, pieza_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [usuarioId, piezaId]);
  return true;
}

/** Un-stars a piece (no-op if it was not starred). */
export async function removeFavorito(usuarioId, piezaId) {
  await db.query('DELETE FROM favoritos WHERE usuario_id = $1 AND pieza_id = $2', [usuarioId, piezaId]);
}
