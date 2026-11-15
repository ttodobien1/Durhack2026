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
| GET | `/health` | Database type and row counts (pieces, songs, accounts) |
| GET | `/piezas?estilo=&tipo=&tonalidad=&q=&autor=` | All filters optional. `estilo` takes several tags (`rap,boombap`; `boom bap` and `lo-fi` also work), `tonalidad` accepts `Am` / `A minor` / `La menor`, `q` ignores case and accents |
| GET | `/piezas/:id` | One piece |
| GET | `/piezas/:id/parecidas?n=8` | Public pieces of the same type that sound most like this one (musical fingerprint, see below), closest first, each with `similitud` 0-100. *Extra* |
| POST | `/piezas/parecidas` | `{ tipo, notas, id?, parent_id?, autor? }` (notes need not be saved) -> `{ parecidas, aviso }`. `aviso` is a public **melody** by someone else, outside the piece's fork family, that these notes nearly copy (also transposed, inverted, shifted or as a 2-bar excerpt), else `null`. *Extra* |
| POST | `/piezas` | Create an original piece (id is generated). `"publica": false` (logged in) keeps it private until it is saved in a public project. *Extra* |
| POST | `/piezas/:id/fork` | Body optional `{ "autor", "nombre" }`. Returns the new piece (`201`) with `parent_id` |
| PUT | `/piezas/:id` | `{ "notas": [...] }` replaces the notes; also accepts `nombre`, `tonalidad`, `tempo`, `estilo`, `compases`. Lineage fields (`autor`, `tipo`, `licencia`, `parent_id`) cannot change |
| GET | `/piezas/:id/diff/:otra` | `{ original, modificada, nuevas, borradas, movidas, iguales }`. `:id` is the modified piece; if one piece is an ancestor of the other, the ancestor is always the original, whatever the order |
| GET | `/piezas/:id/diff` | Same, against the piece's parent. *Extra* |
| GET | `/canciones?autor=` | Public songs; with `autor`, every song by that author, private ones included. *Extra* |
| GET | `/canciones/:id` | One song. *Extra* |
| POST | `/canciones` | Create a song (contract 4.2 without `id`, plus optional `publica`, default `true`, `descripcion`, up to 300 characters, and `mensaje`). Every `pieza_id` must exist. With `parent_id` (+ optional `parent_version`) it is a fork of that project. Records v1. *Extra* |
| PUT | `/canciones/:id` | Replace name, tempo, visibility (`publica`), tracks and blocks; optional `mensaje`. Records a new version when the music changed. `descripcion` is replaced when sent (`""` clears it) and kept when left out. *Extra* |
| DELETE | `/canciones/:id` | Move the song (project) to the trash (`204`). It disappears from every list and route. Allowed for its owner account and, for songs with no owner (saved before accounts existed or signed out), for the account whose username is the song's `autor` or when `autor` is `"you"`; trashing such a song makes that account its owner (and its author, if it was `"you"`). *Extra* |
| GET | `/canciones/papelera` | The logged-in account's songs in the trash, newest first, each with `borrada` and `se_borra` (ISO dates; 20 days apart). *Extra* |
| POST | `/canciones/:id/restaurar` | Take a song out of the trash; returns it. *Extra* |
| DELETE | `/canciones/papelera/:id` | Delete a song in the trash for good (`204`): its tracks and versions go with it; projects forked from it stay, as originals. *Extra* |
| GET | `/canciones/comunidad` | Home page: `{ populares, ayuda }`, the 6 most popular public projects (3 × forks + 2 × comments + proposals) and the open help requests. *Extra* |
| GET | `/canciones/compartidas` | Projects the logged-in account collaborates on. *Extra* |
| PATCH | `/canciones/:id/ajustes` | Author only: `{ permite_fork?, permite_propuestas?, pide_ayuda? }` (`pide_ayuda: null` removes the help request). Returns the song. *Extra* |
| GET | `/canciones/:id/arbol` | `{ nodos, aristas }` plus `cancion` and `resumen` (see below) |
| POST | `/copiloto` | `{ "mensaje", "cancion": Cancion \| null }` → `{ "texto", "piezas_sugeridas" }`. Optional `historial` (earlier chat messages) and `tarareo` (a humming as notes), see [Hum to DJ Stemy](#hum-to-dj-stemy) |
| GET | `/usos?piezas=&canciones=` | Reuse counters (popularity) for up to 200 ids each: `{ piezas: { id: { canciones, forks, total } }, canciones: { id: { forks, total } } }`. *Extra* |
| GET | `/piezas/:id/usos` | Where a piece is reused: `{ id, total, canciones: { total, lista }, forks: { total, lista } }`. Totals count everything; the lists name only what the viewer may open. *Extra* |

Routes marked *Extra* are not in the contract table; they are needed so songs can be saved and the tree can be built.

### Extra fields (additions only, contract fields unchanged)

- Diff: `original` and `modificada` say which piece played each role.
- Tree nodes: `fuente` (attribution) and `en_cancion` (`true` if the piece is used directly in the song, `false` if
  it is only an ancestor). The response also has `cancion: { id, nombre, autor }` (to highlight the user's pieces)
  and `resumen: { piezas, autores }` ("this song has N pieces by M authors").
- Songs: `version` (latest version number, `0` if none yet), `parent_id` and `parent_version` (the project and version
  it was forked from, `null` for originals). `PUT` ignores them: the fork origin never changes.

### Diff rules

Following `CLAUDE.md` section 5: notes with the same `(tono, inicio)` are `iguales`; then the same pitch at another
time, or the same onset with another pitch, are `movidas` (closest first, at most 4 beats or 12 semitones away);
the rest are `nuevas` / `borradas`. A change of only `duracion` or `velocidad` still counts as `iguales`.

## Project history (versions, diff, merge, credits)

Every save of a song is a version (v1, v2...), like a commit: a snapshot of the arrangement plus the notes of every
piece it used at that moment, so any two versions can be compared later. Songs also have their own forks: saving
someone else's project as a copy (`POST /canciones` with `parent_id`) records which project and version it came from.

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/canciones/:id/versiones[?snapshots=1]` | `{ cancion, origen, versiones }`, newest first. With `snapshots=1`, the newest 40 versions and the fork point (`origen.snapshot`) carry their full snapshot (the frontend draws the version tree from them). Each version: `numero`, `autor`, `mensaje` (written in the Save window or generated, e.g. "Edited Montuno (fork), tempo 90 → 96 BPM"), `fecha`, `merge`, a change `resumen` and the `piezas` it touched |
| GET | `/canciones/:id/versiones/:n` | One version with its full `snapshot` (to open it in the editor) |
| GET | `/canciones/:id/versiones/:n/diff[?contra=m]` | What version n changed: against `m`, or by default the version before (for v1 of a fork, the original at the fork point). `{ desde, hasta, nombre, tempo, pistas, piezas, resumen }` |
| GET | `/canciones/:id/forks` | `{ parent, forks }`: the project it was forked from and the projects forked from it |
| GET | `/canciones/:id/merge/:otra` | Merge preview of `:otra` into `:id`: `{ base, mio, suyo, conflictos, choques, cambios, resultado }` |
| POST | `/canciones/:id/merge/:otra/preview` | Same, with `{ "resoluciones": { "<conflict id>": "mio" \| "suyo" } }` |
| POST | `/canciones/:id/merge/:otra` | Apply the merge (owner of `:id` only): body `{ resoluciones?, mensaje? }` → `{ cancion, version }` |
| GET | `/canciones/:id/creditos` | Who made what: `{ total_notas, autores: [{ autor, notas, porcentaje, piezas: [{ rol }], versiones, merges }], piezas: [{ notas: [{ ..., autor }] }] }` |

- **Diff** (`src/lib/songDiff.js`): tracks have no ids, so both sides' tracks are matched by content (instrument,
  position, blocks at the same bar). Tracks come out as `nueva` / `borrada` / `cambiada` with the blocks added and
  removed. Pieces come out as `agregada` / `quitada` / `editada` (same id, other notes) / `reemplazada` (a fork took
  the place of its original), each with the note diff from section 5.
- **Merge** (`src/lib/songMerge.js`), a three-way merge like git. The base is the latest common point between the two
  projects: the fork point, or their last merge. A change made by only one side is applied, and the same change on
  both sides is applied once. Conflicts, each with an id that depends only on content:
  - `tempo`: both changed the tempo.
  - `instrumento`: both changed the instrument of the same track.
  - `bloque`: both placed new blocks over the same bars of a track.
  - `pista`: one side deleted a track the other changed.

  `choques` lists harmonic clashes the merge would create: notes a minor second apart sounding together on two
  pitched tracks, one from each project. Only a project and its forks (or its original) can be merged (`400`
  otherwise), and a merge always records a version with `merge` set, so the next merge starts from there.
- **Credits** (`src/lib/credits.js`) work like `git blame` for notes. A note of a fork that is also in its parent
  (same `tono` and `inicio`) is credited up the chain to whoever wrote it first; added or moved notes belong to the
  fork's author. Each note counts every time it plays in the song.
- Privacy: everything follows the song's visibility (`404` for someone else's private song). If the original of a
  fork becomes private, the fork's history stops showing it.
- Songs saved before versions existed get their current state as v1 the first time their history is read or they are
  saved. `npm run db:seed` records a version for the seed songs.

## Connections (comments, collaborators, proposals, messages)

All extras (cambios.md §14). Everything that writes needs an account.

| Method | Route | What it does |
| --- | --- | --- |
| GET | `/canciones/:id/colaboradores` | `{ autor, rol, colaboradores: [{ nombre, desde }], invitacion }` (`invitacion` `{ token, expira }` only for the author) |
| POST | `/canciones/:id/invitacion` | Author: a new invitation link (7 days); the previous one stops working → `{ token, expira }` |
| DELETE | `/canciones/:id/invitacion` | Author: turn the link off |
| DELETE | `/canciones/:id/colaboradores/:nombre` | The author removes a collaborator, or a collaborator leaves |
| GET | `/invitaciones/:token` | `{ cancion: { id, nombre, autor, publica }, expira, rol }` |
| POST | `/invitaciones/:token/aceptar` | Join as a collaborator → `{ cancion_id, rol }` |
| GET | `/canciones/:id/propuestas` | Proposals (pull requests) to a project, open ones first |
| POST | `/canciones/:id/propuestas` | `{ titulo, mensaje?, desde_id }` (your fork of it) or `{ titulo, mensaje?, cancion }` (the edited project, saved as a new private copy) → `201 { propuesta, copia }`. Needs `permite_propuestas`; the copy's pieces must be public; the author gets a message |
| PATCH | `/canciones/:id/propuestas/:pid` | `{ estado: "rechazada" }` (author / collaborators) or `"retirada"` (its author). Merging the copy closes it as `"aceptada"` |
| GET | `/comentarios?objetivo=cancion\|pieza&id=` | Comments of something you can see, oldest first |
| POST | `/comentarios` | `{ objetivo, id, texto }` → `201` |
| DELETE | `/comentarios/:id` | The comment's author, or the author of the project / piece |
| GET | `/mensajes` | Conversations, one per person: `[{ con, ultimo, sin_leer, bloqueado }]` |
| GET | `/mensajes/con/:nombre` | `{ con, bloqueado, puedes_escribir, motivo, mensajes }` (marks them as read) |
| GET | `/mensajes/sin-leer` | `{ sin_leer }` |
| POST | `/mensajes` | `{ para, asunto?, texto, cancion_id? }` → `201 { id }`; `403` with the reason when blocked or not accepted |
| GET / PUT | `/mensajes/ajustes` | `{ mensajes_de: "todos" \| "contactos" \| "nadie", bloqueados }` |
| PUT / DELETE | `/mensajes/bloqueos/:nombre` | Block / unblock (`204`) |

- **Who sees a project:** public ones, everyone; private ones, their author, their collaborators and the reviewers of
  a proposal made from them. `GET /canciones/:id` adds `rol` (`"autor"`, `"colaborador"` or `null`).
- **Who edits it:** the owner account and its collaborators (`PUT`, merge). Collaborators never change `publica`,
  `descripcion` nor the settings, and cannot delete the project.
- **Forks:** `POST /canciones` with `parent_id` is a `403` when the author turned copies off (`permite_fork: false`).
- **Piece visibility:** `PUT /piezas/:id { publica }`. A public project can only use public pieces (saving no longer
  publishes them). A piece cannot go private while a public project uses it, other people's projects use it or their
  forks come from it (`409` with the reason). Private pieces open for their author and for the owner and
  collaborators of a project that uses them.
- **Messages:** `mensajes_de` = who may write to you: `todos`, `contactos` (people you wrote to or share a project
  with) or `nadie`. A blocked account cannot write to you nor propose changes to your projects.

## Accounts

Email + password accounts stored in the database (no third-party auth service).

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/auth/registro` | `{ "nombre", "email", "password" }` → `201 { usuario, token }`. `nombre`: 2-24 letters, numbers, `-`, `_` (case-insensitive unique; `you`, `yours`, `anonymous` are reserved). Password 6+ characters. `409` if the username or email is taken |
| POST | `/auth/login` | `{ "usuario": username or email, "password" }` → `{ usuario, token }`; `401` if wrong |
| POST | `/auth/logout` | Ends the session of the token sent → `204` |
| GET | `/auth/yo` | The logged-in account `{ usuario: { id, nombre, email, perfil, creado } }` |
| PUT | `/auth/yo` | `{ "perfil": { displayName, bio, location, website, readme, accent, avatar, pinned } }` saves the public profile (`avatar` is an image `data:` URL up to 300 KB) |
| GET | `/usuarios/:nombre` | Public profile `{ nombre, perfil, creado }` (never the email) |
| GET | `/auth/yo/favoritos` | Ids of the account's favorite pieces `["p-017", ...]`, most recently starred first. Only pieces it can still see (public or its own) |
| PUT | `/auth/yo/favoritos/:piezaId` | Stars a piece → `204` (idempotent); `404` if the piece does not exist or is someone else's private piece |
| DELETE | `/auth/yo/favoritos/:piezaId` | Un-stars a piece → `204` (idempotent) |

- Send the token as `Authorization: Bearer <token>`. Sessions last 30 days; only a SHA-256 hash of the token is
  stored. A wrong or expired token gets `401` on any route, so the client knows to log in again.
- Passwords are hashed with scrypt (Node's built-in `crypto`), never stored or logged in clear text.
- **Logged in**, forks, new pieces and new songs are authored by the account (`autor` = username, whatever the body
  says) and owned by it: only that account can `PUT` them (`401` without a token, `403` with another account's).
- **Signed out** works as before: `autor` comes from the body (`"anonymous"` if missing), except a registered
  username (`401`: log in to publish as them). Seed data and anonymous work have no owner and stay editable by anyone.
- `PUT /canciones/:id` never changes a song's `autor`.
- **Private pieces**: pieces created with `"publica": false` (the editor's "+") are only seen, searched, forked and
  used in songs by their author, and by the owner and collaborators of a project that uses them (`404` / "Unknown
  pieza_id" for everyone else). A public song cannot use them: their author makes them public first
  (`PUT /piezas/:id { publica: true }`, see Connections). Seed data, uploads and forks of public pieces are public.
  Pieces carry `publica`.
- No email verification or password reset (they would need an email-sending service).

## Database schema

`src/db/schema.js` (idempotent SQL; `npm run db:init` applies it, and the server applies it by itself on the first
request if tables or columns are missing, so deploys never need a manual migration):

- `piezas` (`publica`: false while only its author sees it): one row per piece. `estilo` and `notas` are JSONB columns (GIN index on `estilo`); `parent_id`
  references another piece (fork). `busqueda` is normalized text used by `?q=`. `usuario_id`: owner account.
- `canciones`: name, author, tempo, `usuario_id` (owner account), `publica` (visibility like a GitHub repo: a private song is listed and opened only by its author's account), `descripcion` (optional, shown on project cards), `borrada_at` (set while the song is in the trash; after 20 days the server deletes the row, lazily, from `GET /canciones` and `GET /canciones/papelera`, since Vercel has no cron).
- `pistas`: tracks of a song (`cancion_id`, `posicion`, `instrumento`).
- `bloques`: a piece placed on a track at bar `compas`.
- `usuarios`: accounts (`nombre`, `email`, `password_hash`, `perfil` JSONB).
- `sesiones`: login sessions (`token_hash`, `usuario_id`, `expires_at`).
- `favoritos`: favorite pieces of each account (`usuario_id`, `pieza_id`, `created_at`); removed with the account or the piece.
- `versiones`: song versions (`cancion_id`, `numero`, `autor`, `mensaje`, `snapshot` JSONB, `merge_de`/`merge_version`).
- `comentarios` (`objetivo` cancion/pieza, `objetivo_id`, `usuario_id`, `texto`), `colaboradores` (`cancion_id`,
  `usuario_id`), `invitaciones` (one link per song: `token`, `expires_at`), `propuestas` (`cancion_id` ← `desde_id`,
  `titulo`, `mensaje`, `estado`), `mensajes` (`de_id`, `para_id`, `asunto`, `texto`, `cancion_id`, `leido_at`),
  `bloqueos` (`usuario_id`, `bloqueado_id`). `canciones.permite_fork` / `permite_propuestas` / `pide_ayuda` /
  `pide_ayuda_at` and `usuarios.mensajes_de`.
  `canciones.parent_id` / `parent_version`: the project and version a song was forked from.

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
5. With Vercel's Git integration, every push to the production branch (`main` by default) redeploys both projects;
   other branches get preview URLs. Schema changes are applied by the server itself on the first request after the
   deploy; seed data still needs `npm run db:seed`.

## Hum to DJ Stemy

The user hums a melody into the microphone; the browser turns it into notes (`frontend/src/hum.js`: YIN pitch
detection, note splitting, the singer's own tuning, a 16th-note grid at the project tempo). Audio never reaches the
server, only the notes:

```json
POST /copiloto
{
  "mensaje": "Here's the melody I have in mind. Find pieces like it.",
  "cancion": null,
  "historial": [{ "de": "usuario", "texto": "a lo-fi beat with piano" }, { "de": "stemy", "texto": "..." }],
  "tarareo": { "notas": [{ "tono": 64, "inicio": 0, "duracion": 0.25, "velocidad": 0.8 }, ...] }
}
```

- `src/lib/melody.js` compares the humming with every public `melodia` piece: intervals between notes (any key) and
  note lengths relative to each other (any tempo), with local alignment (a fragment, a missing or extra note, repeated
  notes merged into one). It returns a similarity from 0 to 1 and the transposition.
- Stemma decides the verdict itself (`src/copilot/hum.js`, `verdict`): **coincide** (the humming is that piece: 60%
  or more and 10 points ahead of the next melody, or 80% or more), **parecido** (it reminds of it: 45% or more) or
  **ninguno**. The copilot is told the verdict in plain words and searches for chords, bass and drums in the humming's
  key; the matched melody is always the first suggestion. If the model's answer denies a clear match or never names
  the melody, it is replaced by Stemma's own answer. Without an API key, or if the model fails, the server answers by
  itself the same way, so the demo never stops. The response's `tarareo.veredicto` carries the verdict.
- Extra response field: `tarareo: { tonalidad, notas, coincidencias: [{ id, nombre, autor, licencia, similitud, transponer }] }`.
- `historial` (up to 10 messages, oldest first) works on every request: DJ Stemy remembers what was said before.
- `data/piezas/famous-melodies.json` (`p-501` to `p-514`): public-domain melodies everyone can hum (Für Elise, Ode to
  Joy, Twinkle Twinkle, Happy Birthday, Jingle Bells, Beethoven's 5th, Eine kleine Nachtmusik, Canon in D, Frère
  Jacques, Mary Had a Little Lamb, Bridal Chorus, In the Hall of the Mountain King, Greensleeves, Toccata and Fugue).

## Musical fingerprints (similar pieces and the "too close" warning)

- `src/lib/fingerprint.js`: the magnitudes of the DFT of a piece's pitch-class profile (6 numbers) and of its 16-step
  onset grid (8 numbers); drums get one onset fingerprint per voice (kick, snare, hats, other percussion: 32 numbers).
  Magnitudes do not change under transposition, inversion or a time shift (Lewin / Quinn / Amiot), so a copy in
  another key or starting on another beat matches. Pure functions with tests in `test/fingerprint.test.js`.
- `src/repo/similares.js` keeps the fingerprints of the public library in memory (cleared on piece writes, refreshed
  at least every 30 s). `similitud` is 100 for the same notes and 0 for two typical pieces of that type (the median
  distance, per type).
- The warning (`aviso`) is for **melodies only**: CLAUDE.md section 6 lets anyone reuse progressions and basic
  rhythms, and the pitch fingerprint cannot tell chord order apart (i-iv-V7 and ii-V-i in A minor look the same).
  It compares 2-bar windows too, since copies are usually excerpts. Threshold: distance < 0.15 (two changed notes in
  a melody are about 0.09; different authors' nearest melodies are 0.3 or more apart in this library).

## Copilot

- Model: `claude-opus-5-5` (low effort, short answers), tools in `src/copilot/tools.js`, style traits in
  `src/copilot/styles.js`, system prompt in `src/copilot/systemPrompt.js` (role C can edit these two freely).
- The final answer is forced into JSON (`texto`, `piezas_sugeridas`) with structured outputs, and suggested ids are
  checked against the database before being returned, so it can never suggest a piece that does not exist.
- `buscar_piezas` takes an optional `parecido_a` (a piece id): results are the pieces that sound most like it, by
  musical fingerprint, each with `similitud`; the other filters still apply. Still the two tools of CLAUDE.md 4.4.
- Server-side fallback is on (`fallbacks: "default"`): if a safety classifier wrongly declines a request, the API
  retries it on a fallback model instead of failing.
