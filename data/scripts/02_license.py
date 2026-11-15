"""Stage 2: license filter. Only clear, permissive licenses get in.

Input:  data/build/<source>/01_ingest.json
Output: data/build/<source>/02_license.json

Rule (ROL_C.md, section 4.2): CC0, public domain, CC BY or MIT (the allow-list
lives in contract.py). Nothing with SA, NC, ND or an unknown license.

A record can carry its own "license" (per file). Otherwise it inherits the
license of its collection from SOURCES below. Each kept record gets "license"
and "source_url" (the most precise link we have: release, dataset page or note).
"""

from collections import Counter

from common import print_report, read_json, rel, source_from_args, stage_file, write_json
from contract import ALLOWED_LICENSES as ALLOWED

# Collection-level licenses. Add a row here when a new collection joins.
SOURCES = {
    "groove": {"license": "CC BY 4.0", "url": "https://magenta.tensorflow.org/datasets/groove"},
    "fmc": {"license": "MIT", "url": "https://github.com/ldrolez/free-midi-chords"},
    "team": {"license": "CC BY 4.0", "url": "Created at DurHack 2026 by the Stemma team"},
}

FORBIDDEN_MARKERS = ("SA", "NC", "ND")


def check_license(license_name: str | None) -> str | None:
    """Return None if the license is allowed, else the reason it is not."""
    if not license_name:
        return "license unknown"
    tokens = license_name.replace("-", " ").upper().split()
    for marker in FORBIDDEN_MARKERS:
        if marker in tokens:
            return f"license not allowed ({marker})"
    if license_name not in ALLOWED:
        return f"license not in allow-list ({license_name})"
    return None


def main() -> None:
    source_name = source_from_args(__doc__)
    input_path = stage_file(source_name, "01_ingest")
    output_path = stage_file(source_name, "02_license")
    records = read_json(input_path)
    kept, reasons = [], Counter()

    for rec in records:
        source = SOURCES.get(rec["source"], {})
        license_name = rec.get("license") or source.get("license")
        reason = check_license(license_name)
        if reason:
            reasons[reason] += 1
            continue
        url = rec.get("release_url") or rec.get("fuente") or source.get("url")
        kept.append({**rec, "license": license_name, "source_url": url})

    write_json(output_path, kept)
    print_report(f"stage 2 (license) [{source_name}]", len(records), len(kept), reasons)
    print("licenses:", dict(Counter(r["license"] for r in kept)))
    print(f"written:  {rel(output_path)}")


if __name__ == "__main__":
    main()
