"""Stage 9: validate every piece against the contract.

Input:  data/build/08_dedupe.json
Output: data/build/09_validate.json (valid pieces)
        data/seeds/rejected.json     (failed pieces + why, for the record)

Rules live in contract.py. ids are not assigned yet (stage 10), so they are
not required here; stage 10 checks again with ids.
"""

from collections import Counter

from common import BUILD_DIR, SEEDS_DIR, print_report, read_json, write_json
from contract import validate_piece

INPUT = BUILD_DIR / "08_dedupe.json"
OUTPUT = BUILD_DIR / "09_validate.json"
REJECTED = SEEDS_DIR / "rejected.json"


def main() -> None:
    pieces = read_json(INPUT)
    valid, rejected, reasons = [], [], Counter()

    for p in pieces:
        problems = validate_piece(p, require_id=False)
        if problems:
            # Count by rule, not by note index, so the report stays short.
            for problem in {pr.split(": ", 1)[-1] if pr.startswith("nota ") else pr
                            for pr in problems}:
                reasons[problem] += 1
            rejected.append({"nombre": p.get("nombre"),
                             "origin": p.get("_origin"),
                             "problems": problems})
        else:
            valid.append(p)

    write_json(OUTPUT, valid)
    write_json(REJECTED, rejected)
    print_report("stage 9 (validate)", len(pieces), len(valid), reasons)
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}, "
          f"{REJECTED.relative_to(REJECTED.parents[2])} ({len(rejected)} rejected)")


if __name__ == "__main__":
    main()
