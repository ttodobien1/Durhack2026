// Run: node src/hum.test.js
// Sings melodies with a synthetic "voice" (harmonics, vibrato, off-key tuning, breath noise) and checks that the
// transcription gets the notes and rhythm back.
import assert from 'node:assert/strict'
import { transcribe } from './hum.js'

const RATE = 48000

/**
 * notes: [midi, seconds] sung one after the other, with a short breath (`gap`) between notes. Options for an
 * unsteady human voice:
 *   vibrato  semitones of vibrato (5.5 Hz)
 *   scoop    semitones below the note at its start, gliding up in 60 ms
 *   slide    seconds of glide from the previous note (use with gap 0: legato)
 *   bumps    { every, length, size }: brief off-pitch moments (seconds, seconds, semitones)
 *   flicker  { every, length, depth }: brief loudness drops (seconds, seconds, fraction left)
 */
function sing(notes, { tuning = 0.3, gap = 0.05, noise = 0.004, seed = 1, vibrato = 0.2, scoop = 0, slide = 0, bumps = null, flicker = null } = {}) {
  let s = seed
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
  const total = notes.reduce((t, [, d]) => t + d + gap, 0.3)
  const out = new Float32Array(Math.ceil(total * RATE))
  let t = 0.15
  let phase = 0
  let prevMidi = null
  for (const [midi, seconds] of notes) {
    const start = Math.floor(t * RATE)
    const len = Math.floor(seconds * RATE)
    const from = slide && prevMidi !== null ? prevMidi : midi - scoop
    const glide = slide && prevMidi !== null ? slide : 0.06
    for (let i = 0; i < len; i++) {
      const time = i / RATE
      let pitch = midi + tuning + vibrato * Math.sin(2 * Math.PI * 5.5 * time)
      if (time < glide) pitch += (from - midi) * (1 - time / glide)
      if (bumps && (time + 0.07) % bumps.every < bumps.length) pitch += bumps.size
      const hz = 440 * 2 ** ((pitch - 69) / 12)
      phase += (2 * Math.PI * hz) / RATE
      let env = gap || !prevMidi ? Math.min(1, time / 0.02, (seconds - time) / 0.03) : Math.min(1, (seconds - time) / 0.03)
      if (flicker && (time + 0.11) % flicker.every < flicker.length) env *= flicker.depth
      out[start + i] = 0.3 * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase))
    }
    prevMidi = midi
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

// An unsteady voice holding three long notes: wide vibrato, a scoop into each note, brief off-pitch moments (60 ms,
// almost a semitone sharp), loudness flickers, and legato slides between the notes. Still exactly three notes.
{
  const wobbly = sing([[60, 1.2], [64, 1.2], [67, 1.2]], {
    gap: 0,
    vibrato: 0.45,
    scoop: 1.5,
    slide: 0.1,
    bumps: { every: 0.3, length: 0.06, size: 0.9 },
    flicker: { every: 0.35, length: 0.012, depth: 0.5 },
    seed: 11,
  })
  const { notas } = transcribe(wobbly, RATE, 60)
  assert.deepEqual(notas.map((n) => n.tono - notas[0].tono), [0, 4, 7], `notes: ${notas.map((n) => n.tono).join(' ')}`)
}

// Detached notes with the same wobbles: each "da" is still one note.
{
  const notes = [62, 64, 66, 67, 69].map((m) => [m, 0.45])
  const { notas } = transcribe(sing(notes, { vibrato: 0.4, scoop: 1, bumps: { every: 0.25, length: 0.05, size: 0.8 }, seed: 5 }), RATE, 90)
  assert.deepEqual(intervals(notas), [2, 2, 1, 2], `notes: ${notas.map((n) => n.tono).join(' ')}`)
}

// Silence or noise only: no notes
{
  assert.equal(transcribe(new Float32Array(RATE), RATE).notas.length, 0)
  assert.equal(transcribe(sing([], { noise: 0.01 }), RATE).notas.length, 0)
}

console.log('hum.test.js: all tests passed')
