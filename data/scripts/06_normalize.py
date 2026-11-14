"""Stage 6: normalize slices into contract notes (tono, inicio, duracion, velocidad).

Input:  data/build/05_slice.json
Output: data/build/06_normalize.json

For "ritmo" (ROL_C.md, section 4.6):
  - Map Roland TD-11 pitches to the 9 drum classes used by the Groove MIDI
    paper (kick 36, snare 38, closed hi-hat 42, open hi-hat 46, toms 43/47/50,
    crash 49, ride 51), so Tone.js only needs 9 samples.
  - Soft quantization: move each hit QUANTIZE_STRENGTH of the way toward the
    nearest 16th. Keeps the swing/feel, removes the mess.
  - If the same mapped sound lands twice on the same 16th (e.g. hi-hat edge +
    hi-hat bow), keep only the loudest hit: a double hit sounds like a flam
    and would confuse the diff, which pairs notes by (tono, inicio).
  - duracion = DRUM_DURATION (drum hits have no real length).

For melodic types (acordes, bajo, melodia; later collections):
  - Same soft quantization of start and end; keep the real duration.
  - Detect the key (tonalidad) with the Krumhansl-Schmuckler algorithm.

For all: velocidad = velocity / 127, times rounded to 3 decimals and
clamped inside the window [0, compases * 4).
"""

from collections import Counter

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "05_slice.json"
OUTPUT = BUILD_DIR / "06_normalize.json"

BEATS_PER_BAR = 4
GRID = 0.25  # a 16th note, in beats
QUANTIZE_STRENGTH = 0.5
DRUM_DURATION = 0.25

# Roland TD-11 pitch -> Groove MIDI paper's 9 classes.
DRUM_MAP = {
    36: 36, 35: 36,                    # kick
    38: 38, 37: 38, 40: 38,            # snare (head, side stick, rim)
    42: 42, 22: 42, 44: 42,            # closed hi-hat (bow, edge, pedal)
    46: 46, 26: 46,                    # open hi-hat (bow, edge)
    43: 43, 58: 43,                    # low tom
    47: 47, 45: 47,                    # mid tom
    50: 50, 48: 50,                    # high tom
    49: 49, 52: 49, 55: 49, 57: 49,    # crash
    51: 51, 53: 51, 59: 51,            # ride (bow, bell, edge)
}

# Krumhansl-Kessler key profiles (major / minor), index 0 = tonic.
MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def soft_quantize(beat: float) -> float:
    grid = round(beat / GRID) * GRID
    return grid + (beat - grid) * (1 - QUANTIZE_STRENGTH)


def clamp(beat: float, length: float) -> float:
    return round(min(max(beat, 0.0), length - 0.001), 3)


def detect_key(notes: list[dict]) -> str | None:
    """Return e.g. "Am" or "C", weighting pitch classes by duration."""
    weights = [0.0] * 12
    for n in notes:
        weights[n["tono"] % 12] += n["duracion"]
    if not any(weights):
        return None

    def corr(profile, tonic):
        rotated = profile[-tonic:] + profile[:-tonic]
        mx, my = sum(weights) / 12, sum(rotated) / 12
        num = sum((x - mx) * (y - my) for x, y in zip(weights, rotated))
        den = (sum((x - mx) ** 2 for x in weights) * sum((y - my) ** 2 for y in rotated)) ** 0.5
        return num / den if den else 0.0

    best = max(((corr(MAJOR, t), NAMES[t]) for t in range(12)),
               key=lambda c: c[0])
    best_minor = max(((corr(MINOR, t), NAMES[t] + "m") for t in range(12)),
                     key=lambda c: c[0])
    return max(best, best_minor)[1]


def normalize_drums(notes: list[dict], length: float, stats: Counter) -> list[dict]:
    loudest = {}  # (tono, 16th) -> note
    for n in notes:
        tono = DRUM_MAP.get(n["pitch"])
        if tono is None:
            stats["hits dropped: unknown drum pitch"] += 1
            continue
        if tono != n["pitch"]:
            stats["hits remapped to a standard drum"] += 1
        key = (tono, round(n["beat"] / GRID))
        if key in loudest:
            stats["hits merged (same sound, same 16th)"] += 1
            if n["vel"] <= loudest[key]["vel"]:
                continue
        loudest[key] = {**n, "tono": tono}

    return [{"tono": n["tono"],
             "inicio": clamp(soft_quantize(n["beat"]), length),
             "duracion": DRUM_DURATION,
             "velocidad": round(n["vel"] / 127, 2)}
            for n in loudest.values()]


def normalize_melodic(notes: list[dict], length: float) -> list[dict]:
    out = []
    for n in notes:
        start = clamp(soft_quantize(n["beat"]), length)
        end = min(soft_quantize(n["beat"] + n["dur"]), length)
        out.append({"tono": n["pitch"], "inicio": start,
                    "duracion": round(max(end - start, GRID / 2), 3),
                    "velocidad": round(n["vel"] / 127, 2)})
    return out


def main() -> None:
    slices = read_json(INPUT)
    out, reasons, stats, shift = [], Counter(), Counter(), []

    for s in slices:
        length = s["compases"] * BEATS_PER_BAR
        if s["tipo"] == "ritmo":
            notas = normalize_drums(s["notes"], length, stats)
            tonalidad = None
        else:
            notas = normalize_melodic(s["notes"], length)
            tonalidad = detect_key(notas)
        if not notas:
            reasons["no notes left after normalizing"] += 1
            continue

        stats["hits in"] += len(s["notes"])
        stats["hits out"] += len(notas)
        shift += [abs(n["beat"] - soft_quantize(n["beat"])) for n in s["notes"]]
        notas.sort(key=lambda n: (n["inicio"], n["tono"]))
        rest = {k: v for k, v in s.items() if k != "notes"}
        out.append({**rest, "tonalidad": tonalidad, "notas": notas})

    write_json(OUTPUT, out)
    print_report("stage 6 (normalize)", len(slices), len(out), reasons)
    print()
    for k in ("hits in", "hits remapped to a standard drum",
              "hits merged (same sound, same 16th)", "hits dropped: unknown drum pitch",
              "hits out"):
        print(f"  {k}: {stats[k]}")
    print(f"  mean quantization shift: {sum(shift) / len(shift):.3f} beats")
    used = Counter(n["tono"] for s in out for n in s["notas"])
    print(f"  drum sounds used: {dict(sorted(used.items()))}")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
