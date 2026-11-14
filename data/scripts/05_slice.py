"""Stage 5: cut each performance into loopable pieces of 2 or 4 bars.

Input:  data/build/04_split_by_type.json
Output: data/build/05_slice.json (one record per slice)

How it works (ROL_C.md, section 4.5):
  - Ticks -> beats (quarter notes): beat = tick / ppq. Groove files start on a
    bar line (checked: kick peaks on beats 1 and 3, snare on 2 and 4).
  - Each note belongs to the bar of its *nearest 16th*, so a hit played a bit
    early for beat 1 stays in the right bar.
  - Candidate windows are bar-aligned: 4-bar windows start on bars 0, 4, 8...;
    2-bar windows on bars 0, 2, 4...
  - A window is valid if every bar has at least MIN_NOTES_PER_BAR hits and the
    window has both kick and snare (drops silences, intros, tails, breaks).
  - From the valid windows, pick the most typical ones (density closest to the
    file's median), without overlapping, up to MAX_PER_FILE of each length,
    so a single long take does not dominate the library.

Note times in the output are in beats relative to the window start, still
unquantized (they can be slightly negative); stage 6 normalizes them.
"""

import statistics
from collections import Counter

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "04_split_by_type.json"
OUTPUT = BUILD_DIR / "05_slice.json"

BEATS_PER_BAR = 4
MAX_PER_FILE = {4: 1, 2: 2}  # bars -> how many slices of that length per file
MIN_NOTES_PER_BAR = 4

KICKS = {35, 36}
SNARES = {37, 38, 40}  # side stick, snare head, snare rim (Roland TD-11)

KEEP_FIELDS = ("source", "id", "drummer", "style", "genre", "subgenre", "bpm",
               "license", "source_url", "midi_path")


def to_beats(notes: list[dict], ppq: int) -> list[dict]:
    out = []
    for n in notes:
        beat = n["tick"] / ppq
        out.append({"beat": beat, "grid": round(beat * 4) / 4, "dur": n["dur"] / ppq,
                    "pitch": n["pitch"], "vel": n["vel"]})
    return out


def check_window(notes: list[dict], start: float, bars: int) -> str | None:
    """Return None if the window is usable, else the reason it is not."""
    end = start + bars * BEATS_PER_BAR
    inside = [n for n in notes if start <= n["grid"] < end]
    per_bar = Counter(int((n["grid"] - start) // BEATS_PER_BAR) for n in inside)
    if any(per_bar[b] < MIN_NOTES_PER_BAR for b in range(bars)):
        return "a bar is almost empty"
    pitches = {n["pitch"] for n in inside}
    if not pitches & KICKS:
        return "no kick"
    if not pitches & SNARES:
        return "no snare"
    return None


def window_notes(notes: list[dict], start: float, bars: int) -> list[dict]:
    end = start + bars * BEATS_PER_BAR
    return [{"beat": round(n["beat"] - start, 4), "dur": round(n["dur"], 4),
             "pitch": n["pitch"], "vel": n["vel"]}
            for n in notes if start <= n["grid"] < end]


def slice_part(notes: list[dict], reasons: Counter) -> list[tuple[int, int, list[dict]]]:
    """Return [(start_bar, bars, notes)] for one part."""
    last_bar = int(max(n["grid"] for n in notes) // BEATS_PER_BAR)
    taken_bars: set[int] = set()
    chosen = []

    for bars, cap in MAX_PER_FILE.items():
        valid = []
        for start_bar in range(0, last_bar + 1, bars):
            start = start_bar * BEATS_PER_BAR
            reason = check_window(notes, start, bars)
            if reason:
                reasons[f"{bars}-bar window: {reason}"] += 1
                continue
            valid.append((start_bar, window_notes(notes, start, bars)))
        if not valid:
            continue

        median = statistics.median(len(w) for _, w in valid)
        valid.sort(key=lambda v: (abs(len(v[1]) - median), v[0]))
        picked = 0
        for start_bar, w in valid:
            span = set(range(start_bar, start_bar + bars))
            if picked == cap:
                reasons[f"{bars}-bar window: over the per-file cap"] += 1
            elif span & taken_bars:
                reasons[f"{bars}-bar window: overlaps a chosen slice"] += 1
            else:
                taken_bars |= span
                chosen.append((start_bar, bars, w))
                picked += 1
    return chosen


def main() -> None:
    records = read_json(INPUT)
    slices, reasons, files_without_slices = [], Counter(), 0

    for rec in records:
        before = len(slices)
        for part in rec["parts"]:
            notes = to_beats(part["notes"], rec["ppq"])
            for start_bar, bars, w in slice_part(notes, reasons):
                slices.append({
                    **{k: rec[k] for k in KEEP_FIELDS},
                    "slice_id": f"{rec['id']}#bar{start_bar}x{bars}",
                    "tipo": part["tipo"],
                    "compases": bars,
                    "start_bar": start_bar,
                    "notes": w,
                })
        if len(slices) == before:
            files_without_slices += 1

    write_json(OUTPUT, slices)
    n_windows = len(slices) + sum(reasons.values())
    print_report("stage 5 (slice) — candidate windows", n_windows, len(slices), reasons)
    print(f"\nfiles in: {len(records)}  (files with no usable window: {files_without_slices})")
    print(f"slices by length: {dict(sorted(Counter(f'{s['compases']} bars' for s in slices).items()))}")
    print(f"slices by genre:  {dict(Counter(s['genre'] for s in slices).most_common())}")
    hits = [len(s['notes']) / s['compases'] for s in slices]
    print(f"hits per bar: min {min(hits):.0f}  median {statistics.median(hits):.0f}  max {max(hits):.0f}")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
