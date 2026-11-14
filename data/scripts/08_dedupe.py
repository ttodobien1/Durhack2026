"""Stage 8: remove duplicate pieces.

Input:  data/build/07_metadata.json
Output: data/build/08_dedupe.json

Two passes (ROL_C.md, section 4.8):
  1. Exact duplicates: identical sorted (tono, inicio) pairs, anywhere.
  2. Near duplicates from the SAME source file and length: a drummer repeating
     the same groove gives slices that are >= NEAR_DUP_THRESHOLD alike.

Similarity = shared hits / hits of the larger piece, where a hit is
(tono, nearest 16th). When two pieces collide, the one tagged "demo" wins,
then the first in order.

Cross-drummer near duplicates: in Groove's eval sessions several drummers
played the same 10 grooves. Those are different performances by different
real authors, so they are only REPORTED here, not removed, unless
DEDUPE_ACROSS_DRUMMERS is set to True.
"""

from collections import Counter, defaultdict

from common import BUILD_DIR, print_report, read_json, write_json

INPUT = BUILD_DIR / "07_metadata.json"
OUTPUT = BUILD_DIR / "08_dedupe.json"

GRID = 0.25
NEAR_DUP_THRESHOLD = 0.9
DEDUPE_ACROSS_DRUMMERS = False


def hits(p: dict) -> frozenset:
    return frozenset((n["tono"], round(n["inicio"] / GRID)) for n in p["notas"])


def similarity(a: frozenset, b: frozenset) -> float:
    return len(a & b) / max(len(a), len(b))


def exact_key(p: dict) -> tuple:
    return (p["compases"], tuple(sorted((n["tono"], n["inicio"]) for n in p["notas"])))


def main() -> None:
    pieces = read_json(INPUT)
    # Demo pieces first so they win any collision.
    ordered = sorted(enumerate(pieces), key=lambda ip: ("demo" not in ip[1]["estilo"], ip[0]))

    kept_idx, reasons = [], Counter()
    seen_exact = set()
    kept_by_group = defaultdict(list)  # (file, compases) -> [hits]
    kept_by_length = defaultdict(list)  # compases -> [(drummer, hits)]

    for idx, p in ordered:
        ek = exact_key(p)
        if ek in seen_exact:
            reasons["exact duplicate"] += 1
            continue
        h = hits(p)
        group = (p["_origin"]["id"], p["compases"])
        if any(similarity(h, other) >= NEAR_DUP_THRESHOLD for other in kept_by_group[group]):
            reasons[f"near duplicate in the same file (>= {NEAR_DUP_THRESHOLD:.0%})"] += 1
            continue
        drummer = p["_origin"]["drummer"]
        if DEDUPE_ACROSS_DRUMMERS and any(
                d != drummer and similarity(h, other) >= NEAR_DUP_THRESHOLD
                for d, other in kept_by_length[p["compases"]]):
            reasons[f"near duplicate by another drummer (>= {NEAR_DUP_THRESHOLD:.0%})"] += 1
            continue
        seen_exact.add(ek)
        kept_by_group[group].append(h)
        kept_by_length[p["compases"]].append((drummer, h))
        kept_idx.append(idx)

    kept = [pieces[i] for i in sorted(kept_idx)]  # back to stage-7 order
    write_json(OUTPUT, kept)
    print_report("stage 8 (dedupe)", len(pieces), len(kept), reasons)

    # Report cross-drummer look-alikes that are still in the library.
    cross, involved = 0, set()
    by_len = defaultdict(list)
    for i, p in enumerate(kept):
        by_len[p["compases"]].append((i, p["_origin"]["drummer"], hits(p)))
    for group in by_len.values():
        for a in range(len(group)):
            for b in range(a + 1, len(group)):
                (ia, da, ha), (ib, db, hb) = group[a], group[b]
                if da != db and similarity(ha, hb) >= NEAR_DUP_THRESHOLD:
                    cross += 1
                    involved |= {ia, ib}
    print(f"\ncross-drummer look-alike pairs kept: {cross} "
          f"(pieces involved: {len(involved)}, removal "
          f"{'ON' if DEDUPE_ACROSS_DRUMMERS else 'OFF'})")
    print(f"demo pieces kept: {sum('demo' in p['estilo'] for p in kept)}")
    print(f"by genre: {dict(Counter(p['_origin']['genre'] for p in kept).most_common())}")
    print(f"written: {OUTPUT.relative_to(OUTPUT.parents[2])}")


if __name__ == "__main__":
    main()
