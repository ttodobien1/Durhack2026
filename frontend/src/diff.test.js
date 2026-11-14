// Run: node src/diff.test.js
import assert from 'node:assert/strict'
import { diffNotes } from './diff.js'

const n = (tono, inicio, duracion = 0.5) => ({ tono, inicio, duracion, velocidad: 0.8 })

const parent = [n(57, 0), n(60, 1), n(64, 2), n(59, 3)]
const fork = [n(57, 0), n(60, 1.5), n(64, 2), n(72, 3.5), n(62, 3)]
const d = diffNotes(parent, fork)

assert.deepEqual(d.iguales.map((x) => x.tono), [57, 64])
// 60 shifted half a beat; 59→62 at the same beat counts as moved too
assert.deepEqual(d.movidas.map((m) => [m.antes.tono, m.antes.inicio, m.despues.tono, m.despues.inicio]), [
  [60, 1, 60, 1.5],
  [59, 3, 62, 3],
])
assert.deepEqual(d.nuevas.map((x) => x.tono), [72])
assert.equal(d.borradas.length, 0)

assert.equal(diffNotes(parent, parent).iguales.length, 4)
assert.equal(diffNotes([], [n(60, 0)]).nuevas.length, 1)
assert.equal(diffNotes([n(60, 0)], []).borradas.length, 1)
console.log('diff ok')
