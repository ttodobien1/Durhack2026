// Self-check for the MIDI splitter: node src/split.test.js
import assert from 'node:assert/strict'
import tonejsMidi from '@tonejs/midi'
import { classify, splitMidi } from './split.js'

const { Midi } = tonejsMidi

function song({ bpm = 90, timeSignature = [4, 4] } = {}) {
  const midi = new Midi()
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature })
  const ppq = midi.header.ppq
  const track = (name, channel, notes) => {
    const t = midi.addTrack()
    t.name = name
    t.channel = channel
    for (const [midiNote, beat, dur] of notes) t.addNote({ midi: midiNote, ticks: Math.round(beat * ppq), durationTicks: Math.round(dur * ppq), velocity: 0.8 })
  }
  return { midi, track, bytes: () => midi.toArray() }
}

// 8 bars: a 2-bar drum loop x4, a 4-bar bass line x2, one A-minor chord per bar.
const s = song()
const drumLoop = []
for (let bar = 0; bar < 2; bar++)
  for (let b = 0; b < 4; b++) {
    drumLoop.push([42, bar * 4 + b, 0.25], [42, bar * 4 + b + 0.5, 0.25])
    drumLoop.push([b % 2 ? 38 : 36, bar * 4 + b, 0.25])
  }
drumLoop.push([36, 7.5, 0.25]) // second bar differs, so the loop is 2 bars long
s.track('Drums', 9, [0, 2, 4, 6].flatMap((rep) => drumLoop.map(([n, beat, d]) => [n, beat + rep * 4, d])))
const bassLine = [[45, 0, 1], [45, 2, 1], [50, 4, 1.5], [52, 8, 1], [40, 12, 2]]
s.track('Bass', 0, [0, 16].flatMap((off) => bassLine.map(([n, beat, d]) => [n, beat + off, d])))
const chords = [[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]]
s.track('Keys', 1, [0, 1].flatMap((rep) => chords.flatMap((c, i) => c.map((n) => [n, (rep * 4 + i) * 4, 3.5]))))

const out = splitMidi(s.bytes())
assert.equal(out.tempo, 90)
assert.equal(out.tonalidad, 'Am')
const byPart = Object.groupBy(out.candidates, (c) => c.part)
assert.deepEqual(byPart.Drums.map((c) => [c.tipo, c.compases, c.repeats, c.desde]), [['ritmo', 2, 4, 0]])
assert.deepEqual(byPart.Bass.map((c) => [c.tipo, c.compases, c.repeats]), [['bajo', 4, 2]])
assert.equal(byPart.Keys[0].tipo, 'acordes')
for (const c of out.candidates) for (const n of c.notas) assert.ok(n.inicio >= 0 && n.inicio < c.compases * 4, 'notes start inside the piece')

// Relative major / minor: same notes, the opening bass note decides.
const vi = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] // Am F C G
const ambiguous = (bass) => {
  const t = song()
  t.track('Keys', 1, vi.flatMap((c, i) => c.map((n) => [n + 12, i * 4, 3.5])))
  t.track('Bass', 0, bass.map((n, i) => [n, i * 4, 3]))
  return splitMidi(t.bytes()).tonalidad
}
assert.equal(ambiguous([45, 41, 48, 43]), 'Am') // bass opens on A
assert.equal(ambiguous([48, 41, 48, 43]), 'C') // same chords, bass opens on C

assert.equal(classify({ drums: false, notas: [{ tono: 72, inicio: 0, duracion: 1 }, { tono: 74, inicio: 1, duracion: 1 }] }), 'melodia')
const waltz = song({ timeSignature: [3, 4] })
waltz.track('Piano', 0, [[60, 0, 1]])
assert.throws(() => splitMidi(waltz.bytes()), /Only 4\/4/)
assert.throws(() => splitMidi(new Uint8Array([1, 2, 3])), /not a MIDI file/)
console.log('split ok')
