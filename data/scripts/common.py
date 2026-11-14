"""Shared paths and helpers for the data pipeline stages."""

import json
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = DATA_DIR / "raw"
BUILD_DIR = DATA_DIR / "build"
SEEDS_DIR = DATA_DIR / "seeds"


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def read_json(path: Path):
    if not path.exists():
        raise SystemExit(f"ERROR: {path} not found. Run the previous stage first.")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def print_report(stage: str, n_in: int, n_out: int, reasons: Counter) -> None:
    """Every stage prints: how many came in, how many went out, and why."""
    print(f"\n=== Report: {stage} ===")
    print(f"in:  {n_in}")
    print(f"out: {n_out}")
    print(f"discarded: {n_in - n_out}")
    for reason, count in reasons.most_common():
        print(f"  - {reason}: {count}")
