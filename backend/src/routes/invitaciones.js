// Invitation links to collaborate on a project (cambios.md §14). The author makes one in the project's Share
// window; whoever opens it while logged in becomes a collaborator, even of a private project.
import { Router } from 'express';
import { requireUsuario } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { getCancion, rolEn } from '../repo/canciones.js';
import { addColaborador, findInvitacion } from '../repo/conexiones.js';

const router = Router();

async function openInvitacion(token) {
  const invitacion = await findInvitacion(String(token));
  if (!invitacion) throw notFound('This invitation link does not work any more: ask for a new one');
  return { invitacion, cancion: await getCancion(invitacion.cancion_id) };
}

// GET /invitaciones/:token  -> { cancion: { id, nombre, autor, publica }, expira, rol } (rol: yours in it, if any)
router.get('/:token', async (req, res) => {
  const { invitacion, cancion } = await openInvitacion(req.params.token);
  res.json({
    cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor, publica: cancion.publica },
    expira: invitacion.expira,
    rol: await rolEn(cancion.id, req.usuario),
  });
});

// POST /invitaciones/:token/aceptar  -> { cancion_id, rol }: joins the project (nothing changes for its author)
router.post('/:token/aceptar', async (req, res) => {
  const usuario = requireUsuario(req);
  const { cancion } = await openInvitacion(req.params.token);
  if (!(await rolEn(cancion.id, usuario))) await addColaborador(cancion.id, usuario.id);
  res.json({ cancion_id: cancion.id, rol: await rolEn(cancion.id, usuario) });
});

export default router;
