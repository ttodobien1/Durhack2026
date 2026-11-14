"""Stage 4: read each MIDI and split its notes into parts by contract type.

Input:  data/build/<source>/03_content_filter.json (+ MIDI files)
Output: data/build/<source>/04_split_by_type.json

Rules (ROL_C.md, section 4.4), applied per (track, channel) group of notes:
  - percussion channel (MIDI channel 10 = index 9)  -> "ritmo"
  - polyphonic (many notes sound at the same time)  -> "acordes"
  - monophonic and low (mean pitch < BASS_MAX_MEAN) -> "bajo"
  - monophonic and higher                           -> "melodia"

Groove MIDI is all drums, so everything becomes "ritmo".

Bass split (BASS_SPLIT_BELOW): in free-midi-chords every chord is voiced with
one low root note under it (always < 48, chord tones always >= 48). That low
line is in the original file, so it is split out as its own "bajo" part when
it is monophonic; nothing is invented, and both parts trace back to the same file.

Team pieces declare their tipo: all their non-drum notes become one part of that tipo.

Times stay in MIDI ticks plus the file's ticks-per-beat (ppq); stage 5
converts them to beats when slicing.
"""

from collections import Counter, defaultdict

import mido

from common import SOURCE_DIRS, print_report, read_json, rel, source_from_args, stage_file, write_json

DRUM_CHANNEL = 9
POLYPHONY_THRESHOLD = 0.2  # share of notes that overlap another note
BASS_MAX_MEAN = 55  # G3
BASS_SPLIT_BELOW = {"fmc": 48}  # source -> pitch under which notes form the bass line


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


def split_groups(rec: dict, groups: dict, stats: Counter) -> list[tuple[str, int, int, list[dict]]]:
    """Return [(tipo, track, channel, notes)] for one file."""
    declared = rec.get("declared_tipo")
    if declared and declared != "ritmo":
        melodic = [n for (t, ch), ns in groups.items() if ch != DRUM_CHANNEL for n in ns]
        return [(declared, 0, 0, melodic)] if melodic else []
    out = []
    for (track, channel), notes in sorted(groups.items()):
        if not notes:
            continue
        threshold = BASS_SPLIT_BELOW.get(rec["source"])
        if threshold and channel != DRUM_CHANNEL:
            low = [n for n in notes if n["pitch"] < threshold]
            high = [n for n in notes if n["pitch"] >= threshold]
            if low and high and polyphony(low) == 0:
                stats["bass lines split from chord voicings"] += 1
                out.append(("bajo", track, channel, low))
                out.append((classify(channel, high), track, channel, high))
                continue
        out.append((classify(channel, notes), track, channel, notes))
    return out


def main() -> None:
    source = source_from_args(__doc__)
    input_path = stage_file(source, "03_content_filter")
    output_path = stage_file(source, "04_split_by_type")
    records = read_json(input_path)
    kept, reasons, types, n_notes, stats = [], Counter(), Counter(), 0, Counter()

    for rec in records:
        path = SOURCE_DIRS[rec["source"]] / rec["midi_path"]
        try:
            midi = mido.MidiFile(path)
        except (OSError, ValueError, EOFError) as err:
            reasons[f"unreadable MIDI ({type(err).__name__})"] += 1
            continue

        parts = []
        for tipo, track, channel, notes in split_groups(rec, read_notes(midi), stats):
            parts.append({"tipo": tipo, "track": track, "channel": channel,
                          "notes": sorted(notes, key=lambda n: n["tick"])})
            types[tipo] += 1
            n_notes += len(notes)

        if not parts:
            reasons["no notes"] += 1
            continue
        kept.append({**rec, "ppq": midi.ticks_per_beat, "parts": parts})

    write_json(output_path, kept)
    print_report(f"stage 4 (split by type) [{source}]", len(records), len(kept), reasons)
    print(f"parts by type: {dict(types)}")
    for k, v in stats.items():
        print(f"{k}: {v}")
    print(f"notes total:   {n_notes}")
    print(f"written: {rel(output_path)}")


if __name__ == "__main__":
    main()
