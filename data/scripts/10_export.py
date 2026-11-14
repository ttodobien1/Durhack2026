"""Stage 10: export the final pieces for the backend, plus attribution.

Input:  data/build/09_validate.json
Output: data/piezas/groove.json          pieces (contract 4.1), loaded by `npm run db:seed`
        data/provenance/groove.json      id -> source file and bars, for auditing
        data/FUENTES.md                  attribution of every collection used

ids: Groove pieces take p-101 onwards. p-001..p-099 are left for the hand-made
and placeholder pieces in data/piezas/, so the seed never hits a duplicate id.
Every piece is validated again, now with its id; any failure stops the export.
"""

import json
from collections import Counter

from common import (BUILD_DIR, DATA_DIR, PIEZAS_DIR, PROVENANCE_DIR, read_json,
                    write_json)
from contract import FIELDS, validate_piece

INPUT = BUILD_DIR / "09_validate.json"
PIEZAS_OUT = PIEZAS_DIR / "groove.json"
PROVENANCE_OUT = PROVENANCE_DIR / "groove.json"
FUENTES_OUT = DATA_DIR / "FUENTES.md"
SOUNDS_MANIFEST = DATA_DIR.parent / "frontend" / "public" / "samples" / "fluidr3" / "manifest.json"

ID_START = 101

COLLECTIONS = {
    "groove": {
        "name": "Groove MIDI Dataset (Google Magenta)",
        "url": "https://magenta.tensorflow.org/datasets/groove",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "authors": "Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman",
        "citation": ("Gillick, J., Roberts, A., Engel, J., Eck, D., & Bamman, D. (2019). "
                     "Learning to Groove with Inverse Sequence Transformations. ICML."),
        "performers": "10 drummers, credited as drummer1 ... drummer10 (as in the dataset)",
        "changes": [
            "Kept only 4/4 beats (no fills) in hip-hop, funk, soul, New Orleans and jazz, 70-110 BPM.",
            "Cut into 2- and 4-bar loops.",
            "Mapped the Roland TD-11 drum notes to 9 standard drum sounds.",
            "Soft quantization (each hit moved halfway to the nearest 16th note).",
            "Merged repeated hits of the same sound on the same 16th note.",
            "Removed near-duplicate loops from the same recording.",
        ],
    },
}


def to_contract(piece: dict, piece_id: str) -> dict:
    """Keep only contract fields, in contract order."""
    full = {**piece, "id": piece_id}
    return {field: full[field] for field in FIELDS}


def sounds_md() -> list[str]:
    """Credits for the sampled instruments the app plays (written by sounds_fluidr3.py)."""
    manifest_path = SOUNDS_MANIFEST
    if not manifest_path.exists():
        return []
    m = json.loads(manifest_path.read_text(encoding="utf-8"))
    s = m["source"]
    return [
        f"## Sounds: {s['name']}",
        "",
        f"- **Author:** {s['author']}",
        f"- **License:** [{s['license']}]({s['license_url']}) (evidence: {s['license_evidence']})",
        f"- **Repository:** {s['repository']}",
        f"- **Used for:** {', '.join(f'`{k}` ({v})' for k, v in m['instruments'].items())}",
        f"- **Files:** {len(m['files'])} mp3, each with its URL and sha256 in "
        "`frontend/public/samples/fluidr3/manifest.json`",
        f"- **Changes:** {s['changes']}",
        "- Full sound credits (including the Salamander piano): `frontend/public/samples/CREDITS.md`",
        "",
    ]


def fuentes_md(counts: Counter, id_ranges: dict) -> str:
    lines = [
        "# Fuentes",
        "",
        "Atribución de cada colección usada para las piezas semilla de Stemma.",
        "Este archivo lo genera `data/scripts/10_export.py`; no editarlo a mano.",
        "",
    ]
    for key, c in COLLECTIONS.items():
        if not counts[key]:
            continue
        first, last = id_ranges[key]
        lines += [
            f"## {c['name']}",
            "",
            f"- **Link:** {c['url']}",
            f"- **License:** [{c['license']}]({c['license_url']})",
            f"- **Dataset authors:** {c['authors']}",
            f"- **Performers:** {c['performers']}",
            f"- **Cite as:** {c['citation']}",
            f"- **Pieces in Stemma:** {counts[key]} (`{first}` to `{last}`), "
            f"each with `autor`, `licencia` and `fuente` set",
            "- **Changes made** (CC BY requires saying so):",
            *[f"  - {change}" for change in c["changes"]],
            "",
        ]
    lines += sounds_md()
    lines += [
        "## Excluded",
        "",
        "- **Lakh MIDI Dataset:** not used, it contains many copyrighted works.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    pieces = read_json(INPUT)
    out, provenance, problems = [], {}, []
    counts, id_ranges = Counter(), {}

    for i, p in enumerate(pieces):
        piece_id = f"p-{ID_START + i:03d}"
        piece = to_contract(p, piece_id)
        if errs := validate_piece(piece, require_id=True):
            problems.append((piece_id, errs))
            continue
        out.append(piece)
        origin = p["_origin"]
        provenance[piece_id] = {**origin, "compases": p["compases"]}
        counts[origin["source"]] += 1
        first, _ = id_ranges.get(origin["source"], (piece_id, None))
        id_ranges[origin["source"]] = (first, piece_id)

    if problems:
        for piece_id, errs in problems[:10]:
            print(f"  {piece_id}: {errs[:2]}")
        raise SystemExit(f"ERROR: {len(problems)} pieces failed validation; nothing written.")
    if len({p["id"] for p in out}) != len(out):
        raise SystemExit("ERROR: duplicate ids; nothing written.")

    write_json(PIEZAS_OUT, out)
    write_json(PROVENANCE_OUT, provenance)
    FUENTES_OUT.write_text(fuentes_md(counts, id_ranges), encoding="utf-8")

    print("\n=== Report: stage 10 (export) ===")
    print(f"pieces exported: {len(out)}  ids {out[0]['id']} .. {out[-1]['id']}")
    print(f"by tipo:    {dict(Counter(p['tipo'] for p in out))}")
    print(f"by compases:{dict(Counter(p['compases'] for p in out))}")
    print(f"styles:     {dict(Counter(e for p in out for e in p['estilo']).most_common())}")
    print(f"authors:    {len({p['autor'] for p in out})}")
    for path in (PIEZAS_OUT, PROVENANCE_OUT, FUENTES_OUT):
        print(f"written: {path.relative_to(DATA_DIR.parent)} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
