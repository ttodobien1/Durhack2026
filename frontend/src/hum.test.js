// Run: node src/hum.test.js
// Sings melodies with a synthetic "voice" (harmonics, vibrato, off-key tuning, breath noise) and checks that the
// transcription gets the notes and rhythm back.
import assert from 'node:assert/strict'
import { transcribe } from './hum.js'

const RATE = 48000

/** notes: [midi, seconds] sung one after the other, with a short breath between notes. */
function sing(notes, { tuning = 0.3, gap = 0.05, noise = 0.004, seed = 1 } = {}) {
  let s = seed
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
  const total = notes.reduce((t, [, d]) => t + d + gap, 0.3)
  const out = new Float32Array(Math.ceil(total * RATE))
  let t = 0.15
  let phase = 0
  for (const [midi, seconds] of notes) {
    const start = Math.floor(t * RATE)
    const len = Math.floor(seconds * RATE)
    for (let i = 0; i < len; i++) {
      const time = i / RATE
      const vibrato = 0.2 * Math.sin(2 * Math.PI * 5.5 * time)
      const hz = 440 * 2 ** ((midi + tuning + vibrato - 69) / 12)
      phase += (2 * Math.PI * hz) / RATE
      const env = Math.min(1, time / 0.02, (seconds - time) / 0.03)
      out[start + i] = 0.3 * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase))
    }
    t += seconds + gap
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * random()
  return out
}

const intervals = (notas) => notas.slice(1).map((n, i) => n.tono - notas[i].tono)

// Für Elise opening, hummed by a low voice: E D# E D# E B D C A
const elise = [64, 63, 64, 63, 64, 59, 62, 60, 57].map((m, i) => [m - 12, i === 8 ? 0.6 : 0.22])
{
  const { notas, compases } = transcribe(sing(elise), RATE, 90)
  assert.equal(notas.length, 9, `notes: ${notas.map((n) => n.tono).join(' ')}`)
  assert.deepEqual(intervals(notas), [-1, 1, -1, 1, -5, 3, -2, -3])
  assert.ok(notas[0].tono >= 60 && notas[0].tono < 72, 'moved to a comfortable octave')
  assert.ok(notas.every((n) => Number.isInteger(n.inicio * 4)), 'on the 16th-note grid')
  assert.ok(compases >= 1)
}

// Repeated notes ("da-da-da") stay separate notes: Ode to Joy E E F G G F E D
{
  const ode = [64, 64, 65, 67, 67, 65, 64, 62].map((m) => [m, 0.35])
  const { notas } = transcribe(sing(ode, { tuning: -0.35, gap: 0.06, seed: 7 }), RATE, 100)
  assert.deepEqual(notas.map((n) => n.tono - notas[0].tono), [0, 0, 1, 3, 3, 1, 0, -2])
}

// Rhythm: a long note then short ones keeps its proportions (in beats at the given tempo)
{
  const { notas } = transcribe(sing([[60, 0.9], [62, 0.25], [64, 0.25], [65, 0.9]], { gap: 0.05 }), RATE, 60)
  const lengths = notas.slice(1).map((n, i) => n.inicio - notas[i].inicio)
  assert.ok(lengths[0] > lengths[1] * 2.5, `lengths ${lengths}`)
}

// Silence or noise only: no notes
{
  assert.equal(transcribe(new Float32Array(RATE), RATE).notas.length, 0)
  assert.equal(transcribe(sing([], { noise: 0.01 }), RATE).notas.length, 0)
}

console.log('hum.test.js: all tests passed')
