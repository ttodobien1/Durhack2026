// Creates the tables (safe to run many times).
//   npm run db:init                 create missing tables
//   npm run db:reset                drop everything, recreate and seed from /data
//   npm run db:reset -- --yes       same, but allowed against a remote Turso database
import '../src/loadEnv.js';
import { readFile } from 'node:fs/promises';
import { databaseKind, db } from '../src/db/client.js';
import { SCHEMA_FILE } from './lib/paths.js';
import { seedDatabase } from './lib/seed.js';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const seed = args.has('--seed');

console.log(`Database: ${databaseKind} (${process.env.TURSO_DATABASE_URL || 'file:lineage.db'})`);

if (reset && databaseKind === 'turso' && !args.has('--yes')) {
  console.error('Refusing to drop a remote Turso database without --yes (npm run db:reset -- --yes).');
  process.exit(1);
}

if (reset) {
  await db.executeMultiple(`
    DROP TABLE IF EXISTS bloques;
    DROP TABLE IF EXISTS pistas;
    DROP TABLE IF EXISTS canciones;
    DROP TABLE IF EXISTS piezas;
  `);
  console.log('Dropped existing tables');
}

await db.executeMultiple(await readFile(SCHEMA_FILE, 'utf8'));
console.log('Schema ready');

if (seed) await seedDatabase();
