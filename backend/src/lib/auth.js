// Authentication helpers. The client sends `Authorization: Bearer <token>` (from /auth/login or /auth/registro).
import { HttpError } from './errors.js';
import { findSessionUsuario, findUsuarioByNombre } from '../repo/usuarios.js';

// Middleware: sets req.usuario (DB row) when a valid token is sent, null when no token is sent.
// A token that is wrong or expired is a 401, so the client knows to log in again.
export async function authenticate(req, res, next) {
  req.usuario = null;
  const header = req.get('authorization');
  if (!header) return next();
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Malformed Authorization header (use "Bearer <token>")');
  req.usuario = await findSessionUsuario(token);
  if (!req.usuario) throw new HttpError(401, 'Session expired or invalid: log in again');
  next();
}

export function requireUsuario(req) {
  if (!req.usuario) throw new HttpError(401, 'Log in to do this');
  return req.usuario;
}

// Author name for something being published:
//   - logged in: always the account's username (cannot publish as someone else);
//   - anonymous: the name sent by the client ("anonymous" if none), unless it belongs to an account.
export async function autorFor(req, requested) {
  if (req.usuario) return req.usuario.nombre;
  const nombre = typeof requested === 'string' && requested.trim() ? requested.trim() : 'anonymous';
  if (await findUsuarioByNombre(nombre)) {
    throw new HttpError(401, `"${nombre}" is a registered user: log in to publish as them`);
  }
  return nombre;
}

// Only the owner can change something that belongs to an account. Unowned rows (seed data and anonymous
// work, usuario_id NULL) stay editable by anyone, as before accounts existed.
export function assertOwner(req, ownerId, what) {
  if (!ownerId) return;
  if (!req.usuario) throw new HttpError(401, `Log in to edit this ${what}`);
  if (req.usuario.id !== ownerId) throw new HttpError(403, `Only the author can edit this ${what}; fork it instead`);
}
