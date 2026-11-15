// Internal messages between artists, like email (cambios.md §14). Everything here needs an account.
import { Router } from 'express';
import { requireUsuario } from '../lib/auth.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { MENSAJES_DE, validateMensajeNuevo } from '../lib/validate.js';
import { canView, getCancion } from '../repo/canciones.js';
import {
  block,
  countSinLeer,
  createMensaje,
  getMensajesDe,
  listBloqueados,
  listConversaciones,
  listHilo,
  setMensajesDe,
  unblock,
  whyCannotWrite,
} from '../repo/conexiones.js';
import { findUsuarioByNombre } from '../repo/usuarios.js';

const router = Router();

async function otherUser(nombre) {
  const row = await findUsuarioByNombre(String(nombre ?? ''));
  if (!row) throw notFound(`User not found: ${nombre}`);
  return row;
}

// GET /mensajes  -> conversations, one per person, most recent first:
// [{ con, ultimo: { asunto, texto, fecha, mio }, sin_leer, bloqueado }]
router.get('/', async (req, res) => {
  res.json(await listConversaciones(requireUsuario(req).id));
});

// GET /mensajes/sin-leer  -> { sin_leer } (the badge next to Messages)
router.get('/sin-leer', async (req, res) => {
  res.json({ sin_leer: await countSinLeer(requireUsuario(req).id) });
});

// GET /mensajes/ajustes  -> { mensajes_de: "todos" | "contactos" | "nadie", bloqueados: [nombre] }
router.get('/ajustes', async (req, res) => {
  const usuario = requireUsuario(req);
  res.json({ mensajes_de: await getMensajesDe(usuario.id), bloqueados: await listBloqueados(usuario.id) });
});

// PUT /mensajes/ajustes  { mensajes_de }  -> same as GET
router.put('/ajustes', async (req, res) => {
  const usuario = requireUsuario(req);
  const value = req.body?.mensajes_de;
  if (!MENSAJES_DE.includes(value)) throw badRequest(`"mensajes_de" must be one of: ${MENSAJES_DE.join(', ')}`);
  await setMensajesDe(usuario.id, value);
  res.json({ mensajes_de: value, bloqueados: await listBloqueados(usuario.id) });
});

// PUT /mensajes/bloqueos/:nombre  -> 204: that account can no longer write to you (nor propose changes to you)
router.put('/bloqueos/:nombre', async (req, res) => {
  const usuario = requireUsuario(req);
  const other = await otherUser(req.params.nombre);
  if (other.id === usuario.id) throw badRequest('You cannot block yourself');
  await block(usuario.id, other.id);
  res.status(204).end();
});

// DELETE /mensajes/bloqueos/:nombre  -> 204
router.delete('/bloqueos/:nombre', async (req, res) => {
  const usuario = requireUsuario(req);
  await unblock(usuario.id, (await otherUser(req.params.nombre)).id);
  res.status(204).end();
});

// GET /mensajes/con/:nombre  -> { con, bloqueado, puedes_escribir, motivo, mensajes: [...] } oldest first;
// the messages you received in it are marked as read.
router.get('/con/:nombre', async (req, res) => {
  const usuario = requireUsuario(req);
  const other = await otherUser(req.params.nombre);
  const motivo = await whyCannotWrite(usuario.id, other);
  res.json({
    con: other.nombre,
    bloqueado: (await listBloqueados(usuario.id)).includes(other.nombre),
    puedes_escribir: !motivo,
    motivo,
    mensajes: await listHilo(usuario.id, other.id),
  });
});

// POST /mensajes  { para, asunto?, texto, cancion_id? }  -> 201 { id }
router.post('/', async (req, res) => {
  const usuario = requireUsuario(req);
  const { para, asunto, texto, cancion_id } = validateMensajeNuevo(req.body);
  const other = await otherUser(para);
  const motivo = await whyCannotWrite(usuario.id, other);
  if (motivo) throw new HttpError(403, motivo);
  // A project linked to the message must be one the sender can see (so nothing private leaks through a message).
  if (cancion_id && !(await canView(await getCancion(cancion_id), usuario))) throw badRequest(`Unknown project: ${cancion_id}`);
  res.status(201).json({ id: await createMensaje({ deId: usuario.id, paraId: other.id, asunto, texto, cancionId: cancion_id }) });
});

export default router;
