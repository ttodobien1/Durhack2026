// Stemma database schema (PostgreSQL: TigerData in production, PGlite locally).
// Column names follow the shared contracts in CLAUDE.md (section 4).
// Every statement is idempotent, so it can run on an existing database: `npm run db:init` applies it, and the
// server applies it by itself when it finds tables or columns missing (see migrate.js), so a deploy never
// needs a manual migration.
// It lives in a JS module (not a .sql file) so Vercel always bundles it with the function.

export const SCHEMA = /* sql */ `
-- A reusable musical piece (short MIDI fragment).
CREATE TABLE IF NOT EXISTS piezas (
  id          TEXT PRIMARY KEY,                      -- "p-017"
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ritmo', 'acordes', 'melodia', 'bajo')),
  autor       TEXT NOT NULL,
  licencia    TEXT NOT NULL,
  fuente      TEXT NOT NULL DEFAULT '',
  tonalidad   TEXT,                                  -- "Am", "C", "F#m"... NULL for drums
  tempo       DOUBLE PRECISION NOT NULL DEFAULT 96,  -- BPM (quarter notes)
  estilo      JSONB NOT NULL DEFAULT '[]',           -- tags: ["rap","boombap"]
  compases    INTEGER NOT NULL DEFAULT 4 CHECK (compases > 0),
  parent_id   TEXT REFERENCES piezas(id),            -- NULL = original, otherwise the forked piece
  notas       JSONB NOT NULL DEFAULT '[]',           -- notes, times in beats
  busqueda    TEXT NOT NULL DEFAULT '',              -- normalized text for ?q= (lowercase, no accents)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_piezas_tipo      ON piezas (tipo);
CREATE INDEX IF NOT EXISTS idx_piezas_tonalidad ON piezas (tonalidad);
CREATE INDEX IF NOT EXISTS idx_piezas_parent    ON piezas (parent_id);
CREATE INDEX IF NOT EXISTS idx_piezas_estilo    ON piezas USING GIN (estilo);

-- A song: an arrangement of pieces on tracks.
CREATE TABLE IF NOT EXISTS canciones (
  id          TEXT PRIMARY KEY,                      -- "c-001"
  nombre      TEXT NOT NULL,
  autor       TEXT NOT NULL,
  tempo       DOUBLE PRECISION NOT NULL DEFAULT 96,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Visibility, like a GitHub repo: a private song is listed and opened only by its author's account.
-- An ALTER so databases created before the column existed get it too (see migrate.js).
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS publica BOOLEAN NOT NULL DEFAULT true;
-- Short description shown on project cards (GitHub's repository description). NULL = none written.
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- Tracks of a song, ordered by posicion (0, 1, 2...).
CREATE TABLE IF NOT EXISTS pistas (
  cancion_id  TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  posicion    INTEGER NOT NULL,
  instrumento TEXT NOT NULL,
  PRIMARY KEY (cancion_id, posicion)
);

-- A piece placed on a track, starting at bar \`compas\`.
CREATE TABLE IF NOT EXISTS bloques (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cancion_id      TEXT NOT NULL,
  pista_posicion  INTEGER NOT NULL,
  pieza_id        TEXT NOT NULL REFERENCES piezas(id),
  compas          INTEGER NOT NULL CHECK (compas >= 0),
  FOREIGN KEY (cancion_id, pista_posicion) REFERENCES pistas (cancion_id, posicion) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bloques_cancion ON bloques (cancion_id);
CREATE INDEX IF NOT EXISTS idx_bloques_pieza   ON bloques (pieza_id);

-- User accounts. \`nombre\` is the username and also the \`autor\` of everything they publish.
CREATE TABLE IF NOT EXISTS usuarios (
  id             TEXT PRIMARY KEY,                   -- "u-3f9a1c2b7d10" (random)
  nombre         TEXT NOT NULL,
  email          TEXT NOT NULL,                      -- stored lowercase
  password_hash  TEXT NOT NULL,                      -- scrypt$N$r$p$salt$hash
  perfil         JSONB NOT NULL DEFAULT '{}',        -- public profile: bio, readme, avatar, accent, pins...
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_nombre ON usuarios (lower(nombre));
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email  ON usuarios (lower(email));

-- Login sessions. Only a SHA-256 hash of each token is stored.
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones (usuario_id);

-- Owner account of pieces and songs created while logged in (NULL = seed data or anonymous).
ALTER TABLE piezas    ADD COLUMN IF NOT EXISTS usuario_id TEXT REFERENCES usuarios(id);
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS usuario_id TEXT REFERENCES usuarios(id);

-- Piece visibility: a piece created in the editor ("+" on a track) starts private, seen only by its author, and
-- becomes public as soon as it is saved in a public project. Everything else (seed data, uploads, forks of public
-- pieces) is public.
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS publica BOOLEAN NOT NULL DEFAULT true;

-- Project lineage: a song saved as a copy of another one is a fork of it, made from its version parent_version.
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES canciones(id);
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS parent_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_canciones_parent ON canciones (parent_id);

-- Trash: deleting a song only sets borrada_at. It disappears from every list and route, its author can restore it
-- from the trash for 20 days, and after that it is removed for good (repo/canciones.js, purgeExpiredCanciones).
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS borrada_at TIMESTAMPTZ;

-- Versions of a song (v1, v2...), like commits: a full snapshot each time it is saved, with the notes of
-- every piece it used at that moment, so any two versions can be compared later.
CREATE TABLE IF NOT EXISTS versiones (
  cancion_id     TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL,                   -- 1, 2, 3...
  autor          TEXT NOT NULL,                      -- who saved it
  mensaje        TEXT NOT NULL DEFAULT '',           -- what changed (written by the author or generated)
  snapshot       JSONB NOT NULL,                     -- { nombre, tempo, pistas, piezas: { id: {nombre, autor, tipo, licencia, parent_id, compases, notas} } }
  merge_de       TEXT,                               -- merge versions: the song merged in...
  merge_version  INTEGER,                            -- ...and which of its versions
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cancion_id, numero)
);

-- Connections (cambios.md §14) ------------------------------------------------------------------------

-- What the author of a public project lets others do with it: save their own copy (fork) and propose changes
-- (like a pull request). And a help request: "how can I move forward with this song?", shown on the home page.
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS permite_fork BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS permite_propuestas BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS pide_ayuda TEXT;
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS pide_ayuda_at TIMESTAMPTZ;

-- Comments on projects and pieces. objetivo_id is a canciones.id or a piezas.id (no foreign key: two tables).
CREATE TABLE IF NOT EXISTS comentarios (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  objetivo     TEXT NOT NULL CHECK (objetivo IN ('cancion', 'pieza')),
  objetivo_id  TEXT NOT NULL,
  usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comentarios_objetivo ON comentarios (objetivo, objetivo_id, created_at);

-- Collaborators of a project, like on GitHub: they open and edit it even when it is private.
CREATE TABLE IF NOT EXISTS colaboradores (
  cancion_id  TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cancion_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_usuario ON colaboradores (usuario_id);

-- The invitation link of a project (one at a time; making a new one replaces it). Whoever opens it while logged in
-- becomes a collaborator. Like a share link, the owner can copy it again, so the token is kept as it is.
CREATE TABLE IF NOT EXISTS invitaciones (
  cancion_id  TEXT PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  creada_por  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Proposed changes (pull requests): the copy desde_id, with someone's changes, offered to project cancion_id.
CREATE TABLE IF NOT EXISTS propuestas (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cancion_id   TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  desde_id     TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL,
  mensaje      TEXT NOT NULL DEFAULT '',
  estado       TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'aceptada', 'rechazada', 'retirada')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_propuestas_cancion ON propuestas (cancion_id);
CREATE INDEX IF NOT EXISTS idx_propuestas_desde ON propuestas (desde_id);

-- Messages between artists, like email (not a live chat). cancion_id: the project a message is about, if any.
CREATE TABLE IF NOT EXISTS mensajes (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  de_id       TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  para_id     TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  asunto      TEXT NOT NULL DEFAULT '',
  texto       TEXT NOT NULL,
  cancion_id  TEXT REFERENCES canciones(id) ON DELETE SET NULL,
  leido_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_para ON mensajes (para_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mensajes_de ON mensajes (de_id, created_at);

-- Blocked accounts: a blocked account cannot write to (nor propose changes to) the one who blocked it.
CREATE TABLE IF NOT EXISTS bloqueos (
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  bloqueado_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, bloqueado_id)
);
-- Who may write to an account: 'todos' (anyone), 'contactos' (people it wrote to or works with) or 'nadie'.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mensajes_de TEXT NOT NULL DEFAULT 'todos';

-- Favourite pieces of each account (the star in the project Browser).
CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pieza_id    TEXT NOT NULL REFERENCES piezas(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, pieza_id)
);

-- Plays, forks and saves over time (credits ledger, trending). A TimescaleDB hypertable on TigerData
-- (TIMESCALE_SCHEMA below); a plain table elsewhere. No IP or user agent is ever stored.
CREATE TABLE IF NOT EXISTS eventos (
  tiempo      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo        TEXT NOT NULL,                           -- 'reproduccion' | 'fork' | 'guardado'
  pieza_id    TEXT,
  cancion_id  TEXT,
  autor       TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_tiempo ON eventos (tiempo DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_pieza ON eventos (pieza_id, tiempo DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_cancion ON eventos (cancion_id, tiempo DESC);
`;

// pgvector (TigerData and PGlite both have it). Applied after SCHEMA and separately (migrate.js applyExtras): if a
// database refuses the extension, the app keeps working with in-memory similarity and keyword-only search.
//   huella:    musical fingerprint (lib/fingerprint.js), padded to 32 numbers for every type
//   embedding: Gemini text embedding of describePiece() (public pieces only); embedding_src: hash of that text
export const VECTOR_SCHEMA = /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS huella        vector(32);
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS embedding     vector(768);
ALTER TABLE piezas ADD COLUMN IF NOT EXISTS embedding_src text;
CREATE INDEX IF NOT EXISTS idx_piezas_huella    ON piezas USING hnsw (huella vector_l2_ops);
CREATE INDEX IF NOT EXISTS idx_piezas_embedding ON piezas USING hnsw (embedding vector_cosine_ops);
`;

// TimescaleDB, on TigerData only: the events table becomes a hypertable with an hourly continuous aggregate
// (real-time, so the last hour is included). Each statement runs on its own (a continuous aggregate cannot be
// created inside a multi-statement transaction); failures leave the plain table, which every query also handles.
export const TIMESCALE_STATEMENTS = [
  `SELECT create_hypertable('eventos', by_range('tiempo'), if_not_exists => true)`,
  `CREATE MATERIALIZED VIEW IF NOT EXISTS eventos_hora WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
     SELECT time_bucket('1 hour', tiempo) AS hora, tipo, pieza_id, count(*) AS n
     FROM eventos GROUP BY hora, tipo, pieza_id WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('eventos_hora', start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
     schedule_interval => INTERVAL '30 minutes', if_not_exists => true)`,
];
