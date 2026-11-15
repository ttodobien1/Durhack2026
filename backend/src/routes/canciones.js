import { Router } from 'express';
import { assertOwner, autorFor } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validateCancion, validateMensaje, validateResoluciones, validateVersionNumber } from '../lib/validate.js';
import { createCancion, getArbol, getCancion, getCancionOwner, getRelatedCanciones, listCanciones, saveCancion } from '../repo/canciones.js';
import {
  ensureVersions,
  getVersion,
  prepareMerge,
  recordVersion,
  songCredits,
  versionDiff,
  versionHistory,
} from '../repo/versiones.js';

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

async function visibleCancion(req, id = req.params.id) {
  const cancion = await getCancion(id);
  if (!visibleTo(cancion, req)) throw notFound(`Cancion not found: ${id}`);
  return cancion;
}

// The project a song was forked from, only if the requester can see it. When they cannot (it became private),
// the history is shown as if the song were an original, so nothing of the private project leaks.
async function withVisibleOrigin(req, cancion) {
  const parent = cancion.parent_id ? await getCancion(cancion.parent_id) : null;
  if (visibleTo(parent, req)) return { cancion, parent };
  return { cancion: { ...cancion, parent_id: null, parent_version: null }, parent: null };
}

// GET /canciones            public songs
// GET /canciones?autor=ana  ana's public songs, plus her private ones when ana is the one logged in
router.get('/', async (req, res) => {
  const autor = typeof req.query.autor === 'string' && req.query.autor.trim() ? req.query.autor.trim() : undefined;
  res.json(await listCanciones(autor, Boolean(autor) && autor === req.usuario?.nombre));
});

// POST /canciones   body: Cancion without id (+ optional "mensaje"; "parent_id" and "parent_version" when it is a
// copy of another project). Records v1.
router.post('/', async (req, res) => {
  const cancion = await readCancion(req);
  const mensaje = validateMensaje(req.body?.mensaje);
  let fork = null;
  if (cancion.parent_id) {
    const parent = await getCancion(cancion.parent_id);
    if (!visibleTo(parent, req)) throw badRequest(`Unknown parent_id: ${cancion.parent_id}`);
    const latest = await ensureVersions(parent.id);
    fork = { parent_id: parent.id, parent_version: Math.min(cancion.parent_version ?? latest, latest) };
  }
  const created = await createCancion(cancion, req.usuario?.id ?? null, fork);
  await recordVersion(created.id, { autor: cancion.autor, mensaje });
  res.status(201).json(await getCancion(created.id));
});

// GET /canciones/:id
router.get('/:id', async (req, res) => {
  res.json(await visibleCancion(req));
});

// PUT /canciones/:id   body: full Cancion (replaces name, tempo, visibility, tracks and blocks; the author and the
// fork origin stay) + optional "mensaje". Records a new version when the music changed.
// Songs owned by an account can only be edited by that account.
router.put('/:id', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Cancion not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'song');
  const cancion = validateCancion({ ...req.body, autor: owner.autor });
  const mensaje = validateMensaje(req.body?.mensaje);
  if (!cancion.publica && !owner.usuario_id) throw badRequest('Only songs owned by an account can be private');
  await ensureVersions(req.params.id); // songs from before versions existed keep their old state as v1
  await saveCancion(req.params.id, cancion);
  await recordVersion(req.params.id, { autor: req.usuario?.nombre ?? owner.autor, mensaje });
  res.json(await getCancion(req.params.id));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  await visibleCancion(req);
  res.json(await getArbol(req.params.id));
});

// --- History: versions, diff, forks, merge, credits (cambios.md §9) -------------------------------------

// GET /canciones/:id/versiones  -> { cancion, origen, versiones: [{ numero, autor, mensaje, fecha, merge, resumen, piezas }] }
router.get('/:id/versiones', async (req, res) => {
  const { cancion, parent } = await withVisibleOrigin(req, await visibleCancion(req));
  const versiones = await versionHistory(cancion);
  res.json({
    cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor, version: versiones[0]?.numero ?? 0 },
    // the project this one was forked from (null for originals, or when that project is private)
    origen: parent ? { id: parent.id, nombre: parent.nombre, autor: parent.autor, version: cancion.parent_version } : null,
    versiones,
  });
});

// GET /canciones/:id/versiones/:n  -> one version with its full snapshot (to open it in the editor)
router.get('/:id/versiones/:n', async (req, res) => {
  await visibleCancion(req);
  const numero = validateVersionNumber(req.params.n);
  await ensureVersions(req.params.id);
  const version = await getVersion(req.params.id, numero);
  if (!version) throw notFound(`Version not found: ${req.params.id} v${numero}`);
  res.json(version);
});

// GET /canciones/:id/versiones/:n/diff[?contra=m]  -> what version n changed (against m, or the version before it)
router.get('/:id/versiones/:n/diff', async (req, res) => {
  const { cancion } = await withVisibleOrigin(req, await visibleCancion(req));
  await ensureVersions(cancion.id);
  const contra = validateVersionNumber(req.query.contra, 'contra');
  res.json(await versionDiff(cancion, validateVersionNumber(req.params.n), contra ?? undefined));
});

// GET /canciones/:id/forks  -> { parent, forks }: the project it was forked from and the projects forked from it
router.get('/:id/forks', async (req, res) => {
  await visibleCancion(req);
  const { parent, forks } = await getRelatedCanciones(req.params.id);
  const visible = (c) => c.publica || c.autor === req.usuario?.nombre;
  res.json({ parent: parent && visible(parent) ? parent : null, forks: forks.filter(visible) });
});

// Merge preview: GET (your choices default to "mio") or POST { resoluciones }.
async function mergePreview(req) {
  const [cancion, otra] = await Promise.all([visibleCancion(req), visibleCancion(req, req.params.otra)]);
  return { cancion, otra, preview: await prepareMerge(cancion, otra, validateResoluciones(req.body?.resoluciones)) };
}
router.get('/:id/merge/:otra', async (req, res) => {
  res.json((await mergePreview(req)).preview);
});
router.post('/:id/merge/:otra/preview', async (req, res) => {
  res.json((await mergePreview(req)).preview);
});

// POST /canciones/:id/merge/:otra  body { resoluciones?, mensaje? }  -> { cancion, version }
// Merges song :otra into song :id (only the owner of :id). Always records a merge version.
router.post('/:id/merge/:otra', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Cancion not found: ${req.params.id}`);
  assertOwner(req, owner.usuario_id, 'song');
  const { cancion, otra, preview } = await mergePreview(req);
  const mensaje = validateMensaje(req.body?.mensaje) || `Merged ${otra.id} v${preview.suyo.version} by ${otra.autor}`;
  await saveCancion(cancion.id, { ...cancion, tempo: preview.resultado.tempo, pistas: preview.resultado.pistas });
  const version = await recordVersion(cancion.id, {
    autor: req.usuario?.nombre ?? cancion.autor,
    mensaje,
    mergeDe: otra.id,
    mergeVersion: preview.suyo.version,
    force: true,
  });
  res.json({ cancion: await getCancion(cancion.id), version });
});

// GET /canciones/:id/creditos  -> who made what: share of the notes per author, their pieces and versions
router.get('/:id/creditos', async (req, res) => {
  res.json(await songCredits(await visibleCancion(req)));
});

export default router;
