Here are the briefs for **Tiger Data (pgvector + hypertable)** and **Gemini semantic search**. They share one setup step: pgvector in the database. Do that first, then the two can be built in parallel.

---

## Shared step 0: pgvector in both databases

[db/client.js](backend/src/db/client.js) runs the same SQL on Tiger (`pg`) and locally (PGlite), and both support pgvector.

1. **PGlite:** `import { vector } from '@electric-sql/pglite/vector'` and create it with `new PGlite(LOCAL_DATA_DIR, { extensions: { vector } })`.
2. **Schema** ([schema.js](backend/src/db/schema.js)), at the top:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ALTER TABLE piezas ADD COLUMN IF NOT EXISTS huella        vector(32);  -- musical fingerprint
   ALTER TABLE piezas ADD COLUMN IF NOT EXISTS embedding     vector(768); -- Gemini text embedding
   ALTER TABLE piezas ADD COLUMN IF NOT EXISTS embedding_src text;        -- hash of the embedded text
   CREATE INDEX IF NOT EXISTS idx_piezas_huella    ON piezas USING hnsw (huella vector_l2_ops);
   CREATE INDEX IF NOT EXISTS idx_piezas_embedding ON piezas USING hnsw (embedding vector_cosine_ops);
   ```
3. `fingerprint()` returns 32 numbers for drums and 14 for everything else. **Pad with zeros to 32**: zeros don't change the distance between two pieces of the same type, so one column works for every type.

These are DB-only columns. The API's `Pieza` JSON doesn't change.

---

## Brief 1: Best Use of Tiger Data

**Angle:** *Tiger Data is Stemma's memory: what every piece sounds like, stored as vectors, and every play and fork, stored as time-series data. Together they power similarity search and a live credits ledger.*

### 1a. Musical similarity in SQL (pgvector)
- **Write the fingerprints:** call `fingerprint()` when a piece is created or edited (in `routes/piezas.js`, next to the existing `forgetFingerprints()` calls), and in the seed script for all existing pieces.
- **Read:** rewrite `similarTo()` in [similares.js](backend/src/repo/similares.js) as one query:
  ```sql
  SELECT id, nombre, autor, huella <-> $1 AS distancia
  FROM piezas WHERE tipo = $2 AND publica AND id <> $3
  ORDER BY huella <-> $1 LIMIT $4;
  ```
  Keep the `similitud` 0–100 score by dividing by the cached `typicalDistance` per type, as the code does now.
- **Keep in memory:** the sound map (PCA needs every vector anyway) and the near-copy check (it uses windowed fingerprints).
- **Honest note:** with ~900 pieces, an in-memory scan is fast too. The win is that similarity becomes one indexed query that any part of the app, including the copilot, can join with filters.

### 1b. Play and fork events as a hypertable
- **Table:**
  ```sql
  CREATE TABLE IF NOT EXISTS eventos (
    tiempo     timestamptz NOT NULL DEFAULT now(),
    tipo       text NOT NULL,          -- 'reproduccion' | 'fork' | 'guardado'
    pieza_id   text, cancion_id text, autor text );
  ```
- **On Tiger only** (when `databaseKind === 'postgres'`, inside a try/catch):
  - `SELECT create_hypertable('eventos', by_range('tiempo'), if_not_exists => true)`;
  - a **continuous aggregate** `eventos_hora` with `time_bucket('1 hour', tiempo)`, grouped by `tipo, pieza_id`.

  PGlite keeps the plain table.
- **What gets logged:**
  - forks and saves: on the server, in the existing fork and version routes;
  - plays: a new `POST /eventos/reproduccion` with `{ cancion_id }` or `{ pieza_ids: [...] }`, at most 50 ids. Validate that the ids exist and **store no IP or user agent**. The frontend calls it once each time playback starts.
- **Queries**, one function each, with two paths: `time_bucket` on Tiger and `date_trunc('hour', …)` on PGlite.
  - **Trending:** the most played and forked pieces in the last 24 hours.
  - **Sparkline:** one piece's plays per hour over 24 hours.
  - **Credits ledger:** how many of an author's notes were played today. Join plays with `blame` shares; the credits code already gives notes per author per song.
- **Endpoints:** `GET /piezas/tendencia` and `GET /piezas/:id/actividad`. For the ledger, add `notas_reproducidas_hoy` per author to the existing `GET /canciones/:id/creditos`.
- **UI:**
  - a "Trending now" row in the library;
  - a small sparkline in the piece header;
  - "your notes were played *N* times today" in the Credits tab.

**What judges see:** play the demo song and watch the trending row and the credits counter update. Then show the hypertable and the continuous aggregate in the Tiger console.

**Tests:** fingerprint padding (32 dims, same distance as unpadded); `similarTo` against PGlite returns the same order as the old in-memory version on a few fixtures.

---

## Brief 2: Best Use of Gemini — semantic search

**Angle:** *Describe the vibe in words ("dark, rainy, late night") and Stemma finds real pieces made by real people. Gemini understands the words, Tiger stores the vectors, and the AI never writes a note.*

### 2a. What gets embedded
- Add `describePiece(pieza)` in `backend/src/lib/`, a pure function that builds one line of text. For example:
  `"Boom bap drums · drums · 90 BPM · A minor · styles: rap, lo-fi · sparse kick, busy hi-hats, swung"`
- The descriptive words come from the fingerprint, reusing `describeAxis` and the feature names. **This line is what makes mood words work**: names and tags alone are thin.
- **Only public pieces are embedded.** Private pieces' names never leave your server.

### 2b. Calling Gemini
- New file `backend/src/copilot/embeddings.js`, using plain `fetch` like [gemini.js](backend/src/copilot/gemini.js); no new dependency.
  - Model `process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001'`.
  - Use `:batchEmbedContents` with up to 100 texts per call and `outputDimensionality: 768`.
  - Use `taskType: 'RETRIEVAL_DOCUMENT'` for pieces and `'RETRIEVAL_QUERY'` for searches.
  - **L2-normalize** the vectors yourself, since a 768-dim output isn't pre-normalized.
- **Backfill:** add a script, `npm run embed`, that embeds every public piece whose `embedding_src` differs from `sha256(describePiece(p))`, so re-runs skip what hasn't changed.
- **On create or edit:** re-embed in the background, fail-soft: a Gemini error never fails the save.
- Add `GEMINI_EMBED_MODEL` to `.env.example`. **Check the model name against Google's docs before using it.**

### 2c. Hybrid search behind the existing endpoint
- `GET /piezas?q=…` stays the same contract (`[Pieza, ...]`), with better ranking:
  1. the keyword hits, exactly as today;
  2. the top 50 by `embedding <=> $queryVector`, using the same `tipo`/`tonalidad`/`estilo` filters;
  3. merge the two with **reciprocal rank fusion**: `score = Σ 1/(60 + rank)`. It's about 10 lines and has no weights to tune.
- **Fallback:** with no key, a Gemini error or a timeout over ~1.5 s, return the keyword results only. The search box never breaks.
- **The copilot gets it for free:** `buscar_piezas` already calls this search, so DJ Stemy's suggestions improve with no prompt change.
- **Optional "More like this"** button on a result: re-rank by `huella <-> that piece's huella`. That's one query that uses **both vectors**, and the shared demo moment for the two prizes.

**What judges see:**
1. Type "dark rainy night, slow" into the library search. The results have none of those words in their names.
2. Click "More like this" on one, and the next results *sound* like it.
3. Line to say: *"Words find the vibe, sound finds the neighbours, and every result is a real piece with a real author."*

**Tests:**
- `describePiece` returns stable text for a fixture.
- Reciprocal rank fusion puts an item ranked first in both lists on top.
- The search falls back to keyword results when the embedding call throws (mock `fetch`).

---

**Order:**
1. Step 0 (pgvector).
2. In parallel: 1a + 2a/2b, then 2c and 1b.
3. The UI pieces last.

1b (the hypertable) can be dropped without affecting the rest.

**Before you build:**
- **Check what Tiger allows.** I assumed your Tiger service has the TimescaleDB and pgvector extensions enabled, and that PGlite's `vector` extension matches your installed PGlite version (0.5.x). Run `CREATE EXTENSION` on both before building on them.
- **Tell the team about the search change.** `?q=` now ranks results differently, even though the response contract doesn't change.
- **Embedding sends metadata to Google.** Piece names, tags and the descriptive line go to Google's API, which is why only public pieces are embedded. if chino has to do anything put that in a brief for his claude to read and then do as much of this as possible
