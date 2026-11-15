// Connections between artists (cambios.md §14): collaborators and invitation links, proposed changes (pull
// requests), comments, internal messages and blocks.
import { randomBytes } from 'node:crypto';
import { db } from '../db/client.js';

const iso = (value) => (value ? new Date(value).toISOString() : null);

// --- Collaborators and invitation links -------------------------------------------------------------------

const INVITE_DAYS = 7;

export async function listColaboradores(cancionId) {
  const result = await db.query(
    `SELECT u.nombre, k.created_at FROM colaboradores k JOIN usuarios u ON u.id = k.usuario_id
     WHERE k.cancion_id = $1 ORDER BY k.created_at`,
    [cancionId],
  );
  return result.rows.map((row) => ({ nombre: row.nombre, desde: iso(row.created_at) }));
}

export async function addColaborador(cancionId, usuarioId) {
  await db.query('INSERT INTO colaboradores (cancion_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cancionId, usuarioId]);
}

// Returns true if the account was a collaborator.
export async function removeColaborador(cancionId, usuarioId) {
  const result = await db.query('DELETE FROM colaboradores WHERE cancion_id = $1 AND usuario_id = $2 RETURNING usuario_id', [cancionId, usuarioId]);
  return result.rows.length > 0;
}

// The project's current invitation link { token, expira }, or null (none, or expired).
export async function getInvitacion(cancionId) {
  const result = await db.query('SELECT token, expires_at FROM invitaciones WHERE cancion_id = $1 AND expires_at > now()', [cancionId]);
  const row = result.rows[0];
  return row ? { token: row.token, expira: iso(row.expires_at) } : null;
}

// A new link for the project, valid for INVITE_DAYS; the previous one stops working.
export async function createInvitacion(cancionId, usuarioId) {
  const token = randomBytes(18).toString('base64url');
  await db.query(
    `INSERT INTO invitaciones (cancion_id, token, creada_por, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4::int))
     ON CONFLICT (cancion_id) DO UPDATE SET token = EXCLUDED.token, creada_por = EXCLUDED.creada_por, expires_at = EXCLUDED.expires_at`,
    [cancionId, token, usuarioId, INVITE_DAYS],
  );
  return getInvitacion(cancionId);
}

export async function deleteInvitacion(cancionId) {
  await db.query('DELETE FROM invitaciones WHERE cancion_id = $1', [cancionId]);
}

// The project an invitation token opens: { cancion_id, expira }, or null when it is unknown or expired.
export async function findInvitacion(token) {
  const result = await db.query(
    `SELECT i.cancion_id, i.expires_at FROM invitaciones i JOIN canciones c ON c.id = i.cancion_id
     WHERE i.token = $1 AND i.expires_at > now() AND c.borrada_at IS NULL`,
    [token],
  );
  const row = result.rows[0];
  return row ? { cancion_id: row.cancion_id, expira: iso(row.expires_at) } : null;
}

// --- Proposed changes (pull requests) ---------------------------------------------------------------------

const PROPUESTA_SQL = `
  SELECT p.id, p.cancion_id, p.desde_id, p.usuario_id, p.titulo, p.mensaje, p.estado, p.created_at, p.resuelta_at,
         u.nombre AS autor, d.nombre AS desde_nombre,
         (SELECT MAX(numero) FROM versiones v WHERE v.cancion_id = p.desde_id) AS desde_version
  FROM propuestas p JOIN usuarios u ON u.id = p.usuario_id JOIN canciones d ON d.id = p.desde_id`;

const toPropuesta = (row) => ({
  id: Number(row.id),
  cancion_id: row.cancion_id,
  desde: { id: row.desde_id, nombre: row.desde_nombre, version: row.desde_version == null ? 0 : Number(row.desde_version) },
  autor: row.autor,
  titulo: row.titulo,
  mensaje: row.mensaje,
  estado: row.estado,
  fecha: iso(row.created_at),
  resuelta: iso(row.resuelta_at),
});

// Proposals to a project: open ones first, then the newest.
export async function listPropuestas(cancionId) {
  const result = await db.query(
    `${PROPUESTA_SQL} WHERE p.cancion_id = $1 ORDER BY (p.estado = 'abierta') DESC, p.created_at DESC`,
    [cancionId],
  );
  return result.rows.map(toPropuesta);
}

// One proposal, plus `usuario_id` (its author's account, for permission checks; never sent to clients).
export async function getPropuesta(id) {
  const result = await db.query(`${PROPUESTA_SQL} WHERE p.id = $1`, [id]);
  const row = result.rows[0];
  return row ? { ...toPropuesta(row), usuario_id: row.usuario_id } : null;
}

// The open proposal from copy `desdeId` to project `cancionId`, if any.
export async function openPropuestaFrom(cancionId, desdeId) {
  const result = await db.query(`SELECT id FROM propuestas WHERE cancion_id = $1 AND desde_id = $2 AND estado = 'abierta'`, [cancionId, desdeId]);
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

export async function createPropuesta({ cancionId, desdeId, usuarioId, titulo, mensaje }) {
  const result = await db.query(
    `INSERT INTO propuestas (cancion_id, desde_id, usuario_id, titulo, mensaje) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cancionId, desdeId, usuarioId, titulo, mensaje],
  );
  return getPropuesta(Number(result.rows[0].id));
}

// Closes a proposal: 'aceptada' (merged), 'rechazada' (by the project) or 'retirada' (by its author).
export async function closePropuesta(id, estado) {
  await db.query(`UPDATE propuestas SET estado = $2, resuelta_at = now() WHERE id = $1 AND estado = 'abierta'`, [id, estado]);
  return getPropuesta(id);
}

// After merging `desdeId` into `cancionId`, its open proposals count as accepted.
export async function acceptPropuestasFrom(cancionId, desdeId) {
  await db.query(
    `UPDATE propuestas SET estado = 'aceptada', resuelta_at = now() WHERE cancion_id = $1 AND desde_id = $2 AND estado = 'abierta'`,
    [cancionId, desdeId],
  );
}

// --- Comments ---------------------------------------------------------------------------------------------

export async function listComentarios(objetivo, objetivoId) {
  const result = await db.query(
    `SELECT m.id, m.texto, m.created_at, u.nombre AS autor FROM comentarios m JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.objetivo = $1 AND m.objetivo_id = $2 ORDER BY m.created_at, m.id`,
    [objetivo, objetivoId],
  );
  return result.rows.map((row) => ({ id: Number(row.id), autor: row.autor, texto: row.texto, fecha: iso(row.created_at) }));
}

export async function createComentario({ objetivo, objetivoId, usuarioId, texto }) {
  const result = await db.query(
    `INSERT INTO comentarios (objetivo, objetivo_id, usuario_id, texto) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [objetivo, objetivoId, usuarioId, texto],
  );
  return { id: Number(result.rows[0].id), fecha: iso(result.rows[0].created_at) };
}

// { objetivo, objetivo_id, usuario_id } of a comment, or null.
export async function getComentario(id) {
  const result = await db.query('SELECT objetivo, objetivo_id, usuario_id FROM comentarios WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function deleteComentario(id) {
  await db.query('DELETE FROM comentarios WHERE id = $1', [id]);
}

// --- Messages and blocks ------------------------------------------------------------------------------------

// true if `usuarioId` blocked `otroId`.
export async function hasBlocked(usuarioId, otroId) {
  const result = await db.query('SELECT 1 FROM bloqueos WHERE usuario_id = $1 AND bloqueado_id = $2', [usuarioId, otroId]);
  return result.rows.length > 0;
}

export async function block(usuarioId, otroId) {
  await db.query('INSERT INTO bloqueos (usuario_id, bloqueado_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [usuarioId, otroId]);
}

export async function unblock(usuarioId, otroId) {
  await db.query('DELETE FROM bloqueos WHERE usuario_id = $1 AND bloqueado_id = $2', [usuarioId, otroId]);
}

export async function listBloqueados(usuarioId) {
  const result = await db.query(
    `SELECT u.nombre FROM bloqueos b JOIN usuarios u ON u.id = b.bloqueado_id WHERE b.usuario_id = $1 ORDER BY b.created_at DESC`,
    [usuarioId],
  );
  return result.rows.map((row) => row.nombre);
}

export async function setMensajesDe(usuarioId, value) {
  await db.query('UPDATE usuarios SET mensajes_de = $2 WHERE id = $1', [usuarioId, value]);
}

export async function getMensajesDe(usuarioId) {
  const result = await db.query('SELECT mensajes_de FROM usuarios WHERE id = $1', [usuarioId]);
  return result.rows[0]?.mensajes_de ?? 'todos';
}

// Contacts of `usuarioId`: people it wrote to, and people it shares a project with (owner or collaborator).
export async function isContact(usuarioId, otroId) {
  const result = await db.query(
    `SELECT EXISTS (SELECT 1 FROM mensajes WHERE de_id = $1 AND para_id = $2)
         OR EXISTS (SELECT 1 FROM canciones c WHERE c.borrada_at IS NULL AND (
              (c.usuario_id = $1 AND EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = $2))
           OR (c.usuario_id = $2 AND EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = $1))
           OR (EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = $1)
               AND EXISTS (SELECT 1 FROM colaboradores k WHERE k.cancion_id = c.id AND k.usuario_id = $2)))) AS ok`,
    [usuarioId, otroId],
  );
  return Boolean(result.rows[0].ok);
}

// Why account `deId` cannot write to `para` ({ id, nombre }) right now (a message), or null if it can: a block
// either way, or `para`'s "who may write to me" setting.
export async function whyCannotWrite(deId, para) {
  if (deId === para.id) return 'You cannot write to yourself.';
  if (await hasBlocked(para.id, deId)) return `${para.nombre} is not accepting messages from you.`;
  if (await hasBlocked(deId, para.id)) return `You blocked ${para.nombre}. Unblock them to write.`;
  const setting = await getMensajesDe(para.id);
  if (setting === 'nadie') return `${para.nombre} is not accepting messages.`;
  if (setting === 'contactos' && !(await isContact(para.id, deId))) {
    return `${para.nombre} only accepts messages from people they work with or wrote to.`;
  }
  return null;
}

export async function createMensaje({ deId, paraId, asunto, texto, cancionId = null }) {
  const result = await db.query(
    `INSERT INTO mensajes (de_id, para_id, asunto, texto, cancion_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [deId, paraId, asunto, texto, cancionId],
  );
  return Number(result.rows[0].id);
}

// Conversations of an account, one per person, the most recent first:
// [{ con, ultimo: { asunto, texto, fecha, mio }, sin_leer, bloqueado }].
export async function listConversaciones(usuarioId) {
  const result = await db.query(
    `WITH mios AS (
       SELECT m.*, CASE WHEN m.de_id = $1 THEN m.para_id ELSE m.de_id END AS otro_id
       FROM mensajes m WHERE m.de_id = $1 OR m.para_id = $1
     ), ultimos AS (
       SELECT DISTINCT ON (otro_id) * FROM mios ORDER BY otro_id, created_at DESC, id DESC
     )
     SELECT l.otro_id, u.nombre AS con, l.asunto, l.texto, l.created_at, l.de_id = $1 AS mio,
            (SELECT COUNT(*) FROM mios x WHERE x.otro_id = l.otro_id AND x.para_id = $1 AND x.leido_at IS NULL) AS sin_leer,
            EXISTS (SELECT 1 FROM bloqueos b WHERE b.usuario_id = $1 AND b.bloqueado_id = l.otro_id) AS bloqueado
     FROM ultimos l JOIN usuarios u ON u.id = l.otro_id
     ORDER BY l.created_at DESC`,
    [usuarioId],
  );
  return result.rows.map((row) => ({
    con: row.con,
    ultimo: { asunto: row.asunto, texto: row.texto.slice(0, 140), fecha: iso(row.created_at), mio: row.mio },
    sin_leer: Number(row.sin_leer),
    bloqueado: row.bloqueado,
  }));
}

// Every message between two accounts, oldest first (marks the ones `usuarioId` received as read).
export async function listHilo(usuarioId, otroId) {
  await db.query('UPDATE mensajes SET leido_at = now() WHERE para_id = $1 AND de_id = $2 AND leido_at IS NULL', [usuarioId, otroId]);
  const result = await db.query(
    `SELECT m.id, m.asunto, m.texto, m.created_at, m.leido_at, m.de_id = $1 AS mio, de.nombre AS de, para.nombre AS para,
            m.cancion_id, c.nombre AS cancion_nombre
     FROM mensajes m JOIN usuarios de ON de.id = m.de_id JOIN usuarios para ON para.id = m.para_id
     LEFT JOIN canciones c ON c.id = m.cancion_id AND c.borrada_at IS NULL
     WHERE (m.de_id = $1 AND m.para_id = $2) OR (m.de_id = $2 AND m.para_id = $1)
     ORDER BY m.created_at, m.id`,
    [usuarioId, otroId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    de: row.de,
    para: row.para,
    mio: row.mio,
    asunto: row.asunto,
    texto: row.texto,
    fecha: iso(row.created_at),
    leido: Boolean(row.leido_at),
    cancion: row.cancion_id && row.cancion_nombre ? { id: row.cancion_id, nombre: row.cancion_nombre } : null,
  }));
}

export async function countSinLeer(usuarioId) {
  const result = await db.query('SELECT COUNT(*) AS n FROM mensajes WHERE para_id = $1 AND leido_at IS NULL', [usuarioId]);
  return Number(result.rows[0].n);
}
