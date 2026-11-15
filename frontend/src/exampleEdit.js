/**
 * The example edit used on the landing page (the "How it works" Edit / Diff animations): in your fork of a real
 * library piece, one note moves half a beat later and the first note is added again at beat 6.
 */
export function exampleEdit(child) {
  const move = Math.min(3, child.notas.length - 1)
  const added = { ...child.notas[0], inicio: Math.min(child.compases * 4 - 1, 6) }
  const notas = child.notas.map((n, k) => (k === move ? { ...n, inicio: n.inicio + 0.5 } : n)).concat(added)
  return { move, added, yours: { ...child, id: 'p-new', autor: 'you', nombre: `${child.nombre} (fork)`, parent_id: child.id, notas } }
}
