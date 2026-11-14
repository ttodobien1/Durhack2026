"""Stage 9: validate every piece against the contract.

Input:  data/build/<source>/08_dedupe.json
Output: data/build/<source>/09_validate.json (valid pieces)
        data/provenance/<source>.rejected.json (failed pieces + why, for the record)

Rules live in contract.py. ids are not assigned yet (stage 10), so they are
not required here; stage 10 checks again with ids.
"""

from collections import Counter

from common import PROVENANCE_DIR, print_report, read_json, rel, source_from_args, stage_file, write_json
from contract import validate_piece



def main() -> None:
    source = source_from_args(__doc__)
    input_path = stage_file(source, "08_dedupe")
    output_path = stage_file(source, "09_validate")
    pieces = read_json(input_path)
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

    write_json(output_path, valid)
    rejected_path = PROVENANCE_DIR / f"{source}.rejected.json"
    write_json(rejected_path, rejected)
    print_report(f"stage 9 (validate) [{source}]", len(pieces), len(valid), reasons)
    print(f"written: {rel(output_path)}, "
          f"{rel(rejected_path)} ({len(rejected)} rejected)")


if __name__ == "__main__":
    main()
