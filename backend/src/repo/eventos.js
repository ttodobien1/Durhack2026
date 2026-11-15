// Plays, forks and saves over time (table eventos). On TigerData it is a TimescaleDB hypertable with the hourly
// continuous aggregate eventos_hora (schema.js TIMESCALE_STATEMENTS); elsewhere a plain table. Every query has both
// paths: time_bucket / the aggregate when features.timescale, date_trunc otherwise; and on TigerData a failing
// aggregate query falls back to the raw table. No IP or user agent is ever stored; plays carry no author either.
import { db } from '../db/client.js';
import { features } from '../db/features.js';

/** Record one event. Fire-and-forget: logging never fails the request that caused it. */
export function logEvent({ tipo, pieza_id = null, cancion_id = null, autor = null }) {
  db.query('INSERT INTO eventos (tipo, pieza_id, cancion_id, autor) VALUES ($1, $2, $3, $4)', [tipo, pieza_id, cancion_id, autor]).catch((err) =>
    console.warn(`event ${tipo} not logged: ${err.message}`),
  );
}

/**
 * One play: of a song (one row for the song, pieza_id NULL, plus one per distinct piece in it, for trending) or of
 * loose pieces (one row each). Ids must already be validated by the caller.
 */
export async function logPlay({ cancion_id = null, pieza_ids = [] }) {
  const rows = [...(cancion_id ? [[null, cancion_id]] : []), ...[...new Set(pieza_ids)].map((id) => [id, cancion_id])];
  if (!rows.length) return;
  const values = rows.map((_, i) => `('reproduccion', $${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  await db.query(`INSERT INTO eventos (tipo, pieza_id, cancion_id) VALUES ${values}`, rows.flat());
}

const bucket = () => (features.timescale ? "time_bucket('1 hour', tiempo)" : "date_trunc('hour', tiempo)");

async function tigerFirst(aggregateSql, rawSql, args) {
  if (features.timescale) {
    try {
      return (await db.query(aggregateSql, args)).rows;
    } catch (err) {
      console.warn(`continuous aggregate query failed, using the raw table: ${err.message}`);
    }
  }
  return (await db.query(rawSql, args)).rows;
}

/** Pieces most played and forked in the last `hours`: [{ pieza_id, reproducciones, forks }], plays + 3 × forks first. */
export async function trending({ hours = 24, limit = 10 } = {}) {
  const rows = await tigerFirst(
    `SELECT pieza_id, COALESCE(sum(n) FILTER (WHERE tipo = 'reproduccion'), 0)::int AS reproducciones,
            COALESCE(sum(n) FILTER (WHERE tipo = 'fork'), 0)::int AS forks
     FROM eventos_hora WHERE hora > now() - make_interval(hours => $1) AND pieza_id IS NOT NULL
     GROUP BY pieza_id`,
    `SELECT pieza_id, count(*) FILTER (WHERE tipo = 'reproduccion')::int AS reproducciones,
            count(*) FILTER (WHERE tipo = 'fork')::int AS forks
     FROM eventos WHERE tiempo > now() - make_interval(hours => $1) AND pieza_id IS NOT NULL
     GROUP BY pieza_id`,
    [hours],
  );
  return rows
    .map((r) => ({ pieza_id: r.pieza_id, reproducciones: Number(r.reproducciones), forks: Number(r.forks) }))
    .filter((r) => r.reproducciones + r.forks > 0)
    .sort((a, b) => b.reproducciones + 3 * b.forks - (a.reproducciones + 3 * a.forks) || a.pieza_id.localeCompare(b.pieza_id))
    .slice(0, limit);
}

/** One piece's plays and forks per hour over the last 24 hours (24 buckets, oldest first, zeros included). */
export async function activity(piezaId) {
  const rows = await tigerFirst(
    `SELECT hora, COALESCE(sum(n) FILTER (WHERE tipo = 'reproduccion'), 0)::int AS reproducciones,
            COALESCE(sum(n) FILTER (WHERE tipo = 'fork'), 0)::int AS forks
     FROM eventos_hora WHERE pieza_id = $1 AND hora > now() - interval '24 hours' GROUP BY hora`,
    `SELECT ${bucket()} AS hora, count(*) FILTER (WHERE tipo = 'reproduccion')::int AS reproducciones,
            count(*) FILTER (WHERE tipo = 'fork')::int AS forks
     FROM eventos WHERE pieza_id = $1 AND tiempo > now() - interval '24 hours' GROUP BY 1`,
    [piezaId],
  );
  const byHour = new Map(rows.map((r) => [new Date(r.hora).getTime(), r]));
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const horas = Array.from({ length: 24 }, (_, i) => {
    const t = now.getTime() - (23 - i) * 3600e3;
    const r = byHour.get(t);
    return { hora: new Date(t).toISOString(), reproducciones: Number(r?.reproducciones ?? 0), forks: Number(r?.forks ?? 0) };
  });
  return { pieza_id: piezaId, horas, total: horas.reduce((s, h) => s + h.reproducciones, 0) };
}

/** How many times a song was played today (UTC). */
export async function songPlaysToday(cancionId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM eventos
     WHERE tipo = 'reproduccion' AND cancion_id = $1 AND pieza_id IS NULL AND tiempo >= date_trunc('day', now())`,
    [cancionId],
  );
  return Number(rows[0]?.n ?? 0);
}
