// Creates the tables (safe to run many times).
//   npm run db:init                 create missing tables
//   npm run db:reset                drop everything, recreate and seed from /data
//   npm run db:reset -- --yes       same, but allowed against a remote database (TigerData)
import '../src/loadEnv.js';
import { databaseKind, db, LOCAL_DATA_DIR } from '../src/db/client.js';
import { SCHEMA } from '../src/db/schema.js';
import { seedDatabase } from './lib/seed.js';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const seed = args.has('--seed');

console.log(databaseKind === 'postgres' ? 'Database: postgres (DATABASE_URL)' : `Database: pglite (${LOCAL_DATA_DIR})`);

if (reset && databaseKind === 'postgres' && !args.has('--yes')) {
  console.error('Refusing to drop a remote database without --yes (npm run db:reset -- --yes).');
  process.exit(1);
}

try {
  if (reset) {
    await db.exec('DROP TABLE IF EXISTS versiones, bloques, pistas, canciones, piezas, sesiones, usuarios CASCADE;');
    console.log('Dropped existing tables');
  }
  await db.exec(SCHEMA);
  console.log('Schema ready');
  if (seed) await seedDatabase();
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
