"""Generate team-made seed loops: melodies, chord loops and bass lines for rap beats.

    python data/scripts/generate_loops.py

Writes data/piezas/stemma-generated.json (ids p-2001...). Deterministic: the same seed gives the same file.
Why: the imported collections are one-sided (431 chord/bass loops from one generator, all one rhythm; only a handful
of melodies), so search, similarity and the piece map had little to work with. CLAUDE.md section 6 allows pieces
"created during the event"; these are labelled honestly as generated (autor "Stemma generator", fuente = this script).

Musical rules, not randomness: notes come from a scale; melodies repeat a one-bar motif with variation and resolve to
the tonic or fifth; chords and bass follow common rap / lo-fi progressions with genre-typical rhythms.
"""

import random

from common import PIEZAS_DIR, write_json
from contract import validate_piece

SEED = 2027  # 2026 produced a near-copy of "Mary Had a Little Lamb"; checked with backend/src/lib/fingerprint.js (tooClose)
OUT = PIEZAS_DIR / "stemma-generated.json"
FIRST_ID = 2001
AUTHOR = "Stemma generator"
LICENSE = "CC BY 4.0"
SOURCE = "Generated with data/scripts/generate_loops.py (rule-based, DurHack 2026) by the Stemma team"

NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
KEY_NAMES = {"C": "C", "Db": "C#", "D": "D", "Eb": "Eb", "E": "E", "F": "F", "F#": "F#", "G": "G", "Ab": "G#", "A": "A", "Bb": "Bb", "B": "B"}
LONG_NAMES = {"C": "C", "Db": "D flat", "D": "D", "Eb": "E flat", "E": "E", "F": "F", "F#": "F sharp", "G": "G", "Ab": "A flat", "A": "A", "Bb": "B flat", "B": "B"}
MINOR_LONG = {"Db": "C sharp", "Ab": "G sharp"}  # minor keys spelled with sharps

# Scales as semitones from the root; `minor` decides the key name ("Am" vs "A").
SCALES = {
    "aeolian": ([0, 2, 3, 5, 7, 8, 10], True, "natural minor"),
    "dorian": ([0, 2, 3, 5, 7, 9, 10], True, "dorian"),
    "phrygian": ([0, 1, 3, 5, 7, 8, 10], True, "phrygian"),
    "harmonic": ([0, 2, 3, 5, 7, 8, 11], True, "harmonic minor"),
    "minpenta": ([0, 3, 5, 7, 10], True, "minor pentatonic"),
    "blues": ([0, 3, 5, 6, 7, 10], True, "blues"),
    "majpenta": ([0, 2, 4, 7, 9], False, "major pentatonic"),
    "ionian": ([0, 2, 4, 5, 7, 9, 11], False, "major"),
}

# One-bar rhythms for melodies: (onset in 16ths, length in 16ths).
MELODY_RHYTHMS = {
    "syncopated": [(0, 3), (3, 3), (6, 2), (8, 3), (11, 3), (14, 2)],
    "dotted": [(0, 3), (3, 3), (6, 4), (10, 2), (12, 4)],
    "sparse": [(0, 6), (8, 6), (14, 2)],
    "triplet": [(0, 4 / 3), (4 / 3, 4 / 3), (8 / 3, 4 / 3), (4, 4), (8, 4 / 3), (28 / 3, 4 / 3), (32 / 3, 4 / 3), (12, 4)],
    "trap roll": [(0, 1), (1, 1), (2, 1), (3, 1), (6, 2), (8, 2), (12, 1), (13, 1), (14, 2)],
    "call": [(0, 2), (2, 1), (3, 3), (6, 2)],
    "offbeat": [(2, 2), (6, 2), (10, 2), (14, 2)],
    "lazy": [(1, 3), (4, 3), (7, 3), (10, 2), (13, 3)],
    "straight": [(0, 2), (2, 2), (4, 2), (6, 2), (8, 4), (12, 4)],
}

GENRES = {
    "boombap": {"tempo": (84, 94), "tags": ["rap", "boombap"]},
    "lofi": {"tempo": (70, 85), "tags": ["rap", "lofi"]},
    "trap": {"tempo": (130, 150), "tags": ["rap", "trap"]},
}
REGISTERS = {"lead": 72, "keys": 60, "bell": 84}  # MIDI note of the root octave
MOODS = ["Dark", "Moody", "Late-night", "Hazy", "Bright", "Cold", "Smoky", "Wistful", "Gritty", "Floating", "Tense", "Warm"]
VOICES = {"lead": ["lead", "synth", "flute"], "keys": ["keys", "rhodes", "piano"], "bell": ["bell", "pluck", "glock"]}

# Progressions as (scale degree 0-6, quality) per chord; seventh=True adds the diatonic seventh.
PROGRESSIONS = {
    True: [  # minor keys
        ("i-VI-III-VII", [0, 5, 2, 6]),
        ("i-iv-v-i", [0, 3, 4, 0]),
        ("i-VII-VI-VII", [0, 6, 5, 6]),
        ("i-VI-iv-v", [0, 5, 3, 4]),
        ("i-iv-VII-III", [0, 3, 6, 2]),
        ("ii-v-i-i", [1, 4, 0, 0]),
    ],
    False: [  # major keys
        ("I-vi-IV-V", [0, 5, 3, 4]),
        ("vi-IV-I-V", [5, 3, 0, 4]),
        ("IV-iii-ii-I", [3, 2, 1, 0]),
        ("I-V-vi-IV", [0, 4, 5, 3]),
    ],
}
CHORD_RHYTHMS = {
    "held": [(0, 16)],
    "halves": [(0, 8), (8, 8)],
    "stabs": [(0, 3), (6, 2), (10, 4)],
    "offbeat stabs": [(2, 2), (6, 2), (10, 2), (14, 2)],
    "push": [(0, 6), (6, 10)],
}
BASS_RHYTHMS = {
    "boom bap": [(0, 6), (7, 1), (10, 4), (14, 2)],
    "808 long": [(0, 12), (12, 4)],
    "root-fifth": [(0, 4), (4, 4), (8, 4), (12, 4)],
    "offbeat": [(2, 2), (6, 2), (10, 2), (14, 2)],
    "walk": [(0, 4), (4, 4), (8, 4), (12, 4)],
}

rng = random.Random(SEED)


def degree_pitch(scale: list[int], root: int, degree: int) -> int:
    """MIDI pitch of a scale degree (degree may go below 0 or past the octave)."""
    octave, step = divmod(degree, len(scale))
    return root + 12 * octave + scale[step]


def key_words(root_name: str, minor: bool) -> str:
    return f"{MINOR_LONG.get(root_name, LONG_NAMES[root_name])} minor" if minor else f"{LONG_NAMES[root_name]} major"


def humanize(vel: float) -> float:
    return round(min(1.0, max(0.3, vel + rng.uniform(-0.04, 0.04))), 2)


def beat(sixteenths: float) -> float:
    return round(sixteenths / 4, 4)


def key_label(root_name: str, minor: bool) -> str:
    """Usual spellings: flats for major keys (Db, Ab), sharps where minor keys use them (C#m, G#m)."""
    return KEY_NAMES[root_name] + "m" if minor else root_name


def melody(n: int) -> dict:
    scale_name = rng.choice(list(SCALES))
    scale, minor, scale_label = SCALES[scale_name]
    root_name = NOTE_NAMES[n % 12] if n < 36 else rng.choice(NOTE_NAMES)  # every key at least three times
    genre = rng.choice(list(GENRES))
    register = "bell" if genre == "trap" and rng.random() < 0.5 else rng.choice(["lead", "keys"])
    rhythm_name = rng.choice(list(MELODY_RHYTHMS))
    bars = rng.choice([2, 4, 4])
    root = REGISTERS[register] + NOTE_NAMES.index(root_name)
    if root > 90:
        root -= 12

    # A one-bar motif: a stepwise walk on the scale with the occasional leap, starting on 1, 3 or 5.
    deg = rng.choice([0, 2, 4]) if len(scale) == 7 else rng.choice([0, 1, 2])
    motif = []
    for _ in MELODY_RHYTHMS[rhythm_name]:
        motif.append(deg)
        deg += rng.choice([-1, -1, 1, 1, 2, -2, 0, 3 if rng.random() < 0.2 else 1])
        deg = max(-3, min(len(scale) + 3, deg))

    notes = []
    for bar in range(bars):
        shape = list(motif)
        if bar % 2 == 1:  # answer phrase: same rhythm, shifted contour
            shift = rng.choice([-2, -1, 1, 2])
            shape = [d + shift for d in shape[:-2]] + shape[-2:]
        if bar == bars - 1:  # resolve: last note to the tonic (or fifth), a little longer
            shape[-1] = rng.choice([0, 0, len(scale)]) if len(scale) == 7 else 0
        for i, (onset, length) in enumerate(MELODY_RHYTHMS[rhythm_name]):
            accent = 0.88 if onset % 4 == 0 else 0.72
            notes.append({
                "tono": degree_pitch(scale, root, shape[i]),
                "inicio": beat(bar * 16 + onset),
                "duracion": beat(length * (0.9 if rhythm_name != "sparse" else 1)),
                "velocidad": humanize(accent),
            })
    voice = rng.choice(VOICES[register])
    mood = rng.choice(MOODS)
    return {
        "nombre": f"{mood} {voice} hook in {key_words(root_name, minor)} ({scale_label}, {rhythm_name})",
        "tipo": "melodia",
        "tonalidad": key_label(root_name, minor),
        "tempo": rng.randint(*GENRES[genre]["tempo"]),
        "estilo": GENRES[genre]["tags"],
        "compases": bars,
        "notas": notes,
    }


def chord_tones(scale: list[int], root: int, degree: int, seventh: bool) -> list[int]:
    tones = [degree_pitch(scale, root, degree + k) for k in (0, 2, 4, 6)[: 4 if seventh else 3]]
    return [t - 12 if t > 72 else t for t in tones]  # keep the voicing around middle C


def progression_piece(n: int, tipo: str) -> dict:
    minor = rng.random() < 0.7
    scale = SCALES["aeolian" if minor else "ionian"][0]
    root_name = NOTE_NAMES[(n * 5) % 12]  # walk the circle of fourths so every key appears
    prog_name, degrees = rng.choice(PROGRESSIONS[minor])
    genre = rng.choice(list(GENRES))
    seventh = genre == "lofi" or rng.random() < 0.3
    bars = 4 if rng.random() < 0.75 else 2
    per_bar = degrees if bars == 4 else degrees  # 2 bars: two chords per bar
    notes = []
    if tipo == "acordes":
        rhythm_name = rng.choice(list(CHORD_RHYTHMS))
        root = 48 + NOTE_NAMES.index(root_name)
        for i, deg in enumerate(per_bar):
            start = i * 16 if bars == 4 else i * 8
            span = 16 if bars == 4 else 8
            for onset, length in CHORD_RHYTHMS[rhythm_name]:
                if onset >= span:
                    continue
                for t in chord_tones(scale, root, deg, seventh):
                    notes.append({"tono": t + 12, "inicio": beat(start + onset), "duracion": beat(min(length, span - onset) * 0.95), "velocidad": humanize(0.7)})
        name = f"{prog_name} {'seventh chords' if seventh else 'chords'} in {key_words(root_name, minor)} ({rhythm_name})"
    else:
        rhythm_name = rng.choice(list(BASS_RHYTHMS))
        root = 36 + NOTE_NAMES.index(root_name)
        if root > 43:
            root -= 12
        for i, deg in enumerate(per_bar):
            start = i * 16 if bars == 4 else i * 8
            span = 16 if bars == 4 else 8
            base = degree_pitch(scale, root, deg)
            for j, (onset, length) in enumerate(BASS_RHYTHMS[rhythm_name]):
                if onset >= span:
                    continue
                pitch = base
                if rhythm_name == "root-fifth":
                    pitch = [base, base + 7, base + 12, base + 7][j]
                elif rhythm_name == "808 long" and j == 1:
                    pitch = base + 12
                elif rhythm_name == "walk":
                    pitch = degree_pitch(scale, root, deg + [0, 2, 4, 5][j])
                notes.append({"tono": pitch, "inicio": beat(start + onset), "duracion": beat(min(length, span - onset) * 0.9), "velocidad": humanize(0.85 if onset == 0 else 0.72)})
        name = f"{prog_name} bass line in {key_words(root_name, minor)} ({rhythm_name})"
    return {
        "nombre": name,
        "tipo": tipo,
        "tonalidad": key_label(root_name, minor),
        "tempo": rng.randint(*GENRES[genre]["tempo"]),
        "estilo": GENRES[genre]["tags"],
        "compases": bars,
        "notas": notes,
    }


def main() -> None:
    made = [melody(i) for i in range(100)] + [progression_piece(i, "acordes") for i in range(40)] + [progression_piece(i, "bajo") for i in range(40)]
    pieces = []
    for i, p in enumerate(made):
        piece = {"id": f"p-{FIRST_ID + i}", "nombre": p["nombre"], "tipo": p["tipo"], "autor": AUTHOR, "licencia": LICENSE,
                 "fuente": SOURCE, "tonalidad": p["tonalidad"], "tempo": p["tempo"], "estilo": p["estilo"],
                 "compases": p["compases"], "parent_id": None, "notas": p["notas"]}
        errors = validate_piece(piece)
        if errors:
            raise SystemExit(f"{piece['id']} {piece['nombre']}: {errors}")
        pieces.append(piece)
    write_json(OUT, pieces)
    by_type = {}
    for p in pieces:
        by_type[p["tipo"]] = by_type.get(p["tipo"], 0) + 1
    print(f"wrote {len(pieces)} pieces to {OUT.relative_to(PIEZAS_DIR.parent.parent)}: {by_type}")


if __name__ == "__main__":
    main()
