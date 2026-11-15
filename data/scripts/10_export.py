"""Stage 10: export the final pieces of one collection for the backend, plus attribution.

Input:  data/build/<source>/09_validate.json
Output: data/piezas/<file>.json           pieces (contract 4.1), loaded by `npm run db:seed`
        data/provenance/<source>.json     id -> exact origin (file, bars, release, sha256...)
        data/licenses/<collection>.txt    the collection's own license text, copied verbatim
        data/FUENTES.md                   attribution of every collection exported so far

ids: each collection has its own range so the seed never hits a duplicate id and
an id alone tells where a piece came from:
  p-001..p-099   placeholder / hand-made pieces already in data/piezas/
  p-101..        Groove MIDI        p-1001..  free-midi-chords        p-2001..  team
Every piece is validated again, now with its id; any failure stops the export.
"""

import json
import shutil
from collections import Counter

from common import (DATA_DIR, LICENSES_DIR, PIEZAS_DIR, PROVENANCE_DIR, RAW_DIR, read_json, rel,
                    source_from_args, stage_file, write_json)
from contract import FIELDS, validate_piece

FUENTES_OUT = DATA_DIR / "FUENTES.md"
SOUNDS_MANIFEST = DATA_DIR.parent / "frontend" / "public" / "samples" / "fluidr3" / "manifest.json"

COLLECTIONS = {
    "groove": {
        "id_start": 101,
        "piezas_file": "groove.json",
        "license_file": (RAW_DIR / "groove" / "LICENSE", "groove-midi-dataset.LICENSE.txt"),
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
    "fmc": {
        "id_start": 1001,
        "piezas_file": "free-midi-chords.json",
        "license_file": (RAW_DIR / "free-midi-chords" / "extracted" / "LICENSE",
                         "free-midi-chords.LICENSE.txt"),
        "name": "free-midi-chords (Ludovic Drolez)",
        "url": "https://github.com/ldrolez/free-midi-chords",
        "license": "MIT",
        "license_url": "https://github.com/ldrolez/free-midi-chords/blob/v0.20260914/LICENSE",
        "authors": "Ludovic Drolez and the project's contributors (Copyright (c) 2019 Ludovic Drolez)",
        "citation": "free-midi-chords, release v0.20260914, https://github.com/ldrolez/free-midi-chords",
        "performers": "Programmed chord progressions (no performer)",
        "changes": [
            "Kept the 4-chord minor progressions in the \"hiphop2 style\" rhythm, keys Am, Cm, Dm, Em and Gm.",
            "Split the low root note under each chord (always below C3) into its own bass-line piece;"
            " the chord tones stay as the chords piece. No notes were added or changed.",
            "Soft quantization (no audible change: the files are already on the grid).",
            "Key taken from the file name (the detector's agreement is reported by stage 6).",
            "The MIT license text is kept in data/licenses/free-midi-chords.LICENSE.txt.",
        ],
    },
    "team": {
        "id_start": 2001,
        "piezas_file": "team.json",
        "license_file": None,
        "name": "Stemma team (made at DurHack 2026)",
        "url": "data/team/ (MIDI files and manifest in this repository)",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "authors": "Each piece is credited to the team member named in data/team/manifest.json",
        "citation": "Stemma, DurHack 2026",
        "performers": "Team members",
        "changes": ["Soft quantization; otherwise as exported by the author."],
    },
}


def to_contract(piece: dict, piece_id: str) -> dict:
    """Keep only contract fields, in contract order."""
    full = {**piece, "id": piece_id}
    return {field: full[field] for field in FIELDS}


def copy_license(source: str) -> str | None:
    spec = COLLECTIONS[source]["license_file"]
    if not spec:
        return None
    src, name = spec
    if not src.exists():
        raise SystemExit(f"ERROR: license file {src} not found (run the download stage).")
    LICENSES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, LICENSES_DIR / name)
    return name


def sounds_md() -> list[str]:
    """Credits for the sampled instruments the app plays (written by sounds_fluidr3.py)."""
    if not SOUNDS_MANIFEST.exists():
        return []
    m = json.loads(SOUNDS_MANIFEST.read_text(encoding="utf-8"))
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


def fuentes_md() -> str:
    """Built from every data/provenance/<source>.json present, so it covers all collections."""
    lines = [
        "# Fuentes",
        "",
        "Atribución de cada colección usada para las piezas semilla de Stemma.",
        "Este archivo lo genera `data/scripts/10_export.py`; no editarlo a mano.",
        "",
    ]
    for key, c in COLLECTIONS.items():
        prov_path = PROVENANCE_DIR / f"{key}.json"
        if not prov_path.exists():
            continue
        ids = list(json.loads(prov_path.read_text(encoding="utf-8")))
        if not ids:
            continue
        lines += [
            f"## {c['name']}",
            "",
            f"- **Link:** {c['url']}",
            f"- **License:** [{c['license']}]({c['license_url']})",
            f"- **Authors:** {c['authors']}",
            f"- **Performers:** {c['performers']}",
            f"- **Cite as:** {c['citation']}",
            f"- **Pieces in Stemma:** {len(ids)} (`{ids[0]}` to `{ids[-1]}`) in `data/piezas/{c['piezas_file']}`;"
            f" exact origin of each id in `data/provenance/{key}.json`",
        ]
        if c["license_file"]:
            lines.append(f"- **License text:** `data/licenses/{c['license_file'][1]}`")
        lines += ["- **Changes made:**", *[f"  - {change}" for change in c["changes"]], ""]
    lines += sounds_md()
    lines += [
        "## Excluded",
        "",
        "- **Lakh MIDI Dataset:** not used, it contains many copyrighted works.",
        "- **MusyngKite / FatBoy soundfonts:** not used, they are CC BY-SA (share-alike).",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    source = source_from_args(__doc__)
    c = COLLECTIONS[source]
    pieces = read_json(stage_file(source, "09_validate"))
    piezas_out = PIEZAS_DIR / c["piezas_file"]
    provenance_out = PROVENANCE_DIR / f"{source}.json"

    out, provenance, problems = [], {}, []
    for i, p in enumerate(pieces):
        piece_id = f"p-{c['id_start'] + i:03d}"
        piece = to_contract(p, piece_id)
        if errs := validate_piece(piece, require_id=True):
            problems.append((piece_id, errs))
            continue
        out.append(piece)
        provenance[piece_id] = {**p["_origin"], "compases": p["compases"], "tipo": p["tipo"]}

    if problems:
        for piece_id, errs in problems[:10]:
            print(f"  {piece_id}: {errs[:2]}")
        raise SystemExit(f"ERROR: {len(problems)} pieces failed validation; nothing written.")
    if len({p["id"] for p in out}) != len(out):
        raise SystemExit("ERROR: duplicate ids; nothing written.")
    next_start = min((o["id_start"] for o in COLLECTIONS.values() if o["id_start"] > c["id_start"]),
                     default=None)
    if out and next_start and c["id_start"] + len(out) > next_start:
        raise SystemExit(f"ERROR: {source} ids would run into the next collection's range.")

    print(f"\n=== Report: stage 10 (export) [{source}] ===")
    if not out:
        piezas_out.unlink(missing_ok=True)
        provenance_out.unlink(missing_ok=True)
        print("no pieces: nothing exported")
    else:
        write_json(piezas_out, out)
        write_json(provenance_out, provenance)
        license_name = copy_license(source)
        print(f"pieces exported: {len(out)}  ids {out[0]['id']} .. {out[-1]['id']}")
        print(f"by tipo:    {dict(Counter(p['tipo'] for p in out))}")
        print(f"by compases:{dict(Counter(p['compases'] for p in out))}")
        print(f"by key:     {dict(Counter(p['tonalidad'] for p in out))}")
        print(f"styles:     {dict(Counter(e for p in out for e in p['estilo']).most_common(12))}")
        print(f"authors:    {len({p['autor'] for p in out})}")
        for path in (piezas_out, provenance_out):
            print(f"written: {rel(path)} ({path.stat().st_size / 1024:.0f} KB)")
        if license_name:
            print(f"written: data/licenses/{license_name}")
    FUENTES_OUT.write_text(fuentes_md(), encoding="utf-8")
    print(f"written: {rel(FUENTES_OUT)}")


if __name__ == "__main__":
    main()
