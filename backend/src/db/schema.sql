-- Lineage database schema (SQLite / libSQL / Turso).
-- Column names follow the shared contracts in CLAUDE.md (section 4).
-- Apply with: npm run db:init   (or npm run db:reset to drop + recreate + seed)

-- A reusable musical piece (short MIDI fragment).
CREATE TABLE IF NOT EXISTS piezas (
  id          TEXT PRIMARY KEY,                      -- "p-017"
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ritmo', 'acordes', 'melodia', 'bajo')),
  autor       TEXT NOT NULL,
  licencia    TEXT NOT NULL,
  fuente      TEXT NOT NULL DEFAULT '',
  tonalidad   TEXT,                                  -- "Am", "C", "F#m"... NULL for drums
  tempo       REAL NOT NULL DEFAULT 96,              -- BPM (quarter notes)
  estilo      TEXT NOT NULL DEFAULT '[]',            -- JSON array of tags: ["salsa","romantica"]
  compases    INTEGER NOT NULL DEFAULT 4 CHECK (compases > 0),
  parent_id   TEXT REFERENCES piezas(id),            -- NULL = original, otherwise the forked piece
  notas       TEXT NOT NULL DEFAULT '[]',            -- JSON array of notes, times in beats
  busqueda    TEXT NOT NULL DEFAULT '',              -- normalized text for ?q= (lowercase, no accents)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_piezas_tipo      ON piezas(tipo);
CREATE INDEX IF NOT EXISTS idx_piezas_tonalidad ON piezas(tonalidad);
CREATE INDEX IF NOT EXISTS idx_piezas_parent    ON piezas(parent_id);

-- A song: an arrangement of pieces on tracks.
CREATE TABLE IF NOT EXISTS canciones (
  id          TEXT PRIMARY KEY,                      -- "c-001"
  nombre      TEXT NOT NULL,
  autor       TEXT NOT NULL,
  tempo       REAL NOT NULL DEFAULT 96,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tracks of a song, ordered by posicion (0, 1, 2...).
CREATE TABLE IF NOT EXISTS pistas (
  cancion_id  TEXT NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  posicion    INTEGER NOT NULL,
  instrumento TEXT NOT NULL,
  PRIMARY KEY (cancion_id, posicion)
);

-- A piece placed on a track, starting at bar `compas`.
CREATE TABLE IF NOT EXISTS bloques (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cancion_id      TEXT NOT NULL,
  pista_posicion  INTEGER NOT NULL,
  pieza_id        TEXT NOT NULL REFERENCES piezas(id),
  compas          INTEGER NOT NULL CHECK (compas >= 0),
  FOREIGN KEY (cancion_id, pista_posicion) REFERENCES pistas(cancion_id, posicion) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bloques_cancion ON bloques(cancion_id);
CREATE INDEX IF NOT EXISTS idx_bloques_pieza   ON bloques(pieza_id);
