"""Stage 1 (free-midi-chords): one record per minor-key progression in "hiphop2 style".

Input:  data/raw/free-midi-chords/extracted/<key>/4 Progression/Minor/hiphop2 style/*.mid
        data/raw/free-midi-chords/_download.json (release, zip sha256)
Output: data/build/fmc/01_ingest.json

Everything a progression knows is in its filename (see the collection's README):
    "A - VI III i v - Nostalgic Dark.mid" -> tonic A (minor), numerals, mood tags.
"hiphop2 style" is the pack's syncopated hip-hop rhythm variant of each progression.

Traceability: every record keeps the release tag, the zip's sha256, the file's own
sha256 and its path inside the zip. The tempo comes from the file's set_tempo event;
the files have no time_signature event, which in MIDI means 4/4 (recorded as such).
"""

import hashlib
import json
import re
from collections import Counter

import mido

from common import RAW_DIR, SOURCE_DIRS, print_report, rel, stage_file, write_json

FMC_DIR = SOURCE_DIRS["fmc"]
DOWNLOAD_META = RAW_DIR / "free-midi-chords" / "_download.json"
OUTPUT = stage_file("fmc", "01_ingest")
PATTERN = "*/4 Progression/Minor/hiphop2 style/*.mid"
NAME_RE = re.compile(r"^(?P<tonic>[A-G][#b]?) - (?P<numerals>.+?) - (?P<moods>.+)\.mid$")
AUTHOR = "Ludovic Drolez"  # copyright holder in the collection's LICENSE


def main() -> None:
    if not DOWNLOAD_META.exists():
        raise SystemExit("ERROR: run 00_download_fmc.py first.")
    meta = json.loads(DOWNLOAD_META.read_text())
    files = sorted(FMC_DIR.glob(PATTERN))

    records, reasons = [], Counter()
    for path in files:
        m = NAME_RE.match(path.name)
        if not m:
            reasons["filename does not follow 'Key - numerals - moods.mid'"] += 1
            continue
        midi = mido.MidiFile(path)
        tempos = [msg.tempo for t in midi.tracks for msg in t if msg.type == "set_tempo"]
        if len(set(tempos)) != 1:
            reasons["no single tempo in the file"] += 1
            continue
        signatures = [f"{msg.numerator}-{msg.denominator}" for t in midi.tracks
                      for msg in t if msg.type == "time_signature"]
        rel_path = str(path.relative_to(FMC_DIR))
        records.append({
            "source": "fmc",
            "id": rel_path,
            "author": AUTHOR,
            "style": "hiphop2",
            "genre": "hiphop",
            "subgenre": None,
            "bpm": round(mido.tempo2bpm(tempos[0])),
            "beat_type": "progression",
            "time_signature": signatures[0] if signatures else "4-4",
            "time_signature_source": "file" if signatures else "MIDI default (no time_signature event)",
            "duration_s": round(midi.length, 3),
            "midi_path": rel_path,
            "key": f"{m['tonic']}m",
            "numerals": m["numerals"].split(),
            "moods": [w for w in m["moods"].split() if w != "New"],  # "New" = recently added, not a mood
            "release": meta["release"],
            "release_url": f"{meta['repository']}/releases/tag/{meta['release']}",
            "zip_sha256": meta["sha256"],
            "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })

    write_json(OUTPUT, records)
    print_report("stage 1 (ingest free-midi-chords)", len(files), len(records), reasons)
    print(f"release: {meta['release']}  keys: {len({r['key'] for r in records})}  "
          f"tempos: {dict(Counter(r['bpm'] for r in records))}")
    print(f"chords per progression: {dict(sorted(Counter(len(r['numerals']) for r in records).items()))}")
    print(f"written:  {rel(OUTPUT)}")


if __name__ == "__main__":
    main()
