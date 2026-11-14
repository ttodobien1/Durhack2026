# Stemma backend

Node + Express API for Stemma: pieces, forks, musical diff, songs, lineage tree and the copilot.
Contracts (field names, units, routes) are the ones in `CLAUDE.md` section 4.

- **Database:** PostgreSQL. In production it is a [TigerData](https://www.tigerdata.com) service (managed
  Postgres/TimescaleDB) reached through `DATABASE_URL`. Without `DATABASE_URL` the backend uses
  [PGlite](https://pglite.dev), a Postgres that runs inside Node and keeps its data in `backend/.pglite/`, so local
  development needs no install and no internet. Same SQL in both.
- **Copilot:** Claude API with tool use (`buscar_piezas`, `describir_estilo`). It only recommends existing pieces.

## Run locally

```bash
cd backend
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY if you want the copilot
npm run db:reset            # create tables + load /data (Groove pieces p-101..p-402, placeholders p-001..p-015, song c-001)
npm run dev                 # http://localhost:3001 (restarts on file changes)
```

Check it works: `GET http://localhost:3001/health` (`"database": "pglite"` locally, `"postgres"` with `DATABASE_URL`).

Postman: import `postman/Stemma.postman_collection.json` (variable `baseUrl`). To look at the data in TigerData,
use the SQL editor in its console or any Postgres client (`psql`, DBeaver, the VS Code PostgreSQL extension) with
the same connection string.

> PGlite allows one process at a time on `backend/.pglite/`: stop `npm run dev` before running the `db:*` scripts
> locally. To start over locally, stop the server and delete the `.pglite` folder (or run `npm run db:reset`).

| Script | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Start the API (`PORT`, default 3001) |
| `npm run db:init` | Create missing tables (safe to repeat) |
| `npm run db:seed` | Insert or update everything in `/data/piezas` and `/data/canciones` (by id) |
| `npm run db:reset` | Drop all tables, recreate, seed. With `DATABASE_URL` set it needs `npm run db:reset -- --yes` |
| `npm run import:midi` | Convert MIDI files into piece JSON (see `data/README.md`) |
| `npm test` | Unit tests (musical diff, normalization) |

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | Local only |
| `ANTHROPIC_API_KEY` | — | Copilot. Without it `/copiloto` answers 503 and everything else works |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Optional override |
| `GEMINI_API_KEY` | — | Copilot fallback used only when `ANTHROPIC_API_KEY` is empty (same prompt and tools, `src/copilot/gemini.js`) |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Optional override |
| `DATABASE_URL` | — (PGlite) | TigerData connection string, `postgres://tsdbadmin:...@<host>:<port>/tsdb?sslmode=verify-full` |
| `PG_POOL_MAX` | `5` | Optional, max Postgres connections per server instance |

## API

Errors always come back as `{ "error": "message" }` with the matching HTTP status (400, 404, 503...).

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/health` | Database type and row counts |
| GET | `/piezas?estilo=&tipo=&tonalidad=&q=&autor=` | All filters optional. `estilo` takes several tags (`rap,boombap`; `boom bap` and `lo-fi` also work), `tonalidad` accepts `Am` / `A minor` / `La menor`, `q` ignores case and accents |
| GET | `/piezas/:id` | One piece |
| POST | `/piezas` | Create an original piece (id is generated). *Extra* |
| POST | `/piezas/:id/fork` | Body optional `{ "autor", "nombre" }`. Returns the new piece (`201`) with `parent_id` |
| PUT | `/piezas/:id` | `{ "notas": [...] }` replaces the notes; also accepts `nombre`, `tonalidad`, `tempo`, `estilo`, `compases`. Lineage fields (`autor`, `tipo`, `licencia`, `parent_id`) cannot change |
| GET | `/piezas/:id/diff/:otra` | `{ original, modificada, nuevas, borradas, movidas, iguales }`. `:id` is the modified piece; if one piece is an ancestor of the other, the ancestor is always the original, whatever the order |
| GET | `/piezas/:id/diff` | Same, against the piece's parent. *Extra* |
| GET | `/canciones` | All songs. *Extra* |
| GET | `/canciones/:id` | One song. *Extra* |
| POST | `/canciones` | Create a song (contract 4.2 without `id`). Every `pieza_id` must exist. *Extra* |
| PUT | `/canciones/:id` | Replace name, tempo, tracks and blocks. *Extra* |
| GET | `/canciones/:id/arbol` | `{ nodos, aristas }` plus `cancion` and `resumen` (see below) |
| POST | `/copiloto` | `{ "mensaje", "cancion": Cancion \| null }` → `{ "texto", "piezas_sugeridas" }` |

Routes marked *Extra* are not in the contract table; they are needed so songs can be saved and the tree can be built.

### Extra fields (additions only, contract fields unchanged)

- Diff: `original` and `modificada` say which piece played each role.
- Tree nodes: `fuente` (attribution) and `en_cancion` (`true` if the piece is used directly in the song, `false` if
  it is only an ancestor). The response also has `cancion: { id, nombre, autor }` (to highlight the user's pieces)
  and `resumen: { piezas, autores }` ("this song has N pieces by M authors").

### Diff rules

Following `CLAUDE.md` section 5: notes with the same `(tono, inicio)` are `iguales`; then the same pitch at another
time, or the same onset with another pitch, are `movidas` (closest first, at most 4 beats or 12 semitones away);
the rest are `nuevas` / `borradas`. A change of only `duracion` or `velocidad` still counts as `iguales`.

## Database schema

`src/db/schema.sql`:

- `piezas`: one row per piece. `estilo` and `notas` are JSONB columns (GIN index on `estilo`); `parent_id`
  references another piece (fork). `busqueda` is normalized text used by `?q=`.
- `canciones`: name, author, tempo.
- `pistas`: tracks of a song (`cancion_id`, `posicion`, `instrumento`).
- `bloques`: a piece placed on a track at bar `compas`.

The lineage tree is a recursive query that walks `parent_id` up from every piece used in the song.

## Deploy (Vercel + TigerData)

1. **TigerData**: create an account (30-day free trial, no card) and a PostgreSQL/TimescaleDB service in a European
   region. Save the password shown at creation and copy the connection string.
2. **Load the schema and seed data** from your computer: put the connection string in `backend/.env` as
   `DATABASE_URL` (change `sslmode=require` to `sslmode=verify-full`), then run `npm run db:init` and
   `npm run db:seed`. Comment `DATABASE_URL` out afterwards so local development goes back to PGlite.
   If the connection fails with a certificate error, use `sslmode=require&uselibpqcompat=true` instead.
3. **Vercel**: import the GitHub repo as a new project with **Root Directory = `backend`** (framework preset
   "Other"). Add the environment variables `DATABASE_URL` (the pooled connection string if TigerData offers one)
   and `ANTHROPIC_API_KEY`. `vercel.json` sends every request to `api/index.js`, which exports the Express app.
4. The frontend is a separate Vercel project (Root Directory = `frontend`) with `VITE_API_URL` set to the backend URL.
   CORS is open to every origin.

## Copilot

- Model: `claude-opus-5-5` (low effort, short answers), tools in `src/copilot/tools.js`, style traits in
  `src/copilot/styles.js`, system prompt in `src/copilot/systemPrompt.js` (role C can edit these two freely).
- The final answer is forced into JSON (`texto`, `piezas_sugeridas`) with structured outputs, and suggested ids are
  checked against the database before being returned, so it can never suggest a piece that does not exist.
- Server-side fallback is on (`fallbacks: "default"`): if a safety classifier wrongly declines a request, the API
  retries it on a fallback model instead of failing.
