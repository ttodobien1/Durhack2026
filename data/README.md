# Data

Seed data loaded into the database with `npm run db:seed` (or `npm run db:reset`) from `backend/`.

| Folder | Contents |
| --- | --- |
| `piezas/` | One JSON file per piece, following contract 4.1 in `CLAUDE.md` (a file may also hold an array of pieces). |
| `canciones/` | Demo songs, following contract 4.2. |
| `midi/` | Source MIDI files and the manifest used to convert them into `piezas/`. |

> **The current pieces (`p-001` to `p-015`) and `c-001` are placeholders** so the API and the frontend can work
> before the real seed pieces exist. Their `fuente` says so. Replace or overwrite them (same ids is fine).

## Generated loops (made by the team)

`piezas/stemma-generated.json` (`p-2001` to `p-2180`): 100 melodies, 40 chord loops and 40 bass lines for rap beats,
written by `scripts/generate_loops.py` (rule-based, deterministic: `python data/scripts/generate_loops.py`). They are
"created during the event" (CLAUDE.md section 6), author `Stemma generator`, CC BY 4.0, and `fuente` names the script.
Why: the imported collections were one-sided (the 431 free-midi-chords loops share one rhythm; there were few
melodies), so search, similarity and the copilot had little to work with. Melodies use 8 scales, all 12 keys and 9
rhythm feels; chords and bass use common rap / lo-fi progressions with varied rhythms. The seed (2027) was picked so
no generated melody nearly copies an existing piece (2026 produced a near-copy of "Mary Had a Little Lamb"), checked
with `backend/src/lib/fingerprint.js`. They have not been reviewed by ear yet: listen before relying on them in a demo.

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
