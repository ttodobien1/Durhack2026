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

-- Favourite pieces of each account (the star in the project Browser).
CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pieza_id    TEXT NOT NULL REFERENCES piezas(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, pieza_id)
);
`;
