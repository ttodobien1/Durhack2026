"""Stage 3: content filter. Keep only material that is useful for rap beats.

Input:  data/build/<source>/02_license.json
Output: data/build/<source>/03_content_filter.json

Rules per collection (ROL_C.md, section 4.3). Each record is checked against
the rules in order; the first rule it fails is the reason it is discarded.

  groove: beats (no fills), 4/4, genres useful for rap, 70-110 BPM.
  fmc:    4-chord minor progressions in the keys we use for beats, 4/4.
  team:   4/4 (the team chose each piece on purpose; the rest is checked later).
"""

from collections import Counter

from common import print_report, read_json, rel, source_from_args, stage_file, write_json

# hiphop: core. funk/soul: where boom bap breaks come from.
# neworleans: funky second-line grooves. jazz: for lo-fi / jazz-rap.
RAP_GENRES = {"hiphop", "funk", "soul", "neworleans", "jazz"}
BPM_MIN, BPM_MAX = 70, 110
# Minor keys for beats; A minor and C minor are the demo keys.
FMC_KEYS = {"Am", "Cm", "Dm", "Em", "Gm"}

RULES_BY_SOURCE = {
    "groove": [
        ("fill, not a beat", lambda r: r["beat_type"] == "beat"),
        ("not 4/4", lambda r: r["time_signature"] == "4-4"),
        ("genre not useful for rap", lambda r: r["genre"] in RAP_GENRES),
        (f"tempo outside {BPM_MIN}-{BPM_MAX} BPM", lambda r: BPM_MIN <= r["bpm"] <= BPM_MAX),
    ],
    "fmc": [
        ("not 4/4", lambda r: r["time_signature"] == "4-4"),
        ("not a 4-chord progression", lambda r: len(r["numerals"]) == 4),
        (f"key not in {sorted(FMC_KEYS)}", lambda r: r["key"] in FMC_KEYS),
    ],
    "team": [
        ("not 4/4", lambda r: r["time_signature"] == "4-4"),
    ],
}


def first_failure(rec: dict) -> str | None:
    rules = RULES_BY_SOURCE.get(rec["source"])
    if rules is None:
        return f"no content rules for source '{rec['source']}'"
    for reason, passes in rules:
        if not passes(rec):
            return reason
    return None


def main() -> None:
    source = source_from_args(__doc__)
    input_path = stage_file(source, "02_license")
    output_path = stage_file(source, "03_content_filter")
    records = read_json(input_path)
    kept, reasons = [], Counter()

    for rec in records:
        reason = first_failure(rec)
        if reason:
            reasons[reason] += 1
        else:
            kept.append(rec)

    write_json(output_path, kept)
    print_report(f"stage 3 (content filter) [{source}]", len(records), len(kept), reasons)

    print("\nkept by genre:")
    for genre, n in sorted(Counter(r["genre"] for r in kept).items()):
        sub = [r for r in kept if r["genre"] == genre]
        minutes = sum(r["duration_s"] for r in sub) / 60
        authors = len({r["author"] for r in sub})
        subgenres = dict(Counter(r["subgenre"] or "-" for r in sub))
        print(f"  {genre:11} {n:3} files  {minutes:5.1f} min  {authors} authors  subgenres={subgenres}")
    if any("key" in r for r in kept):
        print(f"by key: {dict(sorted(Counter(r.get('key') for r in kept).items(), key=str))}")
    print(f"authors kept: {sorted({r['author'] for r in kept})}")
    print(f"written: {rel(output_path)}")


if __name__ == "__main__":
    main()
