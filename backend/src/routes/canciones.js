import { Router } from 'express';
import { assertOwner, autorFor } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { validateCancion } from '../lib/validate.js';
import { createCancion, getArbol, getCancion, getCancionOwner, listCanciones, saveCancion } from '../repo/canciones.js';

const router = Router();

// Validates a song body. Logged in, `autor` is always the account's username.
async function readCancion(req) {
  const cancion = validateCancion({ ...req.body, autor: req.usuario?.nombre ?? req.body?.autor });
  cancion.autor = await autorFor(req, cancion.autor);
  return cancion;
}

// GET /canciones
router.get('/', async (req, res) => {
  res.json(await listCanciones());
});

// POST /canciones   body: Cancion without id
router.post('/', async (req, res) => {
  const cancion = await readCancion(req);
  res.status(201).json(await createCancion(cancion, req.usuario?.id ?? null));
});

// GET /canciones/:id
router.get('/:id', async (req, res) => {
  const cancion = await getCancion(req.params.id);
  if (!cancion) throw notFound(`Cancion not found: ${req.params.id}`);
  res.json(cancion);
});

// PUT /canciones/:id   body: full Cancion (replaces name, tempo, tracks and blocks; the author stays)
// Songs owned by an account can only be edited by that account.
router.put('/:id', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Cancion not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'song');
  const cancion = validateCancion({ ...req.body, autor: owner.autor });
  res.json(await saveCancion(req.params.id, cancion));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  const arbol = await getArbol(req.params.id);
  if (!arbol) throw notFound(`Cancion not found: ${req.params.id}`);
  res.json(arbol);
});

export default router;
