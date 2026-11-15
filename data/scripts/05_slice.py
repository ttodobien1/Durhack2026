"""Stage 5: cut each performance into loopable pieces of 2 or 4 bars.

Input:  data/build/<source>/04_split_by_type.json
Output: data/build/<source>/05_slice.json (one record per slice)

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

Collections without an entry in WINDOWS are already loop-sized: the whole part
becomes ONE piece from bar 0 (free-midi-chords progressions are exactly 4 bars;
team pieces declare their length). Its length must be 1, 2 or 4 bars.

Drum rules (kick + snare, MIN_NOTES_PER_BAR hits per bar) only apply to "ritmo";
melodic parts just need MIN_MELODIC_NOTES notes.

Note times in the output are in beats relative to the window start, still
unquantized (they can be slightly negative); stage 6 normalizes them.
"""

import statistics
from collections import Counter

from common import print_report, read_json, rel, source_from_args, stage_file, write_json
from contract import COMPASES

BEATS_PER_BAR = 4
# source -> {bars: how many slices of that length per file}. Long performances only.
WINDOWS = {"groove": {4: 1, 2: 2}}
MIN_NOTES_PER_BAR = 4
MIN_MELODIC_NOTES = 2

KICKS = {35, 36}
SNARES = {37, 38, 40}  # side stick, snare head, snare rim (Roland TD-11)

DROP_FIELDS = ("parts", "ppq")  # everything else in the record travels with each slice


def to_beats(notes: list[dict], ppq: int) -> list[dict]:
    out = []
    for n in notes:
        beat = n["tick"] / ppq
        out.append({"beat": beat, "grid": round(beat * 4) / 4, "dur": n["dur"] / ppq,
                    "pitch": n["pitch"], "vel": n["vel"]})
    return out


def check_window(notes: list[dict], start: float, bars: int, tipo: str = "ritmo") -> str | None:
    """Return None if the window is usable, else the reason it is not."""
    end = start + bars * BEATS_PER_BAR
    inside = [n for n in notes if start <= n["grid"] < end]
    if tipo != "ritmo":
        return None if len(inside) >= MIN_MELODIC_NOTES else "almost no notes"
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


def whole_piece(notes: list[dict], tipo: str, rec: dict, reasons: Counter) -> list[tuple[int, int, list[dict]]]:
    """The part is already one loop: keep it whole, from bar 0."""
    bars = rec.get("declared_compases") or int(max(n["grid"] for n in notes) // BEATS_PER_BAR) + 1
    if bars not in COMPASES:
        reasons[f"length is {bars} bars, not one of {sorted(COMPASES)}"] += 1
        return []
    reason = check_window(notes, 0, bars, tipo)
    if reason:
        reasons[f"{bars}-bar piece: {reason}"] += 1
        return []
    return [(0, bars, window_notes(notes, 0, bars))]


def slice_part(notes: list[dict], tipo: str, rec: dict, reasons: Counter) -> list[tuple[int, int, list[dict]]]:
    """Return [(start_bar, bars, notes)] for one part."""
    if rec["source"] not in WINDOWS:
        return whole_piece(notes, tipo, rec, reasons)
    last_bar = int(max(n["grid"] for n in notes) // BEATS_PER_BAR)
    taken_bars: set[int] = set()
    chosen = []

    for bars, cap in WINDOWS[rec["source"]].items():
        valid = []
        for start_bar in range(0, last_bar + 1, bars):
            start = start_bar * BEATS_PER_BAR
            reason = check_window(notes, start, bars, tipo)
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
    source = source_from_args(__doc__)
    input_path = stage_file(source, "04_split_by_type")
    output_path = stage_file(source, "05_slice")
    records = read_json(input_path)
    slices, reasons, files_without_slices = [], Counter(), 0

    for rec in records:
        before = len(slices)
        for part in rec["parts"]:
            notes = to_beats(part["notes"], rec["ppq"])
            for start_bar, bars, w in slice_part(notes, part["tipo"], rec, reasons):
                slices.append({
                    **{k: v for k, v in rec.items() if k not in DROP_FIELDS},
                    "slice_id": f"{rec['id']}#{part['tipo']}#bar{start_bar}x{bars}"
                    if len(rec["parts"]) > 1 else f"{rec['id']}#bar{start_bar}x{bars}",
                    "tipo": part["tipo"],
                    "compases": bars,
                    "start_bar": start_bar,
                    "notes": w,
                })
        if len(slices) == before:
            files_without_slices += 1

    write_json(output_path, slices)
    n_windows = len(slices) + sum(reasons.values())
    print_report(f"stage 5 (slice) [{source}] — candidate windows", n_windows, len(slices), reasons)
    print(f"\nfiles in: {len(records)}  (files with no usable window: {files_without_slices})")
    print(f"slices by length: {dict(sorted(Counter(f'{s['compases']} bars' for s in slices).items()))}")
    print(f"slices by genre:  {dict(Counter(s['genre'] for s in slices).most_common())}")
    print(f"slices by tipo:   {dict(Counter(s['tipo'] for s in slices).most_common())}")
    hits = [len(s['notes']) / s['compases'] for s in slices]
    if hits:
        print(f"notes per bar: min {min(hits):.0f}  median {statistics.median(hits):.0f}  max {max(hits):.0f}")
    print(f"written: {rel(output_path)}")


if __name__ == "__main__":
    main()
