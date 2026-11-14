import { createClient } from '@libsql/client';

// Local development: a SQLite file (relative to the backend folder, where npm scripts run).
// Production (Vercel): a Turso database, e.g. libsql://lineage-<org>.turso.io + auth token.
const url = process.env.TURSO_DATABASE_URL || 'file:lineage.db';

if (process.env.VERCEL && url.startsWith('file:')) {
  throw new Error(
    'TURSO_DATABASE_URL is not set. Vercel cannot use a local SQLite file; configure a Turso database.',
  );
}

export const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

export const databaseKind = url.startsWith('file:') ? 'sqlite-file' : 'turso';
