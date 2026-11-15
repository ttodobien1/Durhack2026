// Applies the schema when the database is missing tables or columns (for example right after a deploy
// that added accounts). Runs at most once per server instance; when everything exists it costs one query.
import { databaseKind, db } from './client.js';
import { features } from './features.js';
import { SCHEMA, TIMESCALE_STATEMENTS, VECTOR_SCHEMA } from './schema.js';
import { backfillHuellas } from '../repo/vectores.js';

const CHECK_SQL = `
  SELECT to_regclass('public.sesiones') IS NOT NULL
     AND to_regclass('public.versiones') IS NOT NULL
     AND to_regclass('public.favoritos') IS NOT NULL
     AND to_regclass('public.comentarios') IS NOT NULL
     AND to_regclass('public.colaboradores') IS NOT NULL
     AND to_regclass('public.invitaciones') IS NOT NULL
     AND to_regclass('public.propuestas') IS NOT NULL
     AND to_regclass('public.mensajes') IS NOT NULL
     AND to_regclass('public.bloqueos') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'pide_ayuda_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'mensajes_de')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'piezas' AND column_name = 'usuario_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'piezas' AND column_name = 'publica')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'usuario_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'publica')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'descripcion')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'borrada_at')
     AND to_regclass('public.eventos') IS NOT NULL
     AS ready`;

async function isReady() {
  const result = await db.query(CHECK_SQL);
  return Boolean(result.rows[0].ready);
}

async function migrate() {
  if (await isReady()) return;
  try {
    await db.exec(SCHEMA);
    console.log('Database schema updated');
  } catch (err) {
    // Two instances starting at once can race on CREATE ... IF NOT EXISTS; fine if the other one finished.
    if (!(await isReady())) throw err;
  }
}

const hasColumn = async (table, column) =>
  (await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3', ['public', table, column])).rows.length > 0;

/**
 * Optional parts, each on its own so a refusal never breaks the app (see features.js):
 * pgvector columns (+ fingerprints for pieces that have none), and on TigerData the TimescaleDB hypertable.
 * Never throws; logs what is unavailable.
 */
export async function applyExtras({ log = console.log } = {}) {
  try {
    if (!(await hasColumn('piezas', 'huella')) || !(await hasColumn('piezas', 'embedding'))) await db.exec(VECTOR_SCHEMA);
    features.vectores = true;
  } catch (err) {
    features.vectores = false;
    log(`pgvector unavailable (similarity stays in memory, search keyword-only): ${err.message}`);
  }
  if (databaseKind === 'postgres') {
    try {
      const found = await db.query(`SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'eventos'`).catch(() => ({ rows: [] }));
      const view = await db.query(`SELECT to_regclass('public.eventos_hora') IS NOT NULL AS ok`);
      if (!found.rows.length || !view.rows[0].ok) for (const sql of TIMESCALE_STATEMENTS) await db.query(sql);
      features.timescale = true;
    } catch (err) {
      features.timescale = false;
      log(`TimescaleDB unavailable (events stay a plain table): ${err.message}`);
    }
  }
  if (features.vectores) {
    const n = await backfillHuellas().catch((err) => log(`fingerprint backfill failed: ${err.message}`));
    if (n) log(`Stored fingerprints for ${n} pieces`);
  }
}

let pending = null;

export function ensureSchema() {
  pending ??= migrate().then(() => applyExtras()).catch((err) => {
    pending = null; // try again on the next request
    throw err;
  });
  return pending;
}
