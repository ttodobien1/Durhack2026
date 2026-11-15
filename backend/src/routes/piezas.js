import { Router } from 'express';
import { assertOwner, autorFor } from '../lib/auth.js';
import { diffNotas } from '../lib/diff.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { validateNewPieza, validateNotas, validatePiezaUpdate, validateTipo } from '../lib/validate.js';
import {
  createPieza,
  forkPieza,
  getPieza,
  getPiezaOwner,
  getPiezasWithAncestors,
  getVisiblePieza,
  isAncestor,
  searchPiezas,
  setPiezaPublica,
  updatePieza,
  visibilityBlocker,
} from '../repo/piezas.js';
import { blame, blameSummary } from '../lib/credits.js';
import { diffFacts } from '../lib/diffFacts.js';
import { explainDiff } from '../copilot/explain.js';
import { forgetFingerprints, mapOf, nearCopyOf, similarTo } from '../repo/similares.js';

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
  forgetFingerprints();
  res.status(201).json(await createPieza(data, req.usuario?.id ?? null));
});

// GET /piezas/mapa?tipo=ritmo  -> { tipo, total, ejes: [{ varianza, menos, mas }], puntos: [{ id, nombre, autor, x, y, z, ... }] }
// The public pieces of one type on a 3D map of their musical fingerprints (PCA): close dots sound alike, in any key.
router.get('/mapa', async (req, res) => {
  res.json(await mapOf(validateTipo(firstValue(req.query.tipo) ?? 'ritmo')));
});

// POST /piezas/parecidas   { tipo, notas, id?, parent_id?, autor? } -> { parecidas, aviso }
// Checks notes before (or after) they are published: the public pieces that sound most like them, and `aviso` when
// one by someone else, outside this piece's fork family, is a near-copy (transposed, inverted or shifted counts too).
router.post('/parecidas', async (req, res) => {
  const body = req.body ?? {};
  const pieza = { tipo: validateTipo(body.tipo), notas: validateNotas(body.notas ?? []), id: body.id ?? null, parent_id: body.parent_id ?? null };
  const autor = req.usuario?.nombre ?? (typeof body.autor === 'string' ? body.autor : null);
  res.json({ parecidas: await similarTo(pieza, { n: 5 }), aviso: await nearCopyOf(pieza, autor) });
});

// GET /piezas/:id/blame  -> { autores: [{ autor, notas, porcentaje }], notas: [{ ...nota, autor }] }
// "git blame" for one piece: whose each note is, walking the fork chain (lib/credits.js). Same privacy as GET /piezas/:id.
router.get('/:id/blame', async (req, res) => {
  const pieza = await findPieza(req, req.params.id);
  const chain = new Map((await getPiezasWithAncestors([pieza.id])).map((p) => [p.id, p]));
  chain.set(pieza.id, pieza);
  res.json(blameSummary(pieza, blame(pieza.id, chain)));
});

// GET /piezas/:id/parecidas?n=8  -> public pieces of the same type that sound most like this one, with similitud 0-100
router.get('/:id/parecidas', async (req, res) => {
  const pieza = await findPieza(req, req.params.id);
  const n = Math.min(20, Math.max(1, Number.parseInt(req.query.n, 10) || 8));
  res.json(await similarTo(pieza, { n }));
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
  forgetFingerprints();
  res.status(201).json(await forkPieza(original, { autor, nombre, usuarioId: req.usuario?.id ?? null }));
});

// PUT /piezas/:id   body: { "notas": [...] } (+ optional nombre, tonalidad, tempo, estilo, compases)
// Pieces owned by an account can only be edited by that account.
// "publica" (true/false) is the author's choice of who may see and use the piece; switching is refused with a 409
// and the reason when it would break someone's work (repo/piezas.js, visibilityBlocker).
router.put('/:id', async (req, res) => {
  const owner = await getPiezaOwner(req.params.id);
  if (!owner) throw notFound(`Pieza not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'piece');
  const { publica, ...changes } = validatePiezaUpdate(req.body);
  if (publica !== undefined) {
    const current = await getPieza(req.params.id);
    if (current.publica !== publica) {
      const blocker = await visibilityBlocker(req.params.id, publica);
      if (blocker) throw new HttpError(409, `Cannot make this piece ${publica ? 'public' : 'private'}: ${blocker}`);
      await setPiezaPublica(req.params.id, publica);
    }
  }
  forgetFingerprints();
  res.json(Object.keys(changes).length ? await updatePieza(req.params.id, changes) : await getPieza(req.params.id));
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
async function diffPair(req) {
  let [modificada, original] = await Promise.all([findPieza(req, req.params.id), findPieza(req, req.params.otra)]);
  if (await isAncestor(modificada.id, original.id)) {
    [modificada, original] = [original, modificada];
  }
  return { original, modificada, diff: diffNotas(original.notas, modificada.notas) };
}

router.get('/:id/diff/:otra', async (req, res) => {
  const { original, modificada, diff } = await diffPair(req);
  res.json({ original: original.id, modificada: modificada.id, ...diff });
});

// GET /piezas/:id/diff/:otra/explicacion  -> { texto, hechos, fuente: "modelo" | "plantilla" }
// DJ Stemy explains the diff in musical terms (copilot/explain.js). It only describes; it never suggests notes.
router.get('/:id/diff/:otra/explicacion', async (req, res) => {
  const { original, modificada, diff } = await diffPair(req);
  const hechos = diffFacts(diff, original, modificada);
  res.json({ ...(await explainDiff(hechos)), hechos });
});

export default router;
