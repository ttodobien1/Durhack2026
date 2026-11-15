import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { getCancion } from '../repo/canciones.js';
import { existingPiezaIds } from '../repo/piezas.js';
import { logPlay } from '../repo/eventos.js';

const router = Router();
const MAX_PIEZAS = 50;

// POST /eventos/reproduccion   { cancion_id } or { pieza_ids: [...] } (at most 50) -> 204
// The frontend calls it once each time playback starts. Stores the time and what was played: no IP, no user agent,
// no account. A song play also counts for every piece in it (for "Trending now").
router.post('/reproduccion', async (req, res) => {
  const body = req.body ?? {};
  const viewer = req.usuario?.id ?? null;
  if (typeof body.cancion_id === 'string' && body.cancion_id) {
    const cancion = await getCancion(body.cancion_id);
    if (!cancion) throw notFound(`Cancion not found: ${body.cancion_id}`);
    const ids = [...new Set(cancion.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))].slice(0, MAX_PIEZAS);
    await logPlay({ cancion_id: cancion.id, pieza_ids: ids });
    return res.status(204).end();
  }
  const ids = body.pieza_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_PIEZAS || !ids.every((id) => typeof id === 'string' && id.length <= 40)) {
    throw badRequest(`Send { "cancion_id" } or { "pieza_ids": [...] } with 1-${MAX_PIEZAS} ids`);
  }
  const found = await existingPiezaIds(ids, viewer);
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw notFound(`Unknown pieza_id: ${missing.join(', ')}`);
  await logPlay({ pieza_ids: ids });
  res.status(204).end();
});

export default router;
