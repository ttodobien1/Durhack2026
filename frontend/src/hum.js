// Humming -> notes, entirely in the browser (no audio ever leaves the page: only the resulting notes are sent).
//   startHumRecorder()  records the microphone and reports the live level and pitch while you hum
//   transcribe()        turns the recording into notes in contract 4.1 format (beats at the project tempo)
// Pitch detection is YIN (de Cheveigné & Kawahara, 2002) on a downsampled signal; the notes are then tuned to the
// singer's own pitch and snapped to a 16th-note grid.
//
// The note tracker is deliberately calm, like the note stage of pYIN / Tony (an HMM with attack, stable and silent
// states) and Spotify's Basic Pitch (separate onset and sustain thresholds, notes of at least ~128 ms):
//   - hysteresis on pitch: a note goes on while the voice stays near its center; vibrato, wobbles and scoops do not
//     end it. A new note needs a NEW pitch that is held for SETTLE_SECONDS; a slide between two notes is never held,
//     so it is absorbed by the previous note instead of becoming notes of its own.
//   - hysteresis on loudness: a note starts above a higher gate than the one it needs to keep going.
//   - only a real "d" between two "da"s (a deep dip for DIP_SECONDS) or a real pause splits a note; a short pitch
//     dropout inside a loud note is bridged.
//   - notes shorter than the minimum are merged into the neighbour they touch, or dropped when isolated.

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export const noteName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

const TARGET_RATE = 11025 // enough for a voice's fundamental (60–1000 Hz) and fast to analyse
const MIN_HZ = 65
const MAX_HZ = 1000
const HOP_SECONDS = 0.01
const WINDOW_SECONDS = 0.045
const GRID = 0.25 // beats: 16th notes
const SHORT_SECONDS = 0.012 // window of the loudness used to spot the dip of a "d"

// Note tracker (see the header).
const SMOOTH_FRAMES = 7 // median filter on the pitch contour: 70 ms
const ONSET_GRACE_SECONDS = 0.06 // the start of a note (a scoop up to the pitch) is never a pitch change
const HOLD_SEMITONES = 0.8 // a note keeps going while the pitch stays this close to its center
const SETTLE_SEMITONES = 0.5 // a new pitch is "held" while it stays this close to itself...
const SETTLE_SECONDS = 0.09 // ...and it must be held this long to start a new note
const BRIDGE_SECONDS = 0.08 // pitch dropouts shorter than this inside a loud note are bridged
const DIP_RATIO = 0.3 // "da-da": loudness under 30% of the note's usual level...
const DIP_SECONDS = 0.02 // ...for 20 ms re-articulates (splits) the note
const ONSET_GATE = 1.6 // a note starts only this many times above the loudness gate (it then needs just the gate)
const MIN_NOTE_SECONDS = 0.1 // an isolated note shorter than this is noise
const MIN_TOUCHING_SECONDS = 0.13 // a note this short glued to another one is a slide: it joins its neighbour
const TOUCH_SECONDS = 0.03 // closer than this, two notes are glued (no pause or "d" between them)

const toMidi = (hz) => 69 + 12 * Math.log2(hz / 440)
const median = (values) => {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const percentile = (values, p) => {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}

/** Averages groups of samples down to about TARGET_RATE (a crude low-pass is fine for pitch). */
function downsample(samples, rate) {
  const factor = Math.max(1, Math.round(rate / TARGET_RATE))
  if (factor === 1) return { data: samples, rate }
  const data = new Float32Array(Math.floor(samples.length / factor))
  for (let i = 0; i < data.length; i++) {
    let sum = 0
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k]
    data[i] = sum / factor
  }
  return { data, rate: rate / factor }
}

/** YIN pitch of data[start, start + size): { hz, clarity } or null. Needs `maxLag` samples after the window. */
function yin(data, start, size, rate) {
  const minLag = Math.floor(rate / MAX_HZ)
  const maxLag = Math.min(Math.ceil(rate / MIN_HZ), data.length - start - size)
  if (maxLag <= minLag + 2) return null
  const diff = new Float32Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let j = 0; j < size; j++) {
      const d = data[start + j] - data[start + j + lag]
      sum += d * d
    }
    diff[lag] = sum
  }
  // Cumulative mean normalized difference: dips below the threshold at the period.
  const cmnd = new Float32Array(maxLag + 1)
  cmnd[0] = 1
  let running = 0
  for (let lag = 1; lag <= maxLag; lag++) {
    running += diff[lag]
    cmnd[lag] = running ? (diff[lag] * lag) / running : 1
  }
  let lag = -1
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < 0.15) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++
      lag = t
      break
    }
  }
  if (lag < 0) {
    // No clear dip: take the deepest one if it is still fairly periodic.
    let best = minLag
    for (let t = minLag; t <= maxLag; t++) if (cmnd[t] < cmnd[best]) best = t
    if (cmnd[best] > 0.3) return null
    lag = best
  }
  // Parabolic interpolation around the dip for sub-sample precision.
  const a = cmnd[lag - 1] ?? cmnd[lag]
  const b = cmnd[lag]
  const c = cmnd[lag + 1] ?? cmnd[lag]
  const shift = a + c - 2 * b ? (a - c) / (2 * (a + c - 2 * b)) : 0
  const hz = rate / (lag + shift)
  return hz >= MIN_HZ && hz <= MAX_HZ ? { hz, clarity: 1 - b } : null
}

function rms(data, start, size) {
  let sum = 0
  for (let j = 0; j < size; j++) sum += data[start + j] ** 2
  return Math.sqrt(sum / size)
}

/** Live reading of the last moment of sound: { level 0–1, pitch (MIDI, float) | null }. */
export function liveReading(samples, rate) {
  const { data, rate: r } = downsample(samples, rate)
  const size = Math.floor(WINDOW_SECONDS * r)
  const lagRoom = Math.ceil(r / MIN_HZ)
  if (data.length < size + lagRoom) return { level: 0, pitch: null }
  const start = data.length - size - lagRoom
  const level = rms(data, start, size + lagRoom)
  const found = level > 0.01 ? yin(data, start, size, r) : null
  return { level: Math.min(1, level * 6), pitch: found ? toMidi(found.hz) : null }
}

/**
 * Steadies the live note name shown while recording: the median of the last readings, and the shown note only
 * changes when the voice clearly moves to another one. Call it once per reading; returns a MIDI note or null.
 */
export function liveNoteTracker(size = 10) {
  const recent = []
  let shown = null
  return (pitch) => {
    recent.push(pitch)
    if (recent.length > size) recent.shift()
    const voiced = recent.filter((p) => p !== null)
    if (voiced.length < recent.length * 0.6) return (shown = voiced.length ? shown : null)
    const mid = median(voiced)
    if (shown === null || Math.abs(mid - shown) > HOLD_SEMITONES) shown = Math.round(mid)
    return shown
  }
}

/** Pitch track: one frame every 10 ms with { time, rms, level, midi (float) | null }, plus the loudness gate. */
function pitchTrack(samples, sampleRate) {
  const { data, rate } = downsample(samples, sampleRate)
  const size = Math.floor(WINDOW_SECONDS * rate)
  const hop = Math.max(1, Math.round(HOP_SECONDS * rate))
  const lagRoom = Math.ceil(rate / MIN_HZ)
  const short = Math.max(1, Math.round(SHORT_SECONDS * rate))
  const frames = []
  for (let start = 0; start + size + lagRoom <= data.length; start += hop) {
    // `level`: loudness right at the frame (a short window), to catch the brief dip of a "d" between two "da"s.
    const at = start + ((size - short) >> 1)
    frames.push({ time: start / rate, rms: rms(data, start, size), level: rms(data, at, short), start })
  }
  if (!frames.length) return { frames, gate: 0 }
  // Loudness gate relative to this recording: above the room noise, and not a whisper next to the loudest part.
  // Capped well below the peak, so humming with almost no pauses (no room noise to measure) still passes.
  const levels = frames.map((f) => f.rms)
  const peak = percentile(levels, 0.95)
  const gate = Math.min(peak * 0.3, Math.max(0.004, percentile(levels, 0.05) * 2.5, peak * 0.12))
  for (const f of frames) {
    const pitch = f.rms >= gate ? yin(data, f.start, size, rate) : null
    f.midi = pitch ? toMidi(pitch.hz) : null
  }
  // Fix octave jumps (a classic pitch-tracker error), then a 70 ms median over the voiced neighbours: vibrato and
  // jitter are flattened before any note decision is made.
  const half = SMOOTH_FRAMES >> 1
  const around = (i) => frames.slice(Math.max(0, i - half), i + half + 1).map((x) => x.midi).filter((m) => m !== null)
  const unjumped = frames.map((f, i) => {
    if (f.midi === null) return null
    const mid = median(around(i))
    return Math.abs(f.midi - mid) > 9 ? f.midi - 12 * Math.round((f.midi - mid) / 12) : f.midi
  })
  frames.forEach((f, i) => (f.midi = unjumped[i]))
  const smoothed = frames.map((f, i) => (f.midi === null ? null : median(around(i))))
  frames.forEach((f, i) => (f.midi = smoothed[i]))
  return { frames, gate }
}

/** Splits the pitch track into notes: [{ start, end (seconds), midi (float), rms }]. See the header for the rules. */
function segment({ frames, gate }) {
  const notes = []
  let note = null // { start, end, pitches, levels, rms }
  let candidate = null // { start, pitches }: a new pitch waiting to prove it is held
  let gapFrames = 0 // unvoiced or quiet frames in a row inside the note
  let quietFrames = 0 // of those, the quiet ones in a row ("d" of "da", or a pause)

  const center = (n) => median(n.pitches.slice(Math.min(3, n.pitches.length >> 1)).slice(-30)) // follows slow drift
  const usual = (n) => median(n.levels.slice(-30))
  const close = () => {
    if (note && note.pitches.length >= 3) {
      // The note's pitch: the middle of it, without the scoop at the start or the fall at the end.
      const p = note.pitches
      const body = p.slice(Math.floor(p.length * 0.15), Math.max(Math.floor(p.length * 0.15) + 1, Math.ceil(p.length * 0.9)))
      notes.push({ start: note.start, end: note.end, midi: median(body), rms: note.rms })
    }
    note = null
    candidate = null
  }
  const open = (start, pitches, f) => {
    note = { start, end: f.time + HOP_SECONDS, pitches, levels: [f.level], rms: f.rms }
  }

  for (const f of frames) {
    const quiet = note ? f.level < usual(note) * DIP_RATIO : false
    if (f.midi === null || quiet) {
      if (note) {
        gapFrames++
        quietFrames = quiet || f.rms < gate ? quietFrames + 1 : 0
        // A pause or a "d" ends the note where the gap began; a short pitch dropout in a loud note is bridged.
        if (quietFrames * HOP_SECONDS >= DIP_SECONDS || gapFrames * HOP_SECONDS >= BRIDGE_SECONDS) {
          note.end = f.time - (gapFrames - 1) * HOP_SECONDS
          close()
        }
      }
      continue
    }
    gapFrames = 0
    quietFrames = 0

    if (!note) {
      if (f.rms >= gate * ONSET_GATE) open(f.time, [f.midi], f)
      continue
    }
    note.end = f.time + HOP_SECONDS
    note.levels.push(f.level)
    note.rms = Math.max(note.rms, f.rms)
    if (f.time - note.start < ONSET_GRACE_SECONDS || Math.abs(f.midi - center(note)) <= HOLD_SEMITONES) {
      note.pitches.push(f.midi)
      candidate = null // a wobble that came back: still the same note
      continue
    }
    // Away from the note: is it a new pitch being held, or just a slide / wobble?
    if (candidate && Math.abs(f.midi - median(candidate.pitches)) <= SETTLE_SEMITONES) candidate.pitches.push(f.midi)
    else candidate = { start: f.time, pitches: [f.midi] }
    if (candidate.pitches.length * HOP_SECONDS >= SETTLE_SECONDS) {
      const next = candidate
      note.end = next.start
      close()
      open(next.start, next.pitches, f)
    }
  }
  close()
  return tidy(notes)
}

/**
 * Cleans the raw notes the way a person would: a very short note glued to a neighbour is part of a slide and joins
 * the neighbour closest in pitch; a very short isolated note is noise and goes.
 */
function tidy(raw) {
  const notes = raw.map((n) => ({ ...n }))
  const length = (n) => n.end - n.start
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]
      const prev = notes[i - 1]
      const next = notes[i + 1]
      const gluedPrev = prev && n.start - prev.end < TOUCH_SECONDS
      const gluedNext = next && next.start - n.end < TOUCH_SECONDS
      if ((gluedPrev || gluedNext) && length(n) < MIN_TOUCHING_SECONDS) {
        const into =
          gluedPrev && gluedNext ? (Math.abs(prev.midi - n.midi) <= Math.abs(next.midi - n.midi) ? prev : next) : gluedPrev ? prev : next
        into.start = Math.min(into.start, n.start)
        into.end = Math.max(into.end, n.end)
        into.rms = Math.max(into.rms, n.rms)
      } else if (!gluedPrev && !gluedNext && length(n) < MIN_NOTE_SECONDS) {
        // isolated blip: dropped below
      } else continue
      notes.splice(i, 1)
      changed = true
      break
    }
  }
  return notes
}

/**
 * Recording -> notes at `bpm`: { notas: [{ tono, inicio, duracion, velocidad }], compases }. inicio / duracion are in
 * beats, so the notes replay at the speed they were hummed when the project plays at `bpm`.
 */
export function transcribe(samples, sampleRate, bpm = 96) {
  const raw = segment(pitchTrack(samples, sampleRate))
  if (raw.length < 2) return { notas: [], compases: 1 }

  // Most people hum a little sharp or flat: find their own tuning (circular mean of the cents) and round from it.
  let x = 0
  let y = 0
  for (const n of raw) {
    const angle = 2 * Math.PI * n.midi
    const w = n.end - n.start
    x += Math.cos(angle) * w
    y += Math.sin(angle) * w
  }
  const tuning = Math.atan2(y, x) / (2 * Math.PI)
  const rounded = raw.map((n) => ({ ...n, tono: Math.round(n.midi - tuning) }))

  // Two glued notes that round to the same pitch were one note with a wobble: join them back. Repeated notes that
  // were articulated ("da-da", a pause) have a gap between them and stay separate.
  const joined = []
  for (const n of rounded) {
    const last = joined[joined.length - 1]
    if (last && last.tono === n.tono && n.start - last.end < TOUCH_SECONDS) last.end = n.end
    else joined.push({ ...n })
  }

  // Into a comfortable octave for playback (around middle C); matching ignores the octave anyway.
  const octave = 12 * Math.round((66 - median(joined.map((n) => n.tono))) / 12)
  const beat = (seconds) => (seconds * bpm) / 60
  const snap = (beats) => Math.round(beats / GRID) * GRID
  const t0 = joined[0].start
  const loudest = Math.max(...joined.map((n) => n.rms)) || 1

  const notas = []
  for (const n of joined) {
    let inicio = snap(beat(n.start - t0))
    const prev = notas[notas.length - 1]
    if (prev && inicio <= prev.inicio) inicio = prev.inicio + GRID // two notes on the same 16th: push the second one
    if (prev) prev.duracion = Math.max(GRID, Math.min(prev.duracion, inicio - prev.inicio))
    notas.push({
      tono: Math.min(127, Math.max(0, n.tono + octave)),
      inicio,
      duracion: Math.max(GRID, snap(beat(n.end - n.start))),
      velocidad: Math.round((0.55 + 0.4 * (n.rms / loudest)) * 100) / 100,
    })
  }
  const end = Math.max(...notas.map((n) => n.inicio + n.duracion))
  return { notas: notas.slice(0, 400), compases: Math.min(32, Math.max(1, Math.ceil(end / 4))) }
}

// Collects raw microphone samples off the audio thread, in 2048-sample batches.
const TAP = `class StemmaTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
    }
    return true
  }
}
registerProcessor('stemma-tap', StemmaTap)`

/**
 * Starts recording the microphone. `onLive({ level, midi, seconds })` is called on every animation frame.
 * Resolves to { stop(): Promise<{ samples, sampleRate }>, cancel() }. Throws if the microphone is unavailable.
 */
export async function startHumRecorder({ onLive, maxSeconds = 15, onLimit } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone (it needs https or localhost).')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const chunks = []
  let total = 0
  const push = (chunk) => {
    chunks.push(chunk)
    total += chunk.length
  }
  const mute = ctx.createGain()
  mute.gain.value = 0 // the tap must be pulled by the graph, but nobody needs to hear themselves
  mute.connect(ctx.destination)
  let node
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'stemma-tap')
    node.port.onmessage = (e) => push(e.data)
  } else {
    node = ctx.createScriptProcessor(2048, 1, 1) // older browsers
    node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  source.connect(node)
  node.connect(mute)

  let raf = 0
  let done = false
  const recent = () => {
    const need = Math.ceil(ctx.sampleRate * 0.1)
    const parts = []
    let n = 0
    for (let i = chunks.length - 1; i >= 0 && n < need; i--) {
      parts.unshift(chunks[i])
      n += chunks[i].length
    }
    const out = new Float32Array(n)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
  const liveNote = liveNoteTracker()
  const tick = () => {
    if (done) return
    const seconds = total / ctx.sampleRate
    const { level, pitch } = liveReading(recent(), ctx.sampleRate)
    onLive?.({ level, midi: liveNote(pitch), seconds })
    if (seconds >= maxSeconds) onLimit?.()
    else raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  const close = () => {
    done = true
    cancelAnimationFrame(raf)
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => {})
  }
  return {
    async stop() {
      const sampleRate = ctx.sampleRate
      close()
      const samples = new Float32Array(total)
      let o = 0
      for (const c of chunks) {
        samples.set(c, o)
        o += c.length
      }
      return { samples, sampleRate }
    },
    cancel: close,
  }
}
