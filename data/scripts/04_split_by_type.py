"""Stage 4: read each MIDI and split its notes into parts by contract type.

Input:  data/build/03_content_filter.json (+ MIDI files)
Output: data/build/04_split_by_type.json

Rules (ROL_C.md, section 4.4), applied per (track, channel) group of notes:
  - percussion channel (MIDI channel 10 = index 9)  -> "ritmo"
  - polyphonic (many notes sound at the same time)  -> "acordes"
  - monophonic and low (mean pitch < BASS_MAX_MEAN) -> "bajo"
  - monophonic and higher                           -> "melodia"

Groove MIDI is all drums, so everything becomes "ritmo"; the melodic rules
are here for the collections that come later.

Times stay in MIDI ticks plus the file's ticks-per-beat (ppq); stage 5
converts them to beats when slicing.
"""

from collections import Counter, defaultdict

import mido

from common import BUILD_DIR, RAW_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "03_content_filter.json"
OUTPUT = BUILD_DIR / "04_split_by_type.json"

DRUM_CHANNEL = 9
POLYPHONY_THRESHOLD = 0.2  # share of notes that overlap another note
BASS_MAX_MEAN = 55  # G3


def read_notes(midi: mido.MidiFile) -> dict[tuple[int, int], list[dict]]:
    """Return {(track, channel): [{tick, dur, pitch, vel}, ...]} in absolute ticks."""
    groups = defaultdict(list)
    for t_idx, track in enumerate(midi.tracks):
        tick = 0
        open_notes = {}  # (channel, pitch) -> note dict waiting for its note-off
        for msg in track:
            tick += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                note = {"tick": tick, "dur": 0, "pitch": msg.note, "vel": msg.velocity}
                groups[(t_idx, msg.channel)].append(note)
                open_notes[(msg.channel, msg.note)] = note
            elif msg.type in ("note_off", "note_on"):  # note_on vel 0 == note off
                note = open_notes.pop((msg.channel, msg.note), None)
                if note:
                    note["dur"] = tick - note["tick"]
    return groups


def polyphony(notes: list[dict]) -> float:
    """Share of notes that start while a previous note is still sounding."""
    if len(notes) < 2:
        return 0.0
    ordered = sorted(notes, key=lambda n: n["tick"])
    overlapping, latest_end = 0, -1
    for n in ordered:
        if n["tick"] < latest_end:
            overlapping += 1
        latest_end = max(latest_end, n["tick"] + n["dur"])
    return overlapping / len(notes)


def classify(channel: int, notes: list[dict]) -> str:
    if channel == DRUM_CHANNEL:
        return "ritmo"
    if polyphony(notes) > POLYPHONY_THRESHOLD:
        return "acordes"
    mean_pitch = sum(n["pitch"] for n in notes) / len(notes)
    return "bajo" if mean_pitch < BASS_MAX_MEAN else "melodia"


def main() -> None:
    records = read_json(INPUT)
    kept, reasons, types, n_notes = [], Counter(), Counter(), 0

    for rec in records:
        path = RAW_DIR / rec["source"] / rec["midi_path"]
        try:
            midi = mido.MidiFile(path)
        except (OSError, ValueError, EOFError) as err:
            reasons[f"unreadable MIDI ({type(err).__name__})"] += 1
            continue

        parts = []
        for (track, channel), notes in sorted(read_notes(midi).items()):
            if not notes:
                continue
            tipo = classify(channel, notes)
            parts.append({"tipo": tipo, "track": track, "channel": channel,
                          "notes": sorted(notes, key=lambda n: n["tick"])})
            types[tipo] += 1
            n_notes += len(notes)

        if not parts:
            reasons["no notes"] += 1
            continue
        kept.append({**rec, "ppq": midi.ticks_per_beat, "parts": parts})

    write_json(OUTPUT, kept)
    print_report("stage 4 (split by type)", len(records), len(kept), reasons)
    print(f"parts by type: {dict(types)}")
    print(f"notes total:   {n_notes}")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
