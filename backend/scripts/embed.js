// Embeds every public piece whose description changed (Gemini, see src/repo/vectores.js embedPublicPieces).
//   npm run embed          (uses DATABASE_URL if set, else the local PGlite; needs GEMINI_API_KEY)
// Re-runs only embed what changed. Sends piece names, tags and the descriptive line of PUBLIC pieces to Google.
import '../src/loadEnv.js';
import { databaseKind, db } from '../src/db/client.js';
import { applyExtras } from '../src/db/migrate.js';
import { features } from '../src/db/features.js';
import { embedPublicPieces } from '../src/repo/vectores.js';

try {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (backend/.env)');
  console.log(`Database: ${databaseKind}`);
  await applyExtras();
  if (!features.vectores) throw new Error('pgvector is not available in this database');
  const n = await embedPublicPieces({ log: console.log });
  console.log(n ? `Done: ${n} pieces embedded` : 'Everything was already up to date');
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
