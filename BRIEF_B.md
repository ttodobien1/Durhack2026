# Brief for B (Chino): turn on Tiger Data vectors, events and Gemini search in production

For B's Claude Code. Read it, run the steps, check each one, and delete this file when it is done.

## What already exists (branch `a/frontend`, which Vercel builds)

The code is written and tested (68 backend tests pass, `cd backend && npm test`). Nothing below needs new code;
it needs the production database, the keys and one backfill.

- **pgvector** (`db/schema.js` `VECTOR_SCHEMA`, applied by `db/migrate.js` `applyExtras()` on the first request):
  - `piezas.huella vector(32)`: the musical fingerprint, zero-padded to 32 numbers.
  - `piezas.embedding vector(768)` and `embedding_src`: the Gemini embedding and the sha256 of its text.
  - Two HNSW indexes.
  - Fingerprints are backfilled automatically for pieces that have none.
- **Similarity in SQL:** `repo/similares.js` `similarTo()` runs one indexed `huella <-> $1` query and falls back to
  the in-memory scan if the query fails.
- **Events** (`eventos` table; `repo/eventos.js`, `routes/eventos.js`):
  - On TigerData, `applyExtras()` makes the table a hypertable with the continuous aggregate `eventos_hora` plus a
    refresh policy (`TIMESCALE_STATEMENTS`).
  - Forks and saves are logged by the server. Plays come from the frontend through `POST /eventos/reproduccion`.
  - No IP or user agent is stored.
- **New endpoints:**
  - `GET /piezas/tendencia`
  - `GET /piezas/:id/actividad`
  - `POST /eventos/reproduccion`
  - `GET /canciones/:id/creditos` now adds `reproducciones_hoy`, and `notas_reproducidas_hoy` per author.
- **Hybrid search** (`repo/busqueda.js`, `lib/hybrid.js`):
  - `GET /piezas?q=` keeps the same contract but ranks keyword hits and Gemini semantic hits together (reciprocal
    rank fusion).
  - The copilot's `buscar_piezas` uses it too.
  - It falls back to keyword-only results with no key, on a Gemini error, or after 1.5 s.
- **Frontend:**
  - Every Play logs a play.
  - "Trending now" row and "More like this" in the landing Library.
  - "found by meaning" badge on semantic results.
  - Plays-per-hour sparkline in the piano roll header.
  - "Your notes were played N times today" in History > Credits.

## Steps

1. **Check the Tiger extensions.** In the Tiger console SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'timescaledb');
   ```
   Both must be listed. If `vector` cannot be created, enable it in the service settings. The app still works
   without it: search becomes keyword-only and similarity stays in memory.
2. **Set the keys on the backend's Vercel project** (Settings > Environment Variables, then redeploy):
   - `GEMINI_API_KEY`: required for semantic search.
   - `GEMINI_EMBED_MODEL`: optional. The default is `gemini-embedding-001`; check the name against Google's
     embeddings docs before changing it.
   - `DATABASE_URL`: should already be there.
   - Never commit any of these values.
3. **Deploy and check `/health`.** It must say `"vectores": true` and `"timescale": true`. If either is false, the
   function logs say why ("pgvector unavailable" / "TimescaleDB unavailable").
4. **Backfill the embeddings once**, from your machine. In `backend/.env`, set `DATABASE_URL` to Tiger and
   `GEMINI_API_KEY`, then run:
   ```bash
   cd backend && npm run embed
   ```
   - It embeds every public piece whose description changed and skips the rest, so re-running is safe.
   - The free tier allows about 100 texts a minute. The script waits on 429s by itself, so about 900 pieces take
     about 10 minutes.
   - Only public pieces are sent to Google.
5. **Serverless caveat (Vercel): done.** `embedLater` now hands its work to the request's `waitUntil` (`6b2bdce`),
   and event logging is awaited. If an embedding is still missing, re-run `npm run embed`: it only embeds what changed.
6. **Smoke test production:**
   ```bash
   API=https://<backend>.vercel.app
   curl "$API/health"
   curl "$API/piezas?q=dark%20rainy%20night%20slow" | head -c 600    # results without those words in their names
   curl -X POST -H 'Content-Type: application/json' -d '{"cancion_id":"c-001"}' "$API/eventos/reproduccion" -i | head -1   # 204
   curl "$API/piezas/tendencia" | head -c 400
   curl "$API/canciones/c-001/creditos" | grep -o '"reproducciones_hoy":[0-9]*'
   ```
7. **For the judges (Tiger console):**
   ```sql
   SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = 'eventos';
   SELECT * FROM timescaledb_information.continuous_aggregates WHERE view_name = 'eventos_hora';
   SELECT hora, tipo, pieza_id, n FROM eventos_hora ORDER BY hora DESC LIMIT 20;
   SELECT id, nombre, huella <-> (SELECT huella FROM piezas WHERE id = 'p-001') AS d
     FROM piezas WHERE tipo = 'ritmo' AND publica ORDER BY d LIMIT 5;
   ```
8. **Load the near-copy test pieces** (`data/piezas/near-copy-tests.json`, `p-9001`–`p-9006`). Point
   `backend/.env` at Tiger and run `cd backend && npm run db:seed`. It inserts or updates by id, so it is safe to
   re-run. Then add "Joyful theme in F (test: transposed copy)" to a song: a yellow bar must say it sounds like Ode to
   Joy by Beethoven.
9. **Integration:** merge `a/frontend` into `main` when the deploy checks out. `main` must keep working.

## Tell the team

- `GET /piezas?q=` ranks results differently now. The response contract is the same.
- Piece names, tags and a descriptive line of public pieces are sent to Google to be embedded.
