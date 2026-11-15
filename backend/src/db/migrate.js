// Applies the schema when the database is missing tables or columns (for example right after a deploy
// that added accounts). Runs at most once per server instance; when everything exists it costs one query.
import { db } from './client.js';
import { SCHEMA } from './schema.js';

const CHECK_SQL = `
  SELECT to_regclass('public.sesiones') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'piezas' AND column_name = 'usuario_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'usuario_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'publica')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'canciones' AND column_name = 'descripcion')
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

let pending = null;

export function ensureSchema() {
  pending ??= migrate().catch((err) => {
    pending = null; // try again on the next request
    throw err;
  });
  return pending;
}
