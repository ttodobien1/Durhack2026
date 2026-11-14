"""Stage 2: license filter. Only clear, permissive licenses get in.

Input:  data/build/01_ingest.json
Output: data/build/02_license.json

Rule (ROL_C.md, section 4.2): CC0, public domain or CC BY. Nothing with
SA, NC, ND or an unknown license.

A record can carry its own "license" (e.g. PDMX, per file). Otherwise it
inherits the license of its collection from SOURCES below. Each kept record
gets "license" and "source_url" fields for the metadata stage.
"""

from collections import Counter

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "01_ingest.json"
OUTPUT = BUILD_DIR / "02_license.json"

# Collection-level licenses. Add a row here when a new collection joins.
SOURCES = {
    "groove": {
        "license": "CC BY 4.0",
        "url": "https://magenta.tensorflow.org/datasets/groove",
    },
}

ALLOWED = {"CC0", "CC0 1.0", "Public Domain", "CC BY 3.0", "CC BY 4.0"}
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
    records = read_json(INPUT)
    kept, reasons = [], Counter()

    for rec in records:
        source = SOURCES.get(rec["source"], {})
        license_name = rec.get("license") or source.get("license")
        reason = check_license(license_name)
        if reason:
            reasons[reason] += 1
            continue
        kept.append({**rec, "license": license_name, "source_url": source.get("url")})

    write_json(OUTPUT, kept)
    print_report("stage 2 (license)", len(records), len(kept), reasons)
    print("licenses:", dict(Counter(r["license"] for r in kept)))
    print(f"written:  {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
