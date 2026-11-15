import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVersionTree, differs, loadAncestors, pieceOrder, stageOf, successors } from './versionTree.js'

const n = (tono, inicio) => ({ tono, inicio, duracion: 0.5, velocidad: 0.8 })
const piece = (autor, notas, parent_id = null) => ({ nombre: 'x', autor, tipo: 'acordes', compases: 4, parent_id, notas })
const lane = (...ids) => ({ instrumento: 'piano', bloques: ids.map((pieza_id, i) => ({ pieza_id, compas: i * 4 })) })

const DRUMS = piece('cris', [n(36, 0)])
const CHORDS = piece('ana', [n(57, 0), n(60, 0)], 'p-lib')
const CHORDS_EDITED = piece('ana', [n(57, 0), n(61, 0)], 'p-lib')
const FORK = piece('chino', [n(57, 0), n(62, 0)], 'p-2')
const BASS = piece('luis', [n(45, 0)])

const v1 = stageOf('v1', 'version', { pistas: [lane('p-1'), lane('p-2')], piezas: { 'p-1': DRUMS, 'p-2': CHORDS } })
const v2 = stageOf('v2', 'version', { pistas: [lane('p-1'), lane('p-2'), lane('p-4')], piezas: { 'p-1': DRUMS, 'p-2': CHORDS_EDITED, 'p-4': BASS } })
const v3 = stageOf('v3', 'version', { pistas: [lane('p-1'), lane('p-3'), lane('p-4')], piezas: { 'p-1': DRUMS, 'p-3': FORK, 'p-4': BASS } })
const library = new Map([['p-lib', piece('luis', [n(57, 0)], 'p-root')], ['p-root', piece('luis', [])]])

test('pieceOrder keeps track order and first use', () => {
  assert.deepEqual(pieceOrder([lane('a', 'b'), lane('a', 'c')]), ['a', 'b', 'c'])
})

test('every version is a row with all its pieces; links say same / edited / fork', () => {
  const tree = buildVersionTree([v1, v2, v3], library)
  assert.deepEqual(tree.rows.map((r) => r.key), ['lib2', 'lib1', 'v1', 'v2', 'v3'])
  const node = (id) => tree.nodes.find((x) => x.id === id)
  assert.equal(node('v2:p-1').estado, 'same')
  assert.equal(node('v2:p-2').estado, 'edited')
  assert.equal(node('v2:p-4').estado, 'new')
  assert.equal(node('v3:p-3').estado, 'fork')
  assert.equal(node('v3:p-3').from, 'v2:p-2')
  assert.equal(node('v1:p-2').estado, 'fork') // fork of the library piece p-lib
  assert.equal(node('v1:p-2').from, 'lib1:p-lib')
  assert.equal(node('lib1:p-lib').from, 'lib2:p-root')
  // columns: a piece keeps its column, the fork that replaced p-2 takes it
  assert.equal(node('v1:p-2').col, node('v3:p-3').col)
  assert.equal(node('v1:p-1').col, node('v3:p-1').col)
  assert.notEqual(node('v2:p-4').col, node('v2:p-2').col)
  assert.equal(tree.nodes.filter((x) => x.row === tree.rows.findIndex((r) => r.key === 'v3')).length, 3)
})

test('successors follow a piece through later versions', () => {
  const tree = buildVersionTree([v1, v2, v3], library)
  assert.deepEqual(successors('v1:p-2', tree), ['p-2', 'p-3'])
  assert.deepEqual(successors('lib2:p-root', tree), ['p-lib', 'p-2', 'p-3'])
})

test('differs compares pieces, order and notes', () => {
  assert.equal(differs(v3, v3), false)
  assert.equal(differs(v2, v3), true)
  assert.equal(differs(null, v1), true)
})

test('loadAncestors walks parent_id until a staged piece or the end', async () => {
  const calls = []
  const lib = await loadAncestors([v1], async (id) => {
    calls.push(id)
    if (id === 'p-root') throw new Error('private')
    return library.get(id)
  })
  assert.deepEqual([...lib.keys()], ['p-lib'])
  assert.deepEqual(calls, ['p-lib', 'p-root'])
})
