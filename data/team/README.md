# Team pieces

Short MIDI pieces made by the Stemma team during DurHack 2026: bass lines, melodies, chords or drums. They go
through the same pipeline as the imported collections and show up in the library with their real author.

## How to add a piece

1. Play or draw it in any DAW and export **one piece per `.mid` file**: 1, 2 or 4 bars of 4/4, starting on bar 1.
   Keep it in a key that fits the demo (A minor or C minor) at about 90 BPM.
2. Put the file in this folder.
3. Add an entry to `manifest.json`:

```json
{
 "pieces": [
  {
   "archivo": "bass-am-walk.mid",
   "autor": "cristobal",
   "tipo": "bajo",
   "tonalidad": "Am",
   "tempo": 90,
   "compases": 4,
   "nombre": "Walking bass in A minor",
   "estilo": ["rap", "boombap"]
  }
 ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `archivo` | yes | File name in this folder |
| `autor` | yes | Who made it (your name as it should appear in the origin tree) |
| `tipo` | yes | `ritmo`, `acordes`, `melodia` or `bajo` |
| `compases` | yes | 1, 2 or 4 |
| `tonalidad` | for non-drums | e.g. `Am`, `Cm`. Required: automatic key detection is unreliable on short loops |
| `tempo` | no | BPM you wrote it at (default 90) |
| `nombre` | no | Name shown in the app |
| `estilo` | no | Single-word tags, no hyphens (e.g. `boombap`, `lofi`) |

4. Run the pipeline: `.venv/bin/python data/scripts/run_pipeline.py --source team`.
   It writes `data/piezas/team.json`, `data/provenance/team.json` (with each file's sha256) and updates `data/FUENTES.md`.

## Rules

- **Only your own material.** No melodies, riffs or lyrics from existing songs, and no output from AI music generators.
  Common chord progressions are fine.
- Licence: **CC BY 4.0**, credited to the author you write in `autor`.
