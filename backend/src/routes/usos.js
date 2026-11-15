// Reuse counters (popularity): how many times pieces and projects were reused, and where.
// Mounted at the root so it can answer under both /piezas and /usos without touching their routers.
import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { getVisiblePieza } from '../repo/piezas.js';
import { piezaUsage, usageCounts } from '../repo/usos.js';

const router = Router();
const MAX_IDS = 200;

function idList(value, name) {
  const text = Array.isArray(value) ? value.join(',') : (value ?? '');
  const ids = String(text)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > MAX_IDS) throw badRequest(`"${name}" accepts at most ${MAX_IDS} ids`);
  return ids;
}

// GET /usos?piezas=p-017,p-022&canciones=c-001
// -> { "piezas": { "p-017": { "canciones": 3, "forks": 1, "total": 4 } }, "canciones": { "c-001": { "forks": 2, "total": 2 } } }
router.get('/usos', async (req, res) => {
  res.json(await usageCounts({ piezaIds: idList(req.query.piezas, 'piezas'), cancionIds: idList(req.query.canciones, 'canciones') }));
});

// GET /piezas/:id/usos -> { id, total, canciones: { total, lista: [{ id, nombre, autor, publica }] }, forks: { total, lista } }
// The lists name only what the viewer may open; the totals count everything.
router.get('/piezas/:id/usos', async (req, res) => {
  const viewerId = req.usuario?.id ?? null;
  if (!(await getVisiblePieza(req.params.id, viewerId))) throw notFound(`Pieza not found: ${req.params.id}`);
  res.json(await piezaUsage(req.params.id, viewerId));
});

export default router;
