// Loads /data/piezas/*.json and /data/canciones/*.json into the database (insert or update by id).
//   npm run db:seed
import '../src/loadEnv.js';
import { databaseKind, db } from '../src/db/client.js';
import { seedDatabase } from './lib/seed.js';

console.log(`Database: ${databaseKind}`);
try {
  await seedDatabase();
} catch (err) {
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
