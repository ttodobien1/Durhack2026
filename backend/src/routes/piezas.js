import { Router } from 'express';
import { assertOwner, autorFor } from '../lib/auth.js';
import { diffNotas } from '../lib/diff.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validateNewPieza, validatePiezaUpdate } from '../lib/validate.js';
import {
  createPieza,
  forkPieza,
  getPiezaOwner,
  getVisiblePieza,
  isAncestor,
  searchPiezas,
  updatePieza,
} from '../repo/piezas.js';

const router = Router();

// A private piece exists only for its author (404 for everyone else).
async function findPieza(req, id) {
  const pieza = await getVisiblePieza(id, req.usuario?.id ?? null);
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
    viewerId: req.usuario?.id ?? null,
  });
  res.json(piezas);
});

// POST /piezas  -> creates an original piece (id is generated). Logged in, the author is the account.
// "publica": false (the editor's new pieces) keeps it private until it is saved in a public project.
router.post('/', async (req, res) => {
  const data = validateNewPieza({ ...req.body, autor: req.usuario?.nombre ?? req.body?.autor });
  data.autor = await autorFor(req, data.autor);
  if (!data.publica && !req.usuario) throw badRequest('Log in to keep a piece private');
  if (data.parent_id && !(await getVisiblePieza(data.parent_id, req.usuario?.id ?? null))) {
    throw badRequest(`Unknown parent_id: ${data.parent_id}`);
  }
  res.status(201).json(await createPieza(data, req.usuario?.id ?? null));
});

// GET /piezas/:id
router.get('/:id', async (req, res) => {
  res.json(await findPieza(req, req.params.id));
});

// POST /piezas/:id/fork   body (optional): { "autor": "...", "nombre": "..." }
// Logged in, the fork belongs to the account and `autor` is its username.
router.post('/:id/fork', async (req, res) => {
  const original = await findPieza(req, req.params.id);
  const body = req.body ?? {};
  const autor = await autorFor(req, body.autor);
  const nombre = typeof body.nombre === 'string' && body.nombre.trim() ? body.nombre.trim() : undefined;
  res.status(201).json(await forkPieza(original, { autor, nombre, usuarioId: req.usuario?.id ?? null }));
});

// PUT /piezas/:id   body: { "notas": [...] } (+ optional nombre, tonalidad, tempo, estilo, compases)
// Pieces owned by an account can only be edited by that account.
router.put('/:id', async (req, res) => {
  const owner = await getPiezaOwner(req.params.id);
  if (!owner) throw notFound(`Pieza not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'piece');
  const changes = validatePiezaUpdate(req.body);
  res.json(await updatePieza(req.params.id, changes));
});

// GET /piezas/:id/diff  -> diff of a fork against its parent
router.get('/:id/diff', async (req, res) => {
  const pieza = await findPieza(req, req.params.id);
  if (!pieza.parent_id) throw badRequest(`Pieza ${pieza.id} is an original (no parent_id); use /piezas/:id/diff/:otra`);
  const parent = await findPieza(req, pieza.parent_id);
  res.json({ original: parent.id, modificada: pieza.id, ...diffNotas(parent.notas, pieza.notas) });
});

// GET /piezas/:id/diff/:otra
// :id is the modified piece and :otra the one it is compared against. If one of them is an
// ancestor of the other, the ancestor is always treated as the original, whatever the order.
router.get('/:id/diff/:otra', async (req, res) => {
  let [modificada, original] = await Promise.all([findPieza(req, req.params.id), findPieza(req, req.params.otra)]);
  if (await isAncestor(modificada.id, original.id)) {
    [modificada, original] = [original, modificada];
  }
  res.json({ original: original.id, modificada: modificada.id, ...diffNotas(original.notas, modificada.notas) });
});

export default router;
