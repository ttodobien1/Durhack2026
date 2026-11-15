// Version tree of a project (the Tree tab): one row per stage of the project, every piece of that stage on the row.
//
//   Library rows  pieces from the library that pieces of the project descend from (their origins)
//   Forked from   the original project at the version this one was forked from (forks only)
//   v1, v2...     every saved version, with all the pieces it used, changed or not
//   Now           the editor's unsaved state, when it differs from the last version
//
// A piece keeps its column while it stays the same piece; a fork that takes the place of its original takes the
// original's column. Links between rows say how each piece got there:
//   same    the same piece with the same notes as in an earlier row
//   edited  the same piece (same id) with other notes
//   fork    a fork of a piece from an earlier row (or of a library piece)
// A piece with no link is new in that row.

const sameNotes = (a, b) => a.compases === b.compases && JSON.stringify(a.notas) === JSON.stringify(b.notas)

/** Pieces of a song in track order, first use first: [id, ...]. */
export const pieceOrder = (pistas) => [...new Set(pistas.flatMap((t) => [...t.bloques].sort((a, b) => a.compas - b.compas).map((b) => b.pieza_id)))]

/** Stage for a version snapshot (or the fork point). */
export function stageOf(key, kind, snapshot, meta = {}) {
  return { key, kind, ...meta, order: pieceOrder(snapshot.pistas), piezas: snapshot.piezas }
}

/** True when the editor's state is not the same music as `stage` (other pieces, order or notes). */
export function differs(stage, working) {
  if (!stage) return working.order.length > 0
  if (stage.order.join() !== working.order.join()) return true
  return working.order.some((id) => !stage.piezas[id] || !working.piezas[id] || !sameNotes(stage.piezas[id], working.piezas[id]))
}

/** Every library ancestor that the stages need but do not contain, walking parent_id with `loadPiece`. */
export async function loadAncestors(stages, loadPiece) {
  const staged = new Set(stages.flatMap((s) => s.order))
  const library = new Map()
  const pending = [...new Set(stages.flatMap((s) => s.order.map((id) => s.piezas[id]?.parent_id)).filter(Boolean))]
  while (pending.length) {
    const id = pending.shift()
    if (staged.has(id) || library.has(id)) continue
    try {
      const p = await loadPiece(id)
      library.set(id, p)
      if (p.parent_id) pending.push(p.parent_id)
    } catch {
      /* private or deleted: the chain stops here */
    }
  }
  return library
}

/**
 * stages: oldest first, each { key, kind, order: [ids], piezas: { id: piece } } (+ any display fields).
 * library: Map id -> piece for origins outside the stages.
 * Returns { rows: [stage + { index }], nodes: [{ id, row, col, piece, estado, from }], links: [{ from, to, estado }] }.
 */
export function buildVersionTree(stages, library = new Map()) {
  const staged = new Set(stages.flatMap((s) => s.order))

  // Library rows: level 1 = parent of a project piece, 2 = grandparent... (highest level on top).
  const level = new Map()
  for (const stage of stages) {
    for (const id of stage.order) {
      let parent = stage.piezas[id]?.parent_id
      for (let d = 1; parent && !staged.has(parent) && library.has(parent) && d < 50; d++) {
        level.set(parent, Math.max(level.get(parent) ?? 0, d))
        parent = library.get(parent).parent_id
      }
    }
  }
  const top = Math.max(0, ...level.values())
  const rows = []
  for (let l = top; l >= 1; l--) {
    const order = [...level].filter(([, v]) => v === l).map(([id]) => id).sort()
    rows.push({ key: `lib${l}`, kind: 'library', order, piezas: Object.fromEntries(order.map((id) => [id, library.get(id)])) })
  }
  rows.push(...stages)

  const nodes = []
  const links = []
  const latest = new Map() // piece id -> its node in the latest row that had it
  let nextCol = 0
  rows.forEach((row, r) => {
    row.index = r
    const taken = new Set()
    const placed = []
    for (const id of row.order) {
      const piece = { ...row.piezas[id], id }
      const prev = latest.get(id)
      const parentNode = !prev && piece.parent_id ? latest.get(piece.parent_id) : null
      let col
      let from = null
      let estado = row.kind === 'library' ? 'library' : 'new'
      if (prev) {
        from = prev
        estado = sameNotes(prev.piece, piece) ? 'same' : 'edited'
        col = prev.col
      } else if (parentNode) {
        from = parentNode
        estado = 'fork'
        if (!row.order.includes(piece.parent_id)) col = parentNode.col // it replaced its original
      }
      if (col === undefined || taken.has(col)) col = nextCol++
      nextCol = Math.max(nextCol, col + 1)
      taken.add(col)
      const node = { id: `${row.key}:${id}`, row: r, col, piece, estado, from: from?.id ?? null }
      nodes.push(node)
      placed.push(node)
      if (from) links.push({ from: from.id, to: node.id, estado })
    }
    for (const node of placed) latest.set(node.piece.id, node) // after the row: no links inside a row
  })
  return { rows, nodes, links }
}

/** Piece ids of every node that descends from `nodeId` through the links (later states of that piece). */
export function successors(nodeId, tree) {
  const out = []
  const queue = [nodeId]
  const seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()
    for (const link of tree.links) {
      if (link.from !== id || seen.has(link.to)) continue
      seen.add(link.to)
      queue.push(link.to)
      out.push(tree.nodes.find((n) => n.id === link.to).piece.id)
    }
  }
  return [...new Set(out)]
}
