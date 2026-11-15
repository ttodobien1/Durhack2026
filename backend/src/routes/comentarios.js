// Comments on projects and pieces (cambios.md §14). Anyone can read the comments of what they can see; writing
// needs an account.
import { Router } from 'express';
import { requireUsuario } from '../lib/auth.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { validateComentario } from '../lib/validate.js';
import { canView, getCancion, rolEn } from '../repo/canciones.js';
import { createComentario, deleteComentario, getComentario, listComentarios } from '../repo/conexiones.js';
import { getPiezaOwner, getVisiblePieza } from '../repo/piezas.js';

const router = Router();
const OBJETIVOS = ['cancion', 'pieza'];

// The commented thing must exist and be visible to the requester (404 otherwise, like everywhere else).
async function checkObjetivo(objetivo, id, usuario) {
  if (!OBJETIVOS.includes(objetivo)) throw badRequest('"objetivo" must be "cancion" or "pieza"');
  if (typeof id !== 'string' || !id) throw badRequest('"id" is required');
  const visible = objetivo === 'cancion' ? await canView(await getCancion(id), usuario) : Boolean(await getVisiblePieza(id, usuario?.id ?? null));
  if (!visible) throw notFound(`${objetivo === 'cancion' ? 'Project' : 'Piece'} not found: ${id}`);
}

// GET /comentarios?objetivo=cancion|pieza&id=c-001  -> [{ id, autor, texto, fecha }] oldest first
router.get('/', async (req, res) => {
  const { objetivo, id } = req.query;
  await checkObjetivo(objetivo, id, req.usuario);
  res.json(await listComentarios(objetivo, id));
});

// POST /comentarios  { objetivo, id, texto }  -> 201 the comment
router.post('/', async (req, res) => {
  const usuario = requireUsuario(req);
  const { objetivo, id } = req.body ?? {};
  await checkObjetivo(objetivo, id, usuario);
  const texto = validateComentario(req.body);
  const created = await createComentario({ objetivo, objetivoId: id, usuarioId: usuario.id, texto });
  res.status(201).json({ ...created, autor: usuario.nombre, texto });
});

// DELETE /comentarios/:id  -> 204 (the comment's author, or the author of the project / piece it is on)
router.delete('/:id', async (req, res) => {
  const usuario = requireUsuario(req);
  const comentario = await getComentario(Number(req.params.id) || 0);
  if (!comentario) throw notFound(`Comment not found: ${req.params.id}`);
  const ownsTarget =
    comentario.objetivo === 'cancion'
      ? (await rolEn(comentario.objetivo_id, usuario)) === 'autor'
      : (await getPiezaOwner(comentario.objetivo_id))?.usuario_id === usuario.id;
  if (comentario.usuario_id !== usuario.id && !ownsTarget) throw new HttpError(403, 'Only its author can delete this comment');
  await deleteComentario(Number(req.params.id));
  res.status(204).end();
});

export default router;
