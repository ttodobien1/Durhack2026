"""Stage 1: ingest Groove MIDI's info.csv into one clean record per MIDI file.

Input:  data/raw/groove/info.csv (+ the MIDI files it points to)
Output: data/build/groove/01_ingest.json

Each record:
  source, id, author, drummer, session, style, genre, subgenre, bpm, beat_type,
  time_signature, duration_s, midi_path (relative to data/raw/groove)
"""

import csv
from collections import Counter

from common import SOURCE_DIRS, print_report, rel, stage_file, write_json

GROOVE_DIR = SOURCE_DIRS["groove"]
OUTPUT = stage_file("groove", "01_ingest")


def parse_row(row: dict) -> dict:
    style = row["style"].strip()
    genre, _, subgenre = style.partition("/")
    return {
        "source": "groove",
        "id": row["id"].strip(),
        "author": row["drummer"].strip(),
        "drummer": row["drummer"].strip(),
        "session": row["session"].strip(),
        "style": style,
        "genre": genre,
        "subgenre": subgenre or None,
        "bpm": int(row["bpm"]),
        "beat_type": row["beat_type"].strip(),
        "time_signature": row["time_signature"].strip(),
        "duration_s": float(row["duration"]),
        "midi_path": row["midi_filename"].strip(),
    }


def main() -> None:
    info = GROOVE_DIR / "info.csv"
    if not info.exists():
        raise SystemExit(f"ERROR: {info} not found. Run 00_download.py first.")

    with info.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    records, reasons, seen_ids = [], Counter(), set()
    for row in rows:
        try:
            rec = parse_row(row)
        except (KeyError, ValueError) as err:
            reasons[f"unparseable row ({type(err).__name__})"] += 1
            continue
        if not (GROOVE_DIR / rec["midi_path"]).is_file():
            reasons["MIDI file missing on disk"] += 1
            continue
        if rec["id"] in seen_ids:
            reasons["duplicate id"] += 1
            continue
        seen_ids.add(rec["id"])
        records.append(rec)

    write_json(OUTPUT, records)
    print_report("stage 1 (ingest)", len(rows), len(records), reasons)
    print(f"drummers: {len({r['drummer'] for r in records})}")
    print(f"genres:   {len({r['genre'] for r in records})}")
    print(f"total:    {sum(r['duration_s'] for r in records) / 3600:.1f} h")
    print(f"written:  {rel(OUTPUT)}")


if __name__ == "__main__":
    main()
