"""Stage 7: fill in the contract metadata of every piece.

Input:  data/build/06_normalize.json
Output: data/build/07_metadata.json

Contract fields set here (ROL_C.md, sections 4.7 and 5):
  nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo,
  compases, parent_id, notas
The id is assigned at export (stage 10). Internal fields used by later
stages (slice_id, midi_path, genre...) are kept under "_origin" and are
stripped at export.

Demo selection: up to DEMO_MAX hip-hop/funk pieces at DEMO_BPM get the extra
style "demo" so the copilot finds them first. One piece per source file
(4-bar preferred) and drummers taken in turns, so the demo mixes authors.
"""

from collections import Counter, defaultdict

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "06_normalize.json"
OUTPUT = BUILD_DIR / "07_metadata.json"

SOURCE_LABELS = {"groove": "Groove MIDI"}

# genre -> (name label, styles). The original genre is kept as a style tag
# so the copilot can search by it and the origin stays traceable.
GENRE_STYLES = {
    "hiphop": ("Hip-hop beat", ["rap", "boom-bap", "hiphop"]),
    "funk": ("Funk break", ["rap", "boom-bap", "funk"]),
    "soul": ("Soul groove", ["rap", "boom-bap", "soul"]),
    "neworleans": ("New Orleans groove", ["rap", "boom-bap", "neworleans"]),
    "jazz": ("Jazz beat", ["rap", "lo-fi", "jazz"]),
}

DEMO_GENRES = {"hiphop", "funk"}
DEMO_EXCLUDED_SUBGENRES = {"rock", "latin"}  # kept in the library, not in the demo
DEMO_BPM = (85, 95)
DEMO_MAX = 20

ORIGIN_FIELDS = ("source", "id", "slice_id", "drummer", "style", "genre",
                 "subgenre", "midi_path", "start_bar")


def is_demo_candidate(s: dict) -> bool:
    return (s["genre"] in DEMO_GENRES
            and s["subgenre"] not in DEMO_EXCLUDED_SUBGENRES
            and DEMO_BPM[0] <= s["bpm"] <= DEMO_BPM[1])


def pick_demo(slices: list[dict]) -> set[str]:
    """Return the slice_ids chosen for the demo."""
    by_file = defaultdict(list)
    for s in slices:
        if is_demo_candidate(s):
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


def main() -> None:
    slices = read_json(INPUT)
    demo_ids = pick_demo(slices)
    out, reasons, counters = [], Counter(), Counter()

    for s in sorted(slices, key=lambda s: (s["genre"], s["bpm"], s["slice_id"])):
        if s["genre"] not in GENRE_STYLES:
            reasons[f"no style mapping for genre '{s['genre']}'"] += 1
            continue
        label, styles = GENRE_STYLES[s["genre"]]
        source_label = SOURCE_LABELS[s["source"]]
        counters[(label, s["bpm"])] += 1
        n = counters[(label, s["bpm"])]
        estilo = styles + (["demo"] if s["slice_id"] in demo_ids else [])

        out.append({
            "nombre": f"{label} {s['bpm']} BPM #{n} ({s['drummer']})",
            "tipo": s["tipo"],
            "autor": f"{s['drummer']} ({source_label})",
            "licencia": s["license"],
            "fuente": s["source_url"],
            "tonalidad": s["tonalidad"],
            "tempo": s["bpm"],
            "estilo": estilo,
            "compases": s["compases"],
            "parent_id": None,
            "notas": s["notas"],
            "_origin": {k: s[k] for k in ORIGIN_FIELDS},
        })

    write_json(OUTPUT, out)
    print_report("stage 7 (metadata)", len(slices), len(out), reasons)
    print(f"\nauthors: {dict(Counter(p['autor'] for p in out).most_common())}")
    print(f"styles:  {dict(Counter(e for p in out for e in p['estilo']).most_common())}")
    demo = [p for p in out if "demo" in p["estilo"]]
    print(f"\ndemo pieces: {len(demo)}  "
          f"(authors: {dict(Counter(p['autor'].split()[0] for p in demo))}, "
          f"bars: {dict(Counter(p['compases'] for p in demo))})")
    for p in demo:
        print(f"  {p['nombre']:40} {p['compases']} bars  {len(p['notas'])} hits")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
