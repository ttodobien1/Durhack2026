import { Router } from 'express';
import { assertOwner, autorFor, requireUsuario } from '../lib/auth.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { validateCancion, validateMensaje, validateResoluciones, validateVersionNumber } from '../lib/validate.js';
import {
  createCancion,
  getArbol,
  getCancion,
  getCancionOwner,
  getCancionState,
  getRelatedCanciones,
  listCanciones,
  listPapelera,
  purgeCancion,
  purgeExpiredCanciones,
  restoreCancion,
  saveCancion,
  trashCancion,
} from '../repo/canciones.js';
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
  await purgeExpiredCanciones(); // the trash is emptied lazily (at most once an hour)
  const autor = typeof req.query.autor === 'string' && req.query.autor.trim() ? req.query.autor.trim() : undefined;
  res.json(await listCanciones(autor, Boolean(autor) && autor === req.usuario?.nombre));
});

// --- Trash: deleting a project (a song) moves it here; its author can restore it for 20 days, then it is gone -----

// Projects saved before accounts existed, or while signed out (autor "you"), have no owner account. My projects
// lists them as yours when they carry your username or "you" (frontend profile.js, authorsFor), so you can delete
// them too: trashing one makes it yours (trashCancion), so it shows in your trash and only you can restore it.
const SIGNED_OUT_AUTOR = 'you';
const isUnownedYours = (state, usuario) => !state.usuario_id && [usuario.nombre, SIGNED_OUT_AUTOR].includes(state.autor);

// A project the logged-in account may delete, in the trash (`trashed`) or not. Someone else's private project is a
// 404, like everywhere else.
async function ownSongState(req, trashed) {
  const usuario = requireUsuario(req);
  const state = await getCancionState(req.params.id);
  const mine = Boolean(state) && (state.usuario_id === usuario.id || isUnownedYours(state, usuario));
  if (!state || Boolean(state.borrada_at) !== trashed || (!mine && !state.publica)) {
    throw notFound(trashed ? `Project not in your trash: ${req.params.id}` : `Project not found: ${req.params.id}`);
  }
  if (!mine) throw new HttpError(403, `Only the author can delete this project (it is ${state.autor}'s)`);
  return state;
}

// GET /canciones/papelera  -> the logged-in account's deleted songs, newest first, each with `borrada` and `se_borra`
router.get('/papelera', async (req, res) => {
  const usuario = requireUsuario(req);
  await purgeExpiredCanciones({ force: true });
  res.json(await listPapelera(usuario.id));
});

// DELETE /canciones/papelera/:id  -> removes a song in the trash for good (cannot be undone)
router.delete('/papelera/:id', async (req, res) => {
  await ownSongState(req, true);
  await purgeCancion(req.params.id);
  res.status(204).end();
});

// POST /canciones/:id/restaurar  -> takes a song out of the trash and returns it
router.post('/:id/restaurar', async (req, res) => {
  await ownSongState(req, true);
  res.json(await restoreCancion(req.params.id));
});

// DELETE /canciones/:id  -> moves the project to the trash (its owner account, or its author if it has no owner)
router.delete('/:id', async (req, res) => {
  await ownSongState(req, false);
  await trashCancion(req.params.id, req.usuario);
  res.status(204).end();
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
  await saveCancion(req.params.id, cancion, req.usuario?.id ?? null);
  await recordVersion(req.params.id, { autor: req.usuario?.nombre ?? owner.autor, mensaje });
  res.json(await getCancion(req.params.id));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  await visibleCancion(req);
  res.json(await getArbol(req.params.id));
});

// --- History: versions, diff, forks, merge, credits (cambios.md §9) -------------------------------------

// GET /canciones/:id/versiones[?snapshots=1]  -> { cancion, origen, versiones: [{ numero, autor, mensaje, fecha, merge, resumen, piezas }] }
// With snapshots=1 each version (the newest 40) and the fork point of `origen` carry their full snapshot: the
// frontend draws the version tree from them.
router.get('/:id/versiones', async (req, res) => {
  const { cancion, parent } = await withVisibleOrigin(req, await visibleCancion(req));
  const snapshots = req.query.snapshots === '1' || req.query.snapshots === 'true';
  const versiones = await versionHistory(cancion, snapshots ? { snapshots, limit: 40 } : {});
  const forkPoint = parent && snapshots ? await getVersion(parent.id, cancion.parent_version) : null;
  res.json({
    cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor, version: versiones[0]?.numero ?? 0 },
    // the project this one was forked from (null for originals, or when that project is private)
    origen: parent
      ? { id: parent.id, nombre: parent.nombre, autor: parent.autor, version: cancion.parent_version, ...(forkPoint && { snapshot: forkPoint.snapshot, fecha: forkPoint.fecha }) }
      : null,
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
  await saveCancion(cancion.id, { ...cancion, tempo: preview.resultado.tempo, pistas: preview.resultado.pistas }, req.usuario?.id ?? null);
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
