import { Router } from 'express';
import { assertOwner, autorFor } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validateCancion } from '../lib/validate.js';
import { createCancion, getArbol, getCancion, getCancionOwner, listCanciones, saveCancion } from '../repo/canciones.js';

const router = Router();

// Validates a song body. Logged in, `autor` is always the account's username.
async function readCancion(req) {
  const cancion = validateCancion({ ...req.body, autor: req.usuario?.nombre ?? req.body?.autor });
  cancion.autor = await autorFor(req, cancion.autor);
  if (!cancion.publica && !req.usuario) throw badRequest('Log in to make a song private');
  return cancion;
}

// A private song exists only for its author's account (404 for everyone else, like a private GitHub repo).
const visibleTo = (cancion, req) => Boolean(cancion) && (cancion.publica || cancion.autor === req.usuario?.nombre);

// GET /canciones            public songs
// GET /canciones?autor=ana  ana's public songs, plus her private ones when ana is the one logged in
router.get('/', async (req, res) => {
  const autor = typeof req.query.autor === 'string' && req.query.autor.trim() ? req.query.autor.trim() : undefined;
  res.json(await listCanciones(autor, Boolean(autor) && autor === req.usuario?.nombre));
});

// POST /canciones   body: Cancion without id
router.post('/', async (req, res) => {
  const cancion = await readCancion(req);
  res.status(201).json(await createCancion(cancion, req.usuario?.id ?? null));
});

// GET /canciones/:id
router.get('/:id', async (req, res) => {
  const cancion = await getCancion(req.params.id);
  if (!visibleTo(cancion, req)) throw notFound(`Cancion not found: ${req.params.id}`);
  res.json(cancion);
});

// PUT /canciones/:id   body: full Cancion (replaces name, tempo, visibility, tracks and blocks; the author stays)
// Songs owned by an account can only be edited by that account.
router.put('/:id', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Cancion not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'song');
  const cancion = validateCancion({ ...req.body, autor: owner.autor });
  if (!cancion.publica && !owner.usuario_id) throw badRequest('Only songs owned by an account can be private');
  res.json(await saveCancion(req.params.id, cancion));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  if (!visibleTo(await getCancion(req.params.id), req)) throw notFound(`Cancion not found: ${req.params.id}`);
  const arbol = await getArbol(req.params.id);
  res.json(arbol);
});

export default router;
