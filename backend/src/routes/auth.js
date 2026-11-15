import { Router } from 'express';
import { requireUsuario } from '../lib/auth.js';
import { HttpError } from '../lib/errors.js';
import { dummyHash, hashPassword, verifyPassword } from '../lib/passwords.js';
import { validateLogin, validatePerfil, validateRegistro } from '../lib/validate.js';
import { addFavorito, listFavoritos, removeFavorito } from '../repo/favoritos.js';
import {
  createSession,
  createUsuario,
  deleteSession,
  findUsuarioByLogin,
  nombreOrEmailTaken,
  privateUsuario,
  updatePerfil,
} from '../repo/usuarios.js';

const router = Router();

// POST /auth/registro   { nombre, email, password } -> 201 { usuario, token }
router.post('/registro', async (req, res) => {
  const { nombre, email, password } = validateRegistro(req.body);
  const taken = await nombreOrEmailTaken(nombre, email);
  if (taken.nombre) throw new HttpError(409, `The username "${nombre}" is already taken`);
  if (taken.email) throw new HttpError(409, 'There is already an account with that email');

  let row;
  try {
    row = await createUsuario({ nombre, email, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (err?.code === '23505') throw new HttpError(409, 'That username or email is already taken');
    throw err;
  }
  res.status(201).json({ usuario: privateUsuario(row), token: await createSession(row.id) });
});

// POST /auth/login   { usuario: username or email, password } -> { usuario, token }
router.post('/login', async (req, res) => {
  const { usuario, password } = validateLogin(req.body);
  const row = await findUsuarioByLogin(usuario);
  // Same work whether or not the account exists, so the response time does not reveal it.
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
  if (!row || !ok) throw new HttpError(401, 'Wrong username/email or password');
  res.json({ usuario: privateUsuario(row), token: await createSession(row.id) });
});

// POST /auth/logout  (Bearer token) -> 204
router.post('/logout', async (req, res) => {
  if (req.usuario) await deleteSession(req.get('authorization').split(' ')[1]);
  res.status(204).end();
});

// GET /auth/yo  (Bearer token) -> { usuario }
router.get('/yo', async (req, res) => {
  res.json({ usuario: privateUsuario(requireUsuario(req)) });
});

// PUT /auth/yo  (Bearer token)  { perfil: {...} } -> { usuario }
router.put('/yo', async (req, res) => {
  const usuario = requireUsuario(req);
  const row = await updatePerfil(usuario.id, validatePerfil(req.body));
  res.json({ usuario: privateUsuario(row) });
});

// GET /auth/yo/favoritos  (Bearer token) -> ["p-017", ...]  most recently starred first
router.get('/yo/favoritos', async (req, res) => {
  res.json(await listFavoritos(requireUsuario(req).id));
});

// PUT /auth/yo/favoritos/:piezaId  (Bearer token) -> 204  stars a piece (idempotent)
router.put('/yo/favoritos/:piezaId', async (req, res) => {
  const usuario = requireUsuario(req);
  if (!(await addFavorito(usuario.id, req.params.piezaId))) throw new HttpError(404, `Piece ${req.params.piezaId} not found`);
  res.status(204).end();
});

// DELETE /auth/yo/favoritos/:piezaId  (Bearer token) -> 204  un-stars a piece (idempotent)
router.delete('/yo/favoritos/:piezaId', async (req, res) => {
  await removeFavorito(requireUsuario(req).id, req.params.piezaId);
  res.status(204).end();
});

export default router;
