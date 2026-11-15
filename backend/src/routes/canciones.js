import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { validateCancion } from '../lib/validate.js';
import { cancionExists, createCancion, getArbol, getCancion, listCanciones, saveCancion } from '../repo/canciones.js';

const router = Router();

// GET /canciones            public songs
// GET /canciones?autor=ana  every song by ana, private ones included (no accounts: private means unlisted)
router.get('/', async (req, res) => {
  const autor = typeof req.query.autor === 'string' && req.query.autor.trim() ? req.query.autor.trim() : undefined;
  res.json(await listCanciones(autor));
});

// POST /canciones   body: Cancion without id
router.post('/', async (req, res) => {
  const cancion = validateCancion(req.body);
  res.status(201).json(await createCancion(cancion));
});

// GET /canciones/:id
router.get('/:id', async (req, res) => {
  const cancion = await getCancion(req.params.id);
  if (!cancion) throw notFound(`Cancion not found: ${req.params.id}`);
  res.json(cancion);
});

// PUT /canciones/:id   body: full Cancion (replaces name, tempo, tracks and blocks)
router.put('/:id', async (req, res) => {
  if (!(await cancionExists(req.params.id))) throw notFound(`Cancion not found: ${req.params.id}`);
  const cancion = validateCancion(req.body);
  res.json(await saveCancion(req.params.id, cancion));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  const arbol = await getArbol(req.params.id);
  if (!arbol) throw notFound(`Cancion not found: ${req.params.id}`);
  res.json(arbol);
});

export default router;
