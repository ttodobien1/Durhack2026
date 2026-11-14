import { Router } from 'express';
import { diffNotas } from '../lib/diff.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validateNewPieza, validatePiezaUpdate } from '../lib/validate.js';
import {
  createPieza,
  forkPieza,
  getPieza,
  isAncestor,
  searchPiezas,
  updatePieza,
} from '../repo/piezas.js';

const router = Router();

async function findPieza(id) {
  const pieza = await getPieza(id);
  if (!pieza) throw notFound(`Pieza not found: ${id}`);
  return pieza;
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

// GET /piezas?estilo=&tipo=&tonalidad=&q=&autor=
router.get('/', async (req, res) => {
  const { estilo, tipo, tonalidad, q, autor } = req.query;
  const piezas = await searchPiezas({
    estilo: firstValue(estilo),
    tipo: firstValue(tipo),
    tonalidad: firstValue(tonalidad),
    q: firstValue(q),
    autor: firstValue(autor),
  });
  res.json(piezas);
});

// POST /piezas  -> creates an original piece (id is generated)
router.post('/', async (req, res) => {
  const data = validateNewPieza(req.body);
  if (data.parent_id && !(await getPieza(data.parent_id))) {
    throw badRequest(`Unknown parent_id: ${data.parent_id}`);
  }
  res.status(201).json(await createPieza(data));
});

// GET /piezas/:id
router.get('/:id', async (req, res) => {
  res.json(await findPieza(req.params.id));
});

// POST /piezas/:id/fork   body (optional): { "autor": "...", "nombre": "..." }
router.post('/:id/fork', async (req, res) => {
  const original = await findPieza(req.params.id);
  const body = req.body ?? {};
  const autor = typeof body.autor === 'string' && body.autor.trim() ? body.autor.trim() : 'anonymous';
  const nombre = typeof body.nombre === 'string' && body.nombre.trim() ? body.nombre.trim() : undefined;
  res.status(201).json(await forkPieza(original, { autor, nombre }));
});

// PUT /piezas/:id   body: { "notas": [...] } (+ optional nombre, tonalidad, tempo, estilo, compases)
router.put('/:id', async (req, res) => {
  const changes = validatePiezaUpdate(req.body);
  const updated = await updatePieza(req.params.id, changes);
  if (!updated) throw notFound(`Pieza not found: ${req.params.id}`);
  res.json(updated);
});

// GET /piezas/:id/diff  -> diff of a fork against its parent
router.get('/:id/diff', async (req, res) => {
  const pieza = await findPieza(req.params.id);
  if (!pieza.parent_id) throw badRequest(`Pieza ${pieza.id} is an original (no parent_id); use /piezas/:id/diff/:otra`);
  const parent = await findPieza(pieza.parent_id);
  res.json({ original: parent.id, modificada: pieza.id, ...diffNotas(parent.notas, pieza.notas) });
});

// GET /piezas/:id/diff/:otra
// :id is the modified piece and :otra the one it is compared against. If one of them is an
// ancestor of the other, the ancestor is always treated as the original, whatever the order.
router.get('/:id/diff/:otra', async (req, res) => {
  let [modificada, original] = await Promise.all([findPieza(req.params.id), findPieza(req.params.otra)]);
  if (await isAncestor(modificada.id, original.id)) {
    [modificada, original] = [original, modificada];
  }
  res.json({ original: original.id, modificada: modificada.id, ...diffNotas(original.notas, modificada.notas) });
});

export default router;
