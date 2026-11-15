import { Router } from 'express';
import { assertOwner, autorFor, requireUsuario } from '../lib/auth.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import {
  validateAjustes,
  validateCancion,
  validateMensaje,
  validatePropuesta,
  validateResoluciones,
  validateVersionNumber,
} from '../lib/validate.js';
import {
  canView,
  comunidad,
  createCancion,
  getArbol,
  getCancion,
  getCancionOwner,
  getCancionState,
  getRelatedCanciones,
  listCanciones,
  listCompartidas,
  listPapelera,
  purgeCancion,
  purgeExpiredCanciones,
  restoreCancion,
  rolEn,
  saveCancion,
  trashCancion,
  updateAjustes,
} from '../repo/canciones.js';
import {
  acceptPropuestasFrom,
  closePropuesta,
  createInvitacion,
  createMensaje,
  createPropuesta,
  deleteInvitacion,
  getInvitacion,
  getPropuesta,
  hasBlocked,
  listColaboradores,
  listPropuestas,
  openPropuestaFrom,
  removeColaborador,
  whyCannotWrite,
} from '../repo/conexiones.js';
import { privatePiezasAmong } from '../repo/piezas.js';
import { findUsuarioByNombre } from '../repo/usuarios.js';
import {
  ensureVersions,
  getVersion,
  prepareMerge,
  recordVersion,
  songCredits,
  versionDiff,
  versionHistory,
} from '../repo/versiones.js';

import { logEvent, songPlaysToday } from '../repo/eventos.js';
import { assertSongHasNoNearCopies } from '../repo/similares.js';

const router = Router();

// Validates a song body. Logged in, `autor` is always the account's username.
async function readCancion(req) {
  const cancion = validateCancion({ ...req.body, autor: req.usuario?.nombre ?? req.body?.autor });
  cancion.autor = await autorFor(req, cancion.autor);
  if (!cancion.publica && !req.usuario) throw badRequest('Log in to make a song private');
  return cancion;
}

// A private song exists only for its author, its collaborators and whoever reviews a proposal made from it
// (404 for everyone else, like a private GitHub repo). See repo/canciones.js, canView.
async function visibleCancion(req, id = req.params.id) {
  const cancion = await getCancion(id);
  if (!(await canView(cancion, req.usuario))) throw notFound(`Project not found: ${id}`);
  return cancion;
}

// The project, if the logged-in account has one of `roles` in it ('autor', 'colaborador'): { cancion, usuario, rol }.
async function withRol(req, roles) {
  const usuario = requireUsuario(req);
  const cancion = await visibleCancion(req);
  const rol = await rolEn(cancion.id, usuario);
  if (!roles.includes(rol)) {
    throw new HttpError(403, roles.includes('colaborador') ? 'Only the author and the collaborators of this project can do this' : 'Only the author of this project can do this');
  }
  return { cancion, usuario, rol };
}

const pieceIdsOf = (cancion) => cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id));

// The project a song was forked from, only if the requester can see it. When they cannot (it became private),
// the history is shown as if the song were an original, so nothing of the private project leaks.
async function withVisibleOrigin(req, cancion) {
  const parent = cancion.parent_id ? await getCancion(cancion.parent_id) : null;
  if (await canView(parent, req.usuario)) return { cancion, parent };
  return { cancion: { ...cancion, parent_id: null, parent_version: null }, parent: null };
}

// GET /canciones            public songs
// GET /canciones?autor=ana  ana's public songs, plus her private ones when ana is the one logged in
router.get('/', async (req, res) => {
  await purgeExpiredCanciones(); // the trash is emptied lazily (at most once an hour)
  const autor = typeof req.query.autor === 'string' && req.query.autor.trim() ? req.query.autor.trim() : undefined;
  res.json(await listCanciones(autor, Boolean(autor) && autor === req.usuario?.nombre));
});

// GET /canciones/comunidad  -> { populares, ayuda }: the most popular public projects and the open help requests
router.get('/comunidad', async (req, res) => {
  res.json(await comunidad());
});

// GET /canciones/compartidas  -> the projects the logged-in account collaborates on (private ones included)
router.get('/compartidas', async (req, res) => {
  res.json(await listCompartidas(requireUsuario(req).id));
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
  const seen = mine || state?.publica || (state && (await rolEn(req.params.id, usuario)) === 'colaborador');
  if (!state || Boolean(state.borrada_at) !== trashed || !seen) {
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
// copy of another project, which its author must allow: permite_fork). Records v1.
router.post('/', async (req, res) => {
  const cancion = await readCancion(req);
  const mensaje = validateMensaje(req.body?.mensaje);
  let fork = null;
  if (cancion.parent_id) {
    const parent = await getCancion(cancion.parent_id);
    if (!(await canView(parent, req.usuario))) throw badRequest(`Unknown parent_id: ${cancion.parent_id}`);
    if (!parent.permite_fork && !(await rolEn(parent.id, req.usuario))) {
      throw new HttpError(403, `${parent.autor} does not allow copies of this project${parent.permite_propuestas ? '. You can propose your changes instead' : ''}`);
    }
    const latest = await ensureVersions(parent.id);
    fork = { parent_id: parent.id, parent_version: Math.min(cancion.parent_version ?? latest, latest) };
  }
  await assertSongHasNoNearCopies(cancion.pistas); // 409 while a melody block nearly copies someone else's
  const created = await createCancion(cancion, req.usuario?.id ?? null, fork);
  await recordVersion(created.id, { autor: cancion.autor, mensaje });
  await logEvent({ tipo: 'guardado', cancion_id: created.id, autor: cancion.autor });
  res.status(201).json(await getCancion(created.id));
});

// GET /canciones/:id  (+ "rol": what the requester is in it: "autor", "colaborador" or null)
router.get('/:id', async (req, res) => {
  const cancion = await visibleCancion(req);
  res.json({ ...cancion, rol: await rolEn(cancion.id, req.usuario) });
});

// PUT /canciones/:id   body: full Cancion (replaces name, tempo, visibility, tracks and blocks; the author and the
// fork origin stay) + optional "mensaje". Records a new version when the music changed.
// Songs owned by an account can only be edited by that account and its collaborators; collaborators change the
// music and the name, never the visibility nor the description.
router.put('/:id', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Project not found: ${req.params.id}`);
  const rol = await rolEn(req.params.id, req.usuario);
  if (rol !== 'colaborador') assertOwner(req, owner.usuario_id, 'song');
  const cancion = validateCancion({ ...req.body, autor: owner.autor });
  if (rol === 'colaborador') {
    const current = await getCancion(req.params.id);
    cancion.publica = current.publica;
    cancion.descripcion = null; // keeps the stored one
  }
  const mensaje = validateMensaje(req.body?.mensaje);
  if (!cancion.publica && !owner.usuario_id) throw badRequest('Only songs owned by an account can be private');
  await assertSongHasNoNearCopies(cancion.pistas); // 409 while a melody block nearly copies someone else's
  await ensureVersions(req.params.id); // songs from before versions existed keep their old state as v1
  await saveCancion(req.params.id, cancion, req.usuario?.id ?? null);
  await recordVersion(req.params.id, { autor: req.usuario?.nombre ?? owner.autor, mensaje });
  await logEvent({ tipo: 'guardado', cancion_id: req.params.id, autor: req.usuario?.nombre ?? owner.autor });
  res.json(await getCancion(req.params.id));
});

// PATCH /canciones/:id/ajustes  { permite_fork?, permite_propuestas?, pide_ayuda? }  (author only) -> Cancion
// pide_ayuda: the help request shown on the home page ("how can I move forward with this song?"); null removes it.
router.patch('/:id/ajustes', async (req, res) => {
  const { cancion } = await withRol(req, ['autor']);
  res.json(await updateAjustes(cancion.id, validateAjustes(req.body)));
});

// GET /canciones/:id/arbol  -> { nodos, aristas } (+ cancion, resumen)
router.get('/:id/arbol', async (req, res) => {
  await visibleCancion(req);
  res.json(await getArbol(req.params.id));
});

// --- Collaborators and invitation links (cambios.md §14) -------------------------------------------------------

// GET /canciones/:id/colaboradores  -> { autor, colaboradores: [{ nombre, desde }], invitacion (author only) }
router.get('/:id/colaboradores', async (req, res) => {
  const cancion = await visibleCancion(req);
  const rol = await rolEn(cancion.id, req.usuario);
  res.json({
    autor: cancion.autor,
    rol,
    colaboradores: await listColaboradores(cancion.id),
    invitacion: rol === 'autor' ? await getInvitacion(cancion.id) : null,
  });
});

// POST /canciones/:id/invitacion  (author only) -> { token, expira }: a new link; the previous one stops working
router.post('/:id/invitacion', async (req, res) => {
  const { cancion, usuario } = await withRol(req, ['autor']);
  res.status(201).json(await createInvitacion(cancion.id, usuario.id));
});

// DELETE /canciones/:id/invitacion  (author only) -> 204: the link stops working
router.delete('/:id/invitacion', async (req, res) => {
  const { cancion } = await withRol(req, ['autor']);
  await deleteInvitacion(cancion.id);
  res.status(204).end();
});

// DELETE /canciones/:id/colaboradores/:nombre  -> 204: the author removes a collaborator, or a collaborator leaves
router.delete('/:id/colaboradores/:nombre', async (req, res) => {
  const { cancion, usuario, rol } = await withRol(req, ['autor', 'colaborador']);
  const target = await findUsuarioByNombre(req.params.nombre);
  if (!target) throw notFound(`User not found: ${req.params.nombre}`);
  if (rol !== 'autor' && target.id !== usuario.id) throw new HttpError(403, 'Only the author can remove other collaborators');
  if (!(await removeColaborador(cancion.id, target.id))) throw notFound(`${target.nombre} is not a collaborator of this project`);
  res.status(204).end();
});

// --- Proposed changes, like pull requests (cambios.md §14) ---------------------------------------------------

// GET /canciones/:id/propuestas  -> [{ id, desde: { id, nombre, version }, autor, titulo, mensaje, estado, fecha }]
router.get('/:id/propuestas', async (req, res) => {
  const cancion = await visibleCancion(req);
  res.json(await listPropuestas(cancion.id));
});

// POST /canciones/:id/propuestas  { titulo, mensaje?, desde_id? | cancion? } -> 201 { propuesta, copia }
// Offers changes to a project its author lets people propose to (permite_propuestas). The changes travel in a copy:
// `desde_id`, your own fork of the project, or `cancion` (the edited project), saved as a new private copy only you
// and the project's people see. Its pieces must be public, so they can hear it. The author gets a message.
router.post('/:id/propuestas', async (req, res) => {
  const usuario = requireUsuario(req);
  const target = await visibleCancion(req);
  if (await rolEn(target.id, usuario)) throw badRequest('You can edit this project directly: there is no need to propose changes');
  if (!target.permite_propuestas) throw new HttpError(403, `${target.autor} does not take proposed changes on this project`);
  const owner = await getCancionOwner(target.id);
  if (owner.usuario_id && (await hasBlocked(owner.usuario_id, usuario.id))) throw new HttpError(403, `${target.autor} is not taking proposals from you`);
  const { titulo, mensaje } = validatePropuesta(req.body);

  let desde = null;
  let nueva = null;
  if (req.body.desde_id) {
    desde = await getCancion(String(req.body.desde_id));
    if (!desde || (await rolEn(desde.id, usuario)) !== 'autor' || desde.parent_id !== target.id) {
      throw badRequest('desde_id must be your own copy (fork) of this project');
    }
    if (await openPropuestaFrom(target.id, desde.id)) throw new HttpError(409, 'That copy already has an open proposal: it updates by itself when you save the copy');
  } else {
    if (!req.body.cancion || typeof req.body.cancion !== 'object') throw badRequest('Send "desde_id" (your copy) or "cancion" (the edited project)');
    nueva = validateCancion({ ...req.body.cancion, nombre: req.body.cancion.nombre || `${target.nombre} (proposal)`, autor: usuario.nombre, publica: false });
  }
  const hidden = await privatePiezasAmong(pieceIdsOf(desde ?? nueva));
  if (hidden.length) {
    throw badRequest(`Make these pieces public first, so ${target.autor} can hear them: ${hidden.map((p) => `${p.nombre} (${p.id})`).join(', ')}`);
  }
  await assertSongHasNoNearCopies((desde ?? nueva).pistas); // a proposal cannot carry a near-copy either
  if (nueva) {
    const latest = await ensureVersions(target.id);
    const created = await createCancion(nueva, usuario.id, { parent_id: target.id, parent_version: Math.min(nueva.parent_version ?? latest, latest) });
    await updateAjustes(created.id, { permite_fork: false, permite_propuestas: false });
    await recordVersion(created.id, { autor: usuario.nombre, mensaje: titulo });
    desde = created;
  }
  const propuesta = await createPropuesta({ cancionId: target.id, desdeId: desde.id, usuarioId: usuario.id, titulo, mensaje });
  // Let the author know, unless they do not take messages from this account.
  if (owner.usuario_id && !(await whyCannotWrite(usuario.id, { id: owner.usuario_id, nombre: target.autor }))) {
    await createMensaje({
      deId: usuario.id,
      paraId: owner.usuario_id,
      asunto: `Proposed changes: ${titulo}`,
      texto: `${mensaje ? `${mensaje}\n\n` : ''}I proposed changes to ${target.nombre}. Review them in the project's History window, Proposals tab.`,
      cancionId: target.id,
    });
  }
  const { usuario_id: _hidden, ...publicPropuesta } = propuesta;
  res.status(201).json({ propuesta: publicPropuesta, copia: await getCancion(desde.id) });
});

// PATCH /canciones/:id/propuestas/:pid  { estado: "rechazada" | "retirada" } -> the proposal
// The project's author and collaborators decline it; its author withdraws it. Accepting is merging it
// (POST /canciones/:id/merge/:copia), which closes it as "aceptada".
router.patch('/:id/propuestas/:pid', async (req, res) => {
  const usuario = requireUsuario(req);
  const cancion = await visibleCancion(req);
  const propuesta = await getPropuesta(Number(req.params.pid));
  if (!propuesta || propuesta.cancion_id !== cancion.id) throw notFound(`Proposal not found: ${req.params.pid}`);
  const estado = req.body?.estado;
  if (estado !== 'rechazada' && estado !== 'retirada') throw badRequest('"estado" must be "rechazada" or "retirada"');
  if (propuesta.estado !== 'abierta') throw new HttpError(409, `This proposal is already ${propuesta.estado}`);
  if (estado === 'retirada' && propuesta.usuario_id !== usuario.id) throw new HttpError(403, 'Only its author can withdraw a proposal');
  if (estado === 'rechazada' && !(await rolEn(cancion.id, usuario))) throw new HttpError(403, 'Only the author and the collaborators of this project can decline a proposal');
  const { usuario_id: _hidden, ...closed } = await closePropuesta(propuesta.id, estado);
  res.json(closed);
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
  const visible = await Promise.all(forks.map((f) => canView(f, req.usuario)));
  res.json({ parent: parent && (await canView(parent, req.usuario)) ? parent : null, forks: forks.filter((_, i) => visible[i]) });
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
// Merges song :otra into song :id (its owner or a collaborator). Always records a merge version, and closes the
// open proposals made from :otra as accepted.
router.post('/:id/merge/:otra', async (req, res) => {
  const owner = await getCancionOwner(req.params.id);
  if (!owner) throw notFound(`Project not found: ${req.params.id}`);
  if ((await rolEn(req.params.id, req.usuario)) !== 'colaborador') assertOwner(req, owner.usuario_id, 'song');
  const { cancion, otra, preview } = await mergePreview(req);
  await assertSongHasNoNearCopies(preview.resultado.pistas);
  const mensaje = validateMensaje(req.body?.mensaje) || `Merged ${otra.id} v${preview.suyo.version} by ${otra.autor}`;
  await saveCancion(cancion.id, { ...cancion, descripcion: null, tempo: preview.resultado.tempo, pistas: preview.resultado.pistas }, req.usuario?.id ?? null);
  const version = await recordVersion(cancion.id, {
    autor: req.usuario?.nombre ?? cancion.autor,
    mensaje,
    mergeDe: otra.id,
    mergeVersion: preview.suyo.version,
    force: true,
  });
  await acceptPropuestasFrom(cancion.id, otra.id);
  res.json({ cancion: await getCancion(cancion.id), version });
});

// GET /canciones/:id/creditos  -> who made what: share of the notes per author, their pieces and versions
router.get('/:id/creditos', async (req, res) => {
  const cancion = await visibleCancion(req);
  const [credits, plays] = await Promise.all([songCredits(cancion), songPlaysToday(cancion.id)]);
  // Credits ledger: each play plays every note once, so an author's notes played today = their notes × today's plays.
  res.json({
    ...credits,
    reproducciones_hoy: plays,
    autores: credits.autores.map((a) => ({ ...a, notas_reproducidas_hoy: (a.notas ?? 0) * plays })),
  });
});

export default router;
