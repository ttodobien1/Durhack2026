// Accounts and login sessions.
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/client.js';

const SESSION_DAYS = 30;
const COLUMNS = 'id, nombre, email, password_hash, perfil, created_at';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const fromJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

// Public view of an account (what anyone can see on a profile page).
export function publicUsuario(row) {
  return { nombre: row.nombre, perfil: fromJson(row.perfil) ?? {}, creado: row.created_at };
}

// View for the account owner (adds id and email).
export function privateUsuario(row) {
  return { id: row.id, ...publicUsuario(row), email: row.email };
}

export async function findUsuarioByNombre(nombre) {
  const result = await db.query(`SELECT ${COLUMNS} FROM usuarios WHERE lower(nombre) = lower($1)`, [nombre]);
  return result.rows[0] ?? null;
}

// `login` is a username or an email address.
export async function findUsuarioByLogin(login) {
  const result = await db.query(
    `SELECT ${COLUMNS} FROM usuarios WHERE lower(nombre) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
    [login],
  );
  return result.rows[0] ?? null;
}

export async function nombreOrEmailTaken(nombre, email) {
  const result = await db.query(
    `SELECT lower(nombre) = lower($1) AS nombre, lower(email) = lower($2) AS email
     FROM usuarios WHERE lower(nombre) = lower($1) OR lower(email) = lower($2)`,
    [nombre, email],
  );
  return {
    nombre: result.rows.some((row) => row.nombre),
    email: result.rows.some((row) => row.email),
  };
}

export async function createUsuario({ nombre, email, passwordHash }) {
  const id = `u-${randomBytes(6).toString('hex')}`;
  const result = await db.query(
    `INSERT INTO usuarios (id, nombre, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [id, nombre, email.toLowerCase(), passwordHash],
  );
  return result.rows[0];
}

export async function updatePerfil(usuarioId, perfil) {
  const result = await db.query(`UPDATE usuarios SET perfil = $1::jsonb WHERE id = $2 RETURNING ${COLUMNS}`, [
    JSON.stringify(perfil),
    usuarioId,
  ]);
  return result.rows[0] ?? null;
}

// Creates a session and returns the token (shown to the client once; only its hash is stored).
export async function createSession(usuarioId) {
  const token = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM sesiones WHERE expires_at < now()'); // housekeeping
  await db.query(
    `INSERT INTO sesiones (token_hash, usuario_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3::int))`,
    [hashToken(token), usuarioId, SESSION_DAYS],
  );
  return token;
}

export async function findSessionUsuario(token) {
  const result = await db.query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.perfil, u.created_at
     FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token) {
  await db.query('DELETE FROM sesiones WHERE token_hash = $1', [hashToken(token)]);
}
