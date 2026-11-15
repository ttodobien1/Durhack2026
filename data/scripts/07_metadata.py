"""Stage 7: fill in the contract metadata of every piece.

Input:  data/build/<source>/06_normalize.json
Output: data/build/<source>/07_metadata.json

Contract fields set here (ROL_C.md, sections 4.7 and 5):
  nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo,
  compases, parent_id, notas
The id is assigned at export (stage 10). Everything needed to trace a piece
back to its exact source (file, bars, release, sha256...) is kept under
"_origin"; stage 10 writes it to data/provenance/<source>.json and strips it.

Demo selection ("demo" style, so the copilot finds these first):
  groove: up to DEMO_MAX hip-hop/funk beats at DEMO_BPM, one per file, drummers in turns.
  fmc:    up to FMC_DEMO_MAX dark/nostalgic progressions in A minor, with their bass lines.
  team:   pieces in the demo keys.
Style tags are single words with no hyphens or spaces: the backend splits tags
on both ("boom-bap" would be stored as "boom" + "bap").
"""

from collections import Counter, defaultdict

from common import print_report, read_json, rel, source_from_args, stage_file, write_json

# --- groove -------------------------------------------------------------------------------------
# genre -> (name label, styles). The original genre is kept as a style tag.
GENRE_STYLES = {
    "hiphop": ("Hip-hop beat", ["rap", "boombap", "hiphop"]),
    "funk": ("Funk break", ["rap", "boombap", "funk"]),
    "soul": ("Soul groove", ["rap", "boombap", "soul"]),
    "neworleans": ("New Orleans groove", ["rap", "boombap", "neworleans"]),
    "jazz": ("Jazz beat", ["rap", "lofi", "jazz"]),
}
DEMO_GENRES = {"hiphop", "funk"}
DEMO_EXCLUDED_SUBGENRES = {"rock", "latin"}  # kept in the library, not in the demo
DEMO_BPM = (85, 95)
DEMO_MAX = 20

# --- fmc ----------------------------------------------------------------------------------------
FMC_AUTHOR = "Ludovic Drolez (free-midi-chords)"
FMC_DEMO_KEY = "Am"
FMC_DEMO_MOODS = {"Dark", "Sad", "Nostalgic", "Mysterious", "Lonely"}
FMC_DEMO_MAX = 6  # progressions; each brings its chords and its bass line

DEMO_KEYS = {"Am", "Cm"}

ORIGIN_FIELDS = {
    "groove": ("source", "id", "slice_id", "drummer", "style", "genre", "subgenre",
               "midi_path", "start_bar"),
    "fmc": ("source", "id", "slice_id", "author", "midi_path", "start_bar", "key", "numerals",
            "moods", "release", "release_url", "zip_sha256", "file_sha256", "time_signature_source"),
    "team": ("source", "id", "slice_id", "author", "midi_path", "start_bar", "file_sha256",
             "manifest_index"),
}


def key_name(key: str) -> str:
    return f"{key[:-1]} minor" if key.endswith("m") else f"{key} major"


# --- demo pickers -------------------------------------------------------------------------------
def pick_demo_groove(slices: list[dict]) -> set[str]:
    by_file = defaultdict(list)
    for s in slices:
        if (s["genre"] in DEMO_GENRES and s["subgenre"] not in DEMO_EXCLUDED_SUBGENRES
                and DEMO_BPM[0] <= s["bpm"] <= DEMO_BPM[1]):
            by_file[s["id"]].append(s)
    # One per file: the 4-bar slice if there is one.
    per_file = [max(group, key=lambda s: (s["compases"], -s["start_bar"]))
                for group in by_file.values()]
    by_drummer = defaultdict(list)
    for s in per_file:
        by_drummer[s["drummer"]].append(s)
    for group in by_drummer.values():  # hip-hop first, then closest to 90 BPM
        group.sort(key=lambda s: (s["genre"] != "hiphop", abs(s["bpm"] - 90), s["slice_id"]))
    chosen, drummers = [], sorted(by_drummer, key=lambda d: int(d.removeprefix("drummer")))
    while len(chosen) < DEMO_MAX and any(by_drummer.values()):
        for d in drummers:
            if by_drummer[d] and len(chosen) < DEMO_MAX:
                chosen.append(by_drummer[d].pop(0))
    return {s["slice_id"] for s in chosen}


def pick_demo_fmc(slices: list[dict]) -> set[str]:
    files = sorted({s["id"]: s for s in slices
                    if s["key"] == FMC_DEMO_KEY and set(s["moods"]) & FMC_DEMO_MOODS}.values(),
                   # 7th/9th chords first (lo-fi colour), then by name
                   key=lambda s: (not any(c in "79" for c in "".join(s["numerals"])), s["id"]))
    chosen_files = {s["id"] for s in files[:FMC_DEMO_MAX]}
    return {s["slice_id"] for s in slices if s["id"] in chosen_files}


def pick_demo_team(slices: list[dict]) -> set[str]:
    return {s["slice_id"] for s in slices if s.get("tonalidad") in DEMO_KEYS or s["tipo"] == "ritmo"}


# --- per-source metadata ------------------------------------------------------------------------
def meta_groove(s: dict, counters: Counter) -> dict | None:
    if s["genre"] not in GENRE_STYLES:
        return None
    label, styles = GENRE_STYLES[s["genre"]]
    counters[(label, s["bpm"])] += 1
    return {"nombre": f"{label} {s['bpm']} BPM #{counters[(label, s['bpm'])]} ({s['drummer']})",
            "autor": f"{s['drummer']} (Groove MIDI)", "estilo": list(styles)}


def meta_fmc(s: dict, counters: Counter) -> dict:
    label = {"acordes": "Chords", "bajo": "Bass line"}.get(s["tipo"], s["tipo"].capitalize())
    numerals = " ".join(s["numerals"])
    nombre = f"{label} in {key_name(s['key'])}: {numerals} ({' '.join(s['moods'])})"
    counters[nombre] += 1
    if counters[nombre] > 1:
        nombre += f" #{counters[nombre]}"
    lofi = ["lofi"] if any(c in "79" for c in numerals) else []
    moods = [m.lower() for m in s["moods"]]
    return {"nombre": nombre, "autor": FMC_AUTHOR, "estilo": ["rap", "hiphop", *lofi, *moods]}


def meta_team(s: dict, counters: Counter) -> dict:
    return {"nombre": s.get("nombre") or f"{s['tipo'].capitalize()} by {s['author']}",
            "autor": s["author"], "estilo": list(s.get("estilo") or ["rap"])}


META = {"groove": meta_groove, "fmc": meta_fmc, "team": meta_team}
PICK_DEMO = {"groove": pick_demo_groove, "fmc": pick_demo_fmc, "team": pick_demo_team}
SORT_KEY = {
    "groove": lambda s: (s["genre"], s["bpm"], s["slice_id"]),
    "fmc": lambda s: (s["key"], s["id"], s["tipo"]),
    "team": lambda s: (s.get("manifest_index", 0), s["slice_id"]),
}


def main() -> None:
    source = source_from_args(__doc__)
    input_path = stage_file(source, "06_normalize")
    output_path = stage_file(source, "07_metadata")
    slices = read_json(input_path)
    demo_ids = PICK_DEMO[source](slices) if slices else set()
    out, reasons, counters = [], Counter(), Counter()

    for s in sorted(slices, key=SORT_KEY[source]):
        meta = META[source](s, counters)
        if meta is None:
            reasons[f"no style mapping for genre '{s.get('genre')}'"] += 1
            continue
        estilo = meta["estilo"] + (["demo"] if s["slice_id"] in demo_ids else [])
        out.append({
            "nombre": meta["nombre"],
            "tipo": s["tipo"],
            "autor": meta["autor"],
            "licencia": s["license"],
            "fuente": s["source_url"],
            "tonalidad": s["tonalidad"],
            "tempo": s["bpm"],
            "estilo": estilo,
            "compases": s["compases"],
            "parent_id": None,
            "notas": s["notas"],
            "_origin": {k: s.get(k) for k in ORIGIN_FIELDS[source]},
        })

    names = [p["nombre"] for p in out]
    if len(set(names)) != len(names):
        raise SystemExit("ERROR: duplicate piece names")
    write_json(output_path, out)
    print_report(f"stage 7 (metadata) [{source}]", len(slices), len(out), reasons)
    print(f"\nauthors: {dict(Counter(p['autor'] for p in out).most_common())}")
    print(f"styles:  {dict(Counter(e for p in out for e in p['estilo']).most_common())}")
    demo = [p for p in out if "demo" in p["estilo"]]
    print(f"\ndemo pieces: {len(demo)}  "
          f"(authors: {dict(Counter(p['autor'].split()[0] for p in demo))}, "
          f"bars: {dict(Counter(p['compases'] for p in demo))})")
    for p in demo:
        print(f"  {p['nombre']:60} {p['tipo']:8} {p['compases']} bars  {len(p['notas'])} notes")
    print(f"written: {rel(output_path)}")


if __name__ == "__main__":
    main()
