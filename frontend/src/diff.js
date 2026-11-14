// Musical diff, CLAUDE.md §5. Used by the mock API; the real backend owns its own copy.
// diffNotes(original, changed) → { nuevas, borradas, movidas, iguales }
export function diffNotes(original, changed) {
  const key = (n) => `${n.tono}@${n.inicio}`
  const oldLeft = [...original]
  const iguales = []
  const newLeft = []

  for (const n of changed) {
    const i = oldLeft.findIndex((o) => key(o) === key(n))
    if (i >= 0) {
      iguales.push(n)
      oldLeft.splice(i, 1)
    } else newLeft.push(n)
  }

  // Same pitch at another time, or same time at another pitch → moved (closest wins).
  const movidas = []
  const nuevas = []
  for (const n of newLeft) {
    let best = -1
    let bestDist = Infinity
    oldLeft.forEach((o, i) => {
      if (o.tono !== n.tono && o.inicio !== n.inicio) return
      const d = Math.abs(o.inicio - n.inicio) + Math.abs(o.tono - n.tono)
      if (d < bestDist) [best, bestDist] = [i, d]
    })
    if (best >= 0) movidas.push({ antes: oldLeft.splice(best, 1)[0], despues: n })
    else nuevas.push(n)
  }

  return { nuevas, borradas: oldLeft, movidas, iguales }
}
