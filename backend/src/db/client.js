// Database access. Same SQL (PostgreSQL) everywhere:
//   - DATABASE_URL set   -> real Postgres (TigerData) through `pg`
//   - DATABASE_URL unset -> PGlite, a Postgres that runs inside Node and stores data in backend/.pglite
//     (local development without installing anything).
//
// API used by the repositories:
//   db.query(sql, params)   -> { rows }       ($1, $2... placeholders)
//   db.exec(sql)            -> runs several statements (no params), e.g. the schema
//   db.transaction(fn)      -> fn({ query }) inside BEGIN/COMMIT, rolls back on error
//   db.close()              -> ends the connections (scripts call it so Node can exit)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;

if (process.env.VERCEL && !url) {
  throw new Error('DATABASE_URL is not set. Configure the TigerData connection string in the Vercel project settings.');
}

export const databaseKind = url ? 'postgres' : 'pglite';
export const LOCAL_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.pglite');

async function createPostgres() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 10_000,
  });
  // An idle connection dropped by the server must not crash the process.
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  return {
    query: (sql, params = []) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params = []) => client.query(sql, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector'); // pgvector, same SQL as on TigerData
  const pglite = new PGlite(LOCAL_DATA_DIR, { extensions: { vector } });
  return {
    query: (sql, params = []) => pglite.query(sql, params),
    exec: (sql) => pglite.exec(sql),
    transaction: (fn) => pglite.transaction((tx) => fn({ query: (sql, params = []) => tx.query(sql, params) })),
    close: () => pglite.close(),
  };
}

let driver = null;
const getDriver = () => (driver ??= url ? createPostgres() : createPglite());

export const db = {
  query: async (sql, params) => (await getDriver()).query(sql, params),
  exec: async (sql) => (await getDriver()).exec(sql),
  transaction: async (fn) => (await getDriver()).transaction(fn),
  async close() {
    if (!driver) return;
    const current = await driver;
    driver = null;
    await current.close();
  },
};

// "$1, $2, $3" for a list of values, starting after `offset` existing params.
export function placeholders(values, offset = 0) {
  return values.map((_, i) => `$${offset + i + 1}`).join(', ');
}
