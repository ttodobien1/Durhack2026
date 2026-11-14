"""Shared paths and helpers for the data pipeline stages.

Every stage from 2 on works on one collection at a time:
    python data/scripts/05_slice.py --source fmc
Intermediate files go to data/build/<source>/<stage>.json (not committed).
run_pipeline.py runs all the stages of one collection in order.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = DATA_DIR / "raw"  # downloaded collections (not committed)
BUILD_DIR = DATA_DIR / "build"  # intermediate outputs (not committed)
TEAM_DIR = DATA_DIR / "team"  # MIDI made by the team + manifest (committed: they are the originals)
PIEZAS_DIR = DATA_DIR / "piezas"  # read by the backend seed (npm run db:seed)
PROVENANCE_DIR = DATA_DIR / "provenance"  # where each piece came from + rejects
LICENSES_DIR = DATA_DIR / "licenses"  # license texts of the collections

# Where each collection's MIDI files live; a record's midi_path is relative to this folder.
SOURCE_DIRS = {
    "groove": RAW_DIR / "groove",
    "fmc": RAW_DIR / "free-midi-chords" / "extracted",
    "team": TEAM_DIR,
}
SOURCES = tuple(SOURCE_DIRS)


def source_from_args(description: str | None = None) -> str:
    parser = argparse.ArgumentParser(description=(description or "").strip().splitlines()[0])
    parser.add_argument("--source", choices=SOURCES, default="groove",
                        help="collection to process (default: groove)")
    return parser.parse_args().source


def stage_file(source: str, stage: str) -> Path:
    return BUILD_DIR / source / f"{stage}.json"


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def read_json(path: Path):
    if not path.exists():
        raise SystemExit(f"ERROR: {path} not found. Run the previous stage first.")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def rel(path: Path) -> str:
    """Path relative to the repo root, for reports."""
    return str(path.relative_to(DATA_DIR.parent))


def print_report(stage: str, n_in: int, n_out: int, reasons: Counter) -> None:
    """Every stage prints: how many came in, how many went out, and why."""
    print(f"\n=== Report: {stage} ===")
    print(f"in:  {n_in}")
    print(f"out: {n_out}")
    print(f"discarded: {n_in - n_out}")
    for reason, count in reasons.most_common():
        print(f"  - {reason}: {count}")
