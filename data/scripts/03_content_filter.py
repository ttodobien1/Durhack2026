"""Stage 3: content filter. Keep only material that is useful for rap beats.

Input:  data/build/02_license.json
Output: data/build/03_content_filter.json

Groove MIDI rules (ROL_C.md, section 4.3):
  - beat_type == "beat" (fills are too short and irregular to loop)
  - time signature 4/4
  - genre in RAP_GENRES
  - tempo in the typical rap range (BPM_MIN..BPM_MAX)

Each record is checked against the rules in order; the first rule it fails
is the reason it is discarded.
"""

from collections import Counter

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "02_license.json"
OUTPUT = BUILD_DIR / "03_content_filter.json"

# hiphop: core. funk/soul: where boom bap breaks come from.
# neworleans: funky second-line grooves. jazz: for lo-fi / jazz-rap.
RAP_GENRES = {"hiphop", "funk", "soul", "neworleans", "jazz"}
BPM_MIN, BPM_MAX = 70, 110

GROOVE_RULES = [
    ("fill, not a beat", lambda r: r["beat_type"] == "beat"),
    ("not 4/4", lambda r: r["time_signature"] == "4-4"),
    ("genre not useful for rap", lambda r: r["genre"] in RAP_GENRES),
    (f"tempo outside {BPM_MIN}-{BPM_MAX} BPM", lambda r: BPM_MIN <= r["bpm"] <= BPM_MAX),
]

RULES_BY_SOURCE = {"groove": GROOVE_RULES}


def first_failure(rec: dict) -> str | None:
    rules = RULES_BY_SOURCE.get(rec["source"])
    if rules is None:
        return f"no content rules for source '{rec['source']}'"
    for reason, passes in rules:
        if not passes(rec):
            return reason
    return None


def main() -> None:
    records = read_json(INPUT)
    kept, reasons = [], Counter()

    for rec in records:
        reason = first_failure(rec)
        if reason:
            reasons[reason] += 1
        else:
            kept.append(rec)

    write_json(OUTPUT, kept)
    print_report("stage 3 (content filter)", len(records), len(kept), reasons)

    print("\nkept by genre:")
    for genre in sorted(RAP_GENRES):
        sub = [r for r in kept if r["genre"] == genre]
        minutes = sum(r["duration_s"] for r in sub) / 60
        drummers = len({r["drummer"] for r in sub})
        subgenres = dict(Counter(r["subgenre"] or "-" for r in sub))
        print(f"  {genre:11} {len(sub):3} files  {minutes:5.1f} min  "
              f"{drummers} drummers  subgenres={subgenres}")
    print(f"\ndrummers kept: {sorted({r['drummer'] for r in kept}, key=lambda d: int(d[7:]))}")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
