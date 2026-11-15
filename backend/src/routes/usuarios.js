import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { findUsuarioByNombre, publicUsuario } from '../repo/usuarios.js';

const router = Router();

// GET /usuarios/:nombre  -> public profile { nombre, perfil, creado } (never the email)
router.get('/:nombre', async (req, res) => {
  const row = await findUsuarioByNombre(req.params.nombre);
  if (!row) throw notFound(`User not found: ${req.params.nombre}`);
  res.json(publicUsuario(row));
});

export default router;
