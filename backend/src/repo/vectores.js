// Vector columns of piezas (pgvector): the musical fingerprint `huella` and the Gemini `embedding`.
// Every function is a no-op when the database has no pgvector (features.vectores false).
import { db } from '../db/client.js';
import { features } from '../db/features.js';
import { createHash } from 'node:crypto';
import { huellaVector } from '../lib/fingerprint.js';
import { describePiece } from '../lib/describePiece.js';
import { embedTexts, vectorLiteral } from '../copilot/embeddings.js';

/** Store a piece's fingerprint (call after it is created or its notes change). Never throws. */
export async function setHuella(pieza) {
  if (!features.vectores || !pieza?.id) return;
  try {
    await db.query('UPDATE piezas SET huella = $2::vector WHERE id = $1', [pieza.id, huellaVector(pieza)]);
  } catch (err) {
    console.warn(`huella for ${pieza.id} not stored: ${err.message}`);
  }
}

/** Fingerprints for every piece that has none (pieces seeded or created before pgvector). Returns how many. */
export async function backfillHuellas() {
  if (!features.vectores) return 0;
  const { rows } = await db.query('SELECT id, tipo, notas FROM piezas WHERE huella IS NULL');
  for (const row of rows) {
    const notas = typeof row.notas === 'string' ? JSON.parse(row.notas) : row.notas;
    await db.query('UPDATE piezas SET huella = $2::vector WHERE id = $1', [row.id, huellaVector({ tipo: row.tipo, notas })]);
  }
  return rows.length;
}

/** A piece that turns private loses its text embedding: private pieces are never sent to (or kept from) Google. */
export async function forgetEmbedding(id) {
  if (!features.vectores) return;
  await db.query('UPDATE piezas SET embedding = NULL, embedding_src = NULL WHERE id = $1', [id]).catch(() => {});
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const parse = (x) => (typeof x === 'string' ? JSON.parse(x) : x);

/**
 * Embeds public pieces whose description changed since their last embedding (embedding_src = sha256 of the text),
 * so re-runs skip what is up to date. Only public pieces: private pieces' names never leave this server.
 * `ids` limits it to some pieces. Returns how many were embedded. Throws on Gemini errors (callers decide).
 */
export async function embedPublicPieces({ ids = null, log = () => {} } = {}) {
  if (!features.vectores || !process.env.GEMINI_API_KEY) return 0;
  const { rows } = await db.query(
    `SELECT id, nombre, tipo, tonalidad, tempo, estilo, compases, notas, embedding_src FROM piezas
     WHERE publica ${ids ? 'AND id = ANY($1)' : ''} ORDER BY id`,
    ids ? [ids] : [],
  );
  const todo = rows
    .map((r) => {
      const text = describePiece({ ...r, estilo: parse(r.estilo), notas: parse(r.notas), tempo: Number(r.tempo) });
      return { id: r.id, text, hash: sha256(text), current: r.embedding_src };
    })
    .filter((t) => t.hash !== t.current);
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    let vectors;
    for (let attempt = 1; !vectors; attempt++) {
      try {
        vectors = await embedTexts(batch.map((t) => t.text), 'RETRIEVAL_DOCUMENT');
      } catch (err) {
        if (err.status !== 429 || attempt > 6) throw err;
        const wait = Math.ceil((err.retryAfter ?? 60) + 1);
        log(`rate limited by Gemini (free tier: 100 texts a minute); waiting ${wait} s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    for (let k = 0; k < batch.length; k++) {
      await db.query('UPDATE piezas SET embedding = $2::vector, embedding_src = $3 WHERE id = $1', [batch[k].id, vectorLiteral(vectors[k]), batch[k].hash]);
    }
    log(`embedded ${Math.min(i + 100, todo.length)} of ${todo.length}`);
  }
  return todo.length;
}

// On Vercel, work still running after the response can be frozen. The platform keeps the function alive for promises
// handed to the request context's waitUntil (what `waitUntil` from @vercel/functions does, without its 25 packages).
// Anywhere else (local Node) there is no such context and the promise simply runs on.
function keepAlive(promise) {
  const context = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  context?.waitUntil?.(promise);
}

/** Re-embed one piece in the background after it is created or edited. Fail-soft: never fails the save. */
export function embedLater(id) {
  if (!features.vectores || !process.env.GEMINI_API_KEY) return;
  keepAlive(embedPublicPieces({ ids: [id] }).catch((err) => console.warn(`embedding of ${id} skipped: ${err.message}`)));
}

