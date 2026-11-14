"""The piece contract (CLAUDE.md section 4.1, ROL_C.md section 5) as code.

validate_piece(piece) returns a list of problems; an empty list means valid.
Used by stage 9 (before ids exist) and stage 10 (after ids are assigned).
"""

import re

TIPOS = {"ritmo", "acordes", "melodia", "bajo"}
COMPASES = {1, 2, 4}
BEATS_PER_BAR = 4
ALLOWED_LICENSES = {"CC0", "CC0 1.0", "Public Domain", "CC BY 3.0", "CC BY 4.0"}
# The 9 drum sounds the pipeline maps to; agreed with A for the Tone.js sampler.
DRUM_SOUNDS = {36, 38, 42, 46, 43, 47, 50, 49, 51}

KEY_RE = re.compile(r"^[A-G](#|b)?m?$")  # "Am", "C", "F#m", "Bb"
ID_RE = re.compile(r"^p-\d{3,}$")

FIELDS = ("id", "nombre", "tipo", "autor", "licencia", "fuente", "tonalidad",
          "tempo", "estilo", "compases", "parent_id", "notas")
NOTE_FIELDS = ("tono", "inicio", "duracion", "velocidad")
INTERNAL_FIELDS = {"_origin"}  # pipeline-only, stripped at export


def _is_int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _nonempty_str(x) -> bool:
    return isinstance(x, str) and x.strip() != ""


def validate_piece(p: dict, require_id: bool = True) -> list[str]:
    problems = []
    expected = set(FIELDS) if require_id else set(FIELDS) - {"id"}
    keys = set(p) - INTERNAL_FIELDS
    if missing := expected - keys:
        problems.append(f"missing fields: {sorted(missing)}")
    if extra := keys - set(FIELDS):
        problems.append(f"unknown fields: {sorted(extra)}")

    if require_id and not (isinstance(p.get("id"), str) and ID_RE.match(p["id"])):
        problems.append("id must look like 'p-001'")
    for field in ("nombre", "autor", "fuente"):
        if not _nonempty_str(p.get(field)):
            problems.append(f"{field} must be a non-empty string")
    if p.get("tipo") not in TIPOS:
        problems.append(f"tipo must be one of {sorted(TIPOS)}")
    if p.get("licencia") not in ALLOWED_LICENSES:
        problems.append(f"licencia not allowed: {p.get('licencia')!r}")

    tonalidad = p.get("tonalidad")
    if p.get("tipo") == "ritmo":
        if tonalidad is not None:  # pending agreement with A and B: null for ritmo
            problems.append("tonalidad must be null for ritmo")
    elif not (isinstance(tonalidad, str) and KEY_RE.match(tonalidad)):
        problems.append("tonalidad must be a key like 'Am' or 'C'")

    if not (_is_num(p.get("tempo")) and 40 <= p["tempo"] <= 250):
        problems.append("tempo must be a number between 40 and 250")
    estilo = p.get("estilo")
    if not (isinstance(estilo, list) and estilo and all(_nonempty_str(e) for e in estilo)):
        problems.append("estilo must be a non-empty list of strings")
    if not (_is_int(p.get("compases")) and p["compases"] in COMPASES):
        problems.append(f"compases must be one of {sorted(COMPASES)}")
    if "parent_id" in p and p["parent_id"] is not None and not isinstance(p["parent_id"], str):
        problems.append("parent_id must be null or a piece id")

    notas = p.get("notas")
    if not (isinstance(notas, list) and notas):
        problems.append("notas must be a non-empty list")
        return problems

    length = p["compases"] * BEATS_PER_BAR if _is_int(p.get("compases")) else None
    seen = set()
    for i, n in enumerate(notas):
        where = f"nota {i}"
        if not isinstance(n, dict) or set(n) != set(NOTE_FIELDS):
            problems.append(f"{where}: must have exactly {list(NOTE_FIELDS)}")
            continue
        if not (_is_int(n["tono"]) and 0 <= n["tono"] <= 127):
            problems.append(f"{where}: tono must be an int 0-127")
        elif p.get("tipo") == "ritmo" and n["tono"] not in DRUM_SOUNDS:
            problems.append(f"{where}: drum tono {n['tono']} is not one of the 9 sounds")
        if not (_is_num(n["inicio"]) and n["inicio"] >= 0
                and (length is None or n["inicio"] < length)):
            problems.append(f"{where}: inicio must be in [0, compases*4)")
        if not (_is_num(n["duracion"]) and n["duracion"] > 0):
            problems.append(f"{where}: duracion must be > 0")
        if not (_is_num(n["velocidad"]) and 0 <= n["velocidad"] <= 1):
            problems.append(f"{where}: velocidad must be between 0 and 1")
        pair = (n.get("tono"), n.get("inicio"))
        if pair in seen:
            problems.append(f"{where}: duplicate (tono, inicio) {pair}")
        seen.add(pair)
    return problems
