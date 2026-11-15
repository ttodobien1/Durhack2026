# Data

Seed data loaded into the database with `npm run db:seed` (or `npm run db:reset`) from `backend/`.

| Folder | Contents |
| --- | --- |
| `piezas/` | One JSON file per piece, following contract 4.1 in `CLAUDE.md` (a file may also hold an array of pieces). |
| `canciones/` | Demo songs, following contract 4.2. |
| `midi/` | Source MIDI files and the manifest used to convert them into `piezas/`. |

> **The current pieces (`p-001` to `p-015`) and `c-001` are placeholders** so the API and the frontend can work
> before the real seed pieces exist. Their `fuente` says so. Replace or overwrite them (same ids is fine).

## Rules for pieces

- `id` is required in seed files (`p-001`, `p-002`, ...). Forks need `parent_id` pointing to a piece that exists.
- `inicio` and `duracion` are in beats (quarter notes), never seconds. `velocidad` is 0-1.
- `tipo` is one of `ritmo`, `acordes`, `melodia`, `bajo`.
- `estilo` tags are stored lowercase, without accents or hyphens (`"romántica"` → `"romantica"`, `"lo-fi"` → `"lofi"`, `"boom bap"` → `"boombap"`).
- `tonalidad` is stored in short notation (`"La menor"` or `"A minor"` becomes `"Am"`). Use `null` for drums.
- Every imported piece needs `autor`, `licencia` and `fuente` (CC BY requires attribution). No melodies or lyrics from known songs.
  The one exception is `piezas/famous-melodies.json`: compositions in the **public domain** (Beethoven, Mozart, Bach,
  traditional songs...), transcribed by the team, so the "hum to DJ Stemy" demo has tunes everyone knows. Never add
  songs still under copyright (anything by a living or recently deceased composer, e.g. Queen).

## From MIDI to pieces

1. Put the `.mid` files in `data/midi/` (subfolders are fine).
2. Copy `midi/manifest.example.json` to `midi/manifest.json` and describe each file:
   - `archivo`: path relative to the manifest.
   - `desde_compas` / `compases`: cut bars out of a long file (0-based start bar).
   - `pista`: import a single track (default: all tracks merged).
   - `cuantizar`: snap to a grid in beats (`0.25` = sixteenth notes). Leave `null` to keep a human feel.
   - `tempo`: override the tempo stored in the file.
3. From `backend/`: `npm run import:midi -- --manifest ../data/midi/manifest.json`
4. Load them: `npm run db:seed`

Single file: `npm run import:midi -- ../data/midi/file.mid --id p-040 --nombre "..." --tipo ritmo --autor "..." --licencia "CC BY 4.0" --fuente "..."`
