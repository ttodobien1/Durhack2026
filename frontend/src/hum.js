// Humming -> notes, entirely in the browser (no audio ever leaves the page: only the resulting notes are sent).
//   startHumRecorder()  records the microphone and reports the live level and pitch while you hum
//   transcribe()        turns the recording into notes in contract 4.1 format (beats at the project tempo)
// Pitch detection is YIN (de Cheveigné & Kawahara, 2002) on a downsampled signal; notes are split on silences,
// "da-da" articulations and pitch changes, tuned to the singer's own pitch and snapped to a 16th-note grid.

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export const noteName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

const TARGET_RATE = 11025 // enough for a voice's fundamental (60–1000 Hz) and fast to analyse
const MIN_HZ = 65
const MAX_HZ = 1000
const HOP_SECONDS = 0.01
const WINDOW_SECONDS = 0.045
const GRID = 0.25 // beats: 16th notes
const MIN_NOTE_SECONDS = 0.07
const SHORT_SECONDS = 0.012

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

/** Live reading of the last moment of sound: { level 0–1, midi | null }. */
export function liveReading(samples, rate) {
  const { data, rate: r } = downsample(samples, rate)
  const size = Math.floor(WINDOW_SECONDS * r)
  const lagRoom = Math.ceil(r / MIN_HZ)
  if (data.length < size + lagRoom) return { level: 0, midi: null }
  const start = data.length - size - lagRoom
  const level = rms(data, start, size + lagRoom)
  const pitch = level > 0.01 ? yin(data, start, size, r) : null
  return { level: Math.min(1, level * 6), midi: pitch ? Math.round(toMidi(pitch.hz)) : null }
}

/** Pitch track: one frame every 10 ms with { time, rms, midi (float) | null }. */
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
  if (!frames.length) return []
  // Loudness gate relative to this recording: above the room noise, and not a whisper next to the loudest part.
  // Capped well below the peak, so humming with almost no pauses (no room noise to measure) still passes.
  const levels = frames.map((f) => f.rms)
  const peak = percentile(levels, 0.95)
  const gate = Math.min(peak * 0.3, Math.max(0.004, percentile(levels, 0.05) * 2.5, peak * 0.12))
  for (const f of frames) {
    const pitch = f.rms >= gate ? yin(data, f.start, size, rate) : null
    f.midi = pitch ? toMidi(pitch.hz) : null
  }
  // Smooth with a 5-frame median and fix single octave jumps (a classic pitch-tracker error).
  const smoothed = frames.map((f, i) => {
    if (f.midi === null) return null
    const around = frames.slice(Math.max(0, i - 2), i + 3).map((x) => x.midi).filter((m) => m !== null)
    const mid = median(around)
    let m = f.midi
    if (Math.abs(m - mid) > 9) m -= 12 * Math.round((m - mid) / 12)
    return median([m, ...around.filter((x) => Math.abs(x - mid) <= 9)])
  })
  frames.forEach((f, i) => (f.midi = smoothed[i]))
  return frames
}

/** Splits the pitch track into notes: [{ start, end (seconds), midi (float), rms }]. */
function segment(frames) {
  const notes = []
  let current = null
  let gap = 0
  let odd = [] // frames that left the current pitch, waiting to see if it is a real change
  const finish = (endTime) => {
    if (current && endTime - current.start >= MIN_NOTE_SECONDS && current.pitches.length >= 3) {
      const settled = current.pitches.slice(Math.min(2, current.pitches.length >> 2)) // skip the attack glide
      notes.push({ start: current.start, end: endTime, midi: median(settled), rms: current.peak })
    }
    current = null
    odd = []
  }
  for (const f of frames) {
    // A dip in loudness inside a note ("da-da") counts as a gap, so repeated notes stay separate. A deep one splits
    // the note even if it is very short.
    const dip = current ? f.level / current.peakLevel : 1
    const silent = f.midi === null || dip < 0.45
    if (silent) {
      gap++
      if (current && (gap >= 2 || dip < 0.3)) finish(f.time - (gap - 1) * HOP_SECONDS)
      continue
    }
    gap = 0
    if (!current) {
      current = { start: f.time, pitches: [f.midi], peak: f.rms, peakLevel: f.level }
      continue
    }
    const ref = median(current.pitches.slice(-6))
    if (Math.abs(f.midi - ref) > 0.75) {
      odd.push(f)
      if (odd.length >= 3) {
        const moved = odd
        finish(moved[0].time)
        current = {
          start: moved[0].time,
          pitches: moved.map((x) => x.midi),
          peak: Math.max(...moved.map((x) => x.rms)),
          peakLevel: Math.max(...moved.map((x) => x.level)),
        }
      }
    } else {
      odd = []
      current.pitches.push(f.midi)
      current.peak = Math.max(current.peak, f.rms)
      current.peakLevel = Math.max(current.peakLevel, f.level)
    }
  }
  if (current) finish(frames[frames.length - 1].time + HOP_SECONDS)
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

  // A pitch wobble can split one note in two with no gap: join them back.
  const joined = []
  for (const n of rounded) {
    const last = joined[joined.length - 1]
    if (last && last.tono === n.tono && n.start - last.end < 0.015) last.end = n.end
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
  const tick = () => {
    if (done) return
    const seconds = total / ctx.sampleRate
    onLive?.({ ...liveReading(recent(), ctx.sampleRate), seconds })
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
