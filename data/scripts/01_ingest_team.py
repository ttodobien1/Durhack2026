"""Stage 1 (team): pieces made by the Stemma team during DurHack, listed in a manifest.

Input:  data/team/manifest.json + the .mid files it lists (both committed to the repo)
Output: data/build/team/01_ingest.json

Each manifest entry describes ONE piece (see data/team/README.md):
    {"archivo": "bajo-am-1.mid", "autor": "cristobal", "tipo": "bajo",
     "tonalidad": "Am", "tempo": 90, "compases": 4,
     "nombre": "Walking bass in A minor", "estilo": ["rap", "boombap"]}

Rules: the author must be a real team member (no anonymous or invented authors),
the file must exist, and the declared tipo/compases must be valid. Each record
keeps the file's sha256 so the piece can be traced to the exact file.

--dir lets you run the stage on another folder (e.g. a test fixture).
"""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from common import SOURCE_DIRS, print_report, rel, stage_file, write_json
from contract import COMPASES, KEY_RE, TIPOS

OUTPUT = stage_file("team", "01_ingest")
FUENTE = "Created at DurHack 2026 by the Stemma team"


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest team-made MIDI pieces")
    parser.add_argument("--dir", type=Path, default=SOURCE_DIRS["team"])
    team_dir = parser.parse_args().dir
    manifest_path = team_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"ERROR: {manifest_path} not found (see data/team/README.md).")
    entries = json.loads(manifest_path.read_text(encoding="utf-8")).get("pieces", [])

    records, reasons, seen = [], Counter(), set()
    for i, e in enumerate(entries):
        archivo, autor = e.get("archivo"), (e.get("autor") or "").strip()
        if not autor:
            reasons["no autor (every team piece needs its real author)"] += 1
            continue
        if not archivo or not (team_dir / archivo).is_file():
            reasons["MIDI file missing"] += 1
            continue
        if e.get("tipo") not in TIPOS:
            reasons["tipo missing or invalid"] += 1
            continue
        # The key detector agrees with the true key only ~31% of the time on short loops
        # (tested on free-midi-chords), so non-drum pieces must declare their key.
        if e["tipo"] != "ritmo" and not KEY_RE.match(e.get("tonalidad") or ""):
            reasons["tonalidad missing or invalid (required for non-drum pieces)"] += 1
            continue
        if e.get("compases") not in COMPASES:
            reasons[f"compases must be one of {sorted(COMPASES)}"] += 1
            continue
        if archivo in seen:
            reasons["file listed twice"] += 1
            continue
        seen.add(archivo)
        records.append({
            "source": "team",
            "id": f"team/{archivo}",
            "author": autor,
            "style": "team",
            "genre": "team",
            "subgenre": None,
            "bpm": e.get("tempo", 90),
            "beat_type": "team",
            "time_signature": "4-4",
            "duration_s": 0.0,
            "midi_path": archivo,
            "declared_tipo": e["tipo"],
            "declared_compases": e["compases"],
            "key": e.get("tonalidad"),
            "nombre": e.get("nombre"),
            "estilo": e.get("estilo") or ["rap"],
            "fuente": e.get("fuente") or FUENTE,
            "file_sha256": hashlib.sha256((team_dir / archivo).read_bytes()).hexdigest(),
            "manifest_index": i,
        })

    write_json(OUTPUT, records)
    print_report("stage 1 (ingest team)", len(entries), len(records), reasons)
    print(f"authors: {dict(Counter(r['author'] for r in records))}")
    print(f"written:  {rel(OUTPUT)}")


if __name__ == "__main__":
    main()
