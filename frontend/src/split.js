// Split a MIDI song into candidate pieces (contract 4.1 notes) for the upload page.
// Same rules as role C's Groove pipeline (data/scripts 04, 05, 08), ported so it runs in the browser:
// type per track, bar-aligned 4- and 2-bar loops, near-duplicate windows collapsed into one pattern.
import tonejsMidi from '@tonejs/midi'

const { Midi } = tonejsMidi // CommonJS package: named imports fail in Node

const BAR = 4 // beats per bar; only 4/4 files are accepted
const GRID = 0.25 // a 16th note: notes are placed in bars and compared on this grid
const POLYPHONY_THRESHOLD = 0.2 // share of notes that overlap another one -> chords
const BASS_MAX_MEAN = 55 // mean pitch below G3 -> bass
const NEAR_DUP = 0.9 // windows this alike are the same pattern
const MAX_PER_PART = 3
const MAX_TOTAL = 16
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI bytes -> { tempo, parts: [{ label, drums, notas }] } with times in beats. Throws a readable Error. */
export function readMidi(bytes) {
  let midi
  try {
    midi = new Midi(bytes)
  } catch {
    throw new Error('This file is not a MIDI file this page can read.')
  }
  const [num, den] = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4]
  if (num !== 4 || den !== 4) throw new Error(`Only 4/4 songs can be split (this one is ${num}/${den}).`)
  const ppq = midi.header.ppq
  const parts = midi.tracks
    .filter((t) => t.notes.length)
    .map((t, i) => ({
      label: t.name?.trim() || t.instrument?.name || `Track ${i + 1}`,
      drums: t.channel === 9 || t.instrument?.percussion,
      notas: t.notes.map((n) => ({ tono: n.midi, inicio: n.ticks / ppq, duracion: Math.max(n.durationTicks / ppq, 0.01), velocidad: Math.round(n.velocity * 100) / 100 })),
    }))
  if (!parts.length) throw new Error('This MIDI file has no notes.')
  return { tempo: Math.round(midi.header.tempos[0]?.bpm ?? 120), parts }
}

/** Share of notes that start while an earlier note still sounds (04_split_by_type.py). */
function polyphony(notas) {
  let overlapping = 0
  let latestEnd = -1
  for (const n of [...notas].sort((a, b) => a.inicio - b.inicio)) {
    if (n.inicio < latestEnd - 1e-6) overlapping++
    latestEnd = Math.max(latestEnd, n.inicio + n.duracion)
  }
  return notas.length > 1 ? overlapping / notas.length : 0
}

export function classify({ drums, notas }) {
  if (drums) return 'ritmo'
  if (polyphony(notas) > POLYPHONY_THRESHOLD) return 'acordes'
  return notas.reduce((s, n) => s + n.tono, 0) / notas.length < BASS_MAX_MEAN ? 'bajo' : 'melodia'
}

/**
 * Key of the pitched notes (Krumhansl-Schmuckler on duration-weighted pitch classes), e.g. "Am" or "F#".
 * A major key and its relative minor share every note (C / Am), so the counts alone cannot tell them apart:
 * `firstBass` (the song's first bass note) breaks the tie, since songs almost always open on their home note.
 */
export function detectKey(notas, firstBass) {
  if (!notas.length) return null
  const hist = Array(12).fill(0)
  for (const n of notas) hist[n.tono % 12] += n.duracion
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  const corr = (profile, root) => {
    const xs = hist
    const ys = xs.map((_, i) => profile[(i - root + 12) % 12])
    const mx = xs.reduce((a, b) => a + b) / 12
    const my = ys.reduce((a, b) => a + b) / 12
    let num = 0, dx = 0, dy = 0
    for (let i = 0; i < 12; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    return num / Math.sqrt(dx * dy || 1)
  }
  let best = { score: -Infinity, key: null }
  for (let root = 0; root < 12; root++)
    for (const [profile, suffix] of [[MAJOR, ''], [MINOR, 'm']]) {
      const score = corr(profile, root)
      if (score > best.score) best = { score, root, minor: suffix === 'm' }
    }
  const relative = best.minor ? { root: (best.root + 3) % 12, minor: false } : { root: (best.root + 9) % 12, minor: true }
  const home = firstBass == null ? null : firstBass % 12
  const pick = home === relative.root && home !== best.root ? relative : best
  return KEYS[pick.root] + (pick.minor ? 'm' : '')
}

/** First note of the bass part, else the lowest note of the first pitched onset. */
function firstBassNote(parts) {
  const pitched = parts.filter((p) => !p.drums)
  const bass = pitched.filter((p) => classify(p) === 'bajo').flatMap((p) => p.notas)
  const pool = bass.length ? bass : pitched.flatMap((p) => p.notas)
  if (!pool.length) return null
  const start = Math.min(...pool.map((n) => n.inicio))
  return Math.min(...pool.filter((n) => n.inicio - start < GRID).map((n) => n.tono))
}

const gridOf = (n) => Math.round(n.inicio / GRID) * GRID // a hit played a bit early stays in its bar
const hits = (notas, start) => new Set(notas.map((n) => `${n.tono}@${Math.round((gridOf(n) - start) / GRID)}`))
function similarity(a, b) {
  let common = 0
  for (const h of a) if (b.has(h)) common++
  return common / Math.max(a.size, b.size, 1)
}

/** Notes of bars [startBar, startBar + bars), moved to beat 0 and cut at the window end. */
function windowNotes(notas, startBar, bars) {
  const start = startBar * BAR
  const end = start + bars * BAR
  return notas
    .filter((n) => gridOf(n) >= start && gridOf(n) < end)
    .map((n) => ({ ...n, inicio: Math.max(0, Math.round((n.inicio - start) * 1000) / 1000), duracion: Math.min(n.duracion, end - n.inicio) }))
}

/** A window is a loop if no bar is (nearly) empty: drums need 4 hits a bar, pitched parts 1 note (05_slice.py). */
function usable(notas, startBar, bars, drums) {
  const perBar = Array(bars).fill(0)
  for (const n of notas) {
    const b = Math.floor(gridOf(n) / BAR) - startBar
    if (b >= 0 && b < bars) perBar[b]++
  }
  return perBar.every((c) => c >= (drums ? 4 : 1))
}

/**
 * Candidate loops of one part: distinct 4-bar patterns, plus 2-bar ones where the music repeats every 2 bars
 * or no 4-bar window works. Each pattern keeps how often it repeats; the most repeated come first.
 */
export function slicePart(part) {
  const lastBar = Math.floor(Math.max(...part.notas.map(gridOf)) / BAR)
  const groups = [] // { startBar, bars, hits, repeats }
  const covered = new Set()
  const add = (startBar, bars) => {
    const h = hits(windowNotes(part.notas, startBar, bars), 0)
    const same = groups.find((g) => g.bars === bars && similarity(g.hits, h) >= NEAR_DUP)
    if (same) same.repeats++
    else groups.push({ startBar, bars, hits: h, repeats: 1 })
  }
  for (let s = 0; s + 4 <= lastBar + 1; s += 4) {
    if (!usable(part.notas, s, 4, part.drums)) continue
    const halves = [hits(windowNotes(part.notas, s, 2), 0), hits(windowNotes(part.notas, s + 2, 2), 0)]
    if (similarity(...halves) >= NEAR_DUP) continue // really a 2-bar loop: the 2-bar pass picks it up
    add(s, 4)
    for (let b = s; b < s + 4; b++) covered.add(b)
  }
  for (let s = 0; s + 2 <= lastBar + 1; s += 2) {
    if (covered.has(s) || covered.has(s + 1) || !usable(part.notas, s, 2, part.drums)) continue
    add(s, 2)
  }
  return groups
    .sort((a, b) => b.repeats - a.repeats || a.startBar - b.startBar)
    .slice(0, MAX_PER_PART)
    .map((g) => ({ desde: g.startBar, compases: g.bars, repeats: g.repeats, notas: windowNotes(part.notas, g.startBar, g.bars) }))
}

/** MIDI bytes -> { tempo, tonalidad, candidates: [{ part, tipo, desde, compases, repeats, notas }] } (at most 16). */
export function splitMidi(bytes) {
  const { tempo, parts } = readMidi(bytes)
  const tonalidad = detectKey(parts.filter((p) => !p.drums).flatMap((p) => p.notas), firstBassNote(parts))
  const candidates = parts
    .flatMap((part) => {
      const tipo = classify(part)
      return slicePart(part).map((c) => ({ ...c, part: part.label, tipo }))
    })
    .slice(0, MAX_TOTAL)
  if (!candidates.length) throw new Error('No loops found: every 2- and 4-bar window had an empty bar.')
  return { tempo, tonalidad, candidates }
}
