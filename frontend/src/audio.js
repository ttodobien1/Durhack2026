// Tone.js playback. Times stay in beats (quarter notes) and are scheduled as transport ticks,
// so changing the tempo never touches the note data.
import * as Tone from 'tone'

const transport = Tone.getTransport()
const out = new Tone.Reverb({ decay: 1.6, wet: 0.12 }).toDestination()

// Salamander piano samples hosted by the Tone.js project; a synth plays until they load.
let pianoReady = false
const piano = new Tone.Sampler({
  urls: Object.fromEntries(
    ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7']
      .map((n) => [n, `${n.replace('#', 's')}.mp3`]),
  ),
  baseUrl: 'https://tonejs.github.io/audio/salamander/',
  release: 1,
  onload: () => (pianoReady = true),
}).connect(out)
const pianoFallback = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { release: 0.4 } }).connect(out)
pianoFallback.volume.value = -10

const bass = new Tone.MonoSynth({
  oscillator: { type: 'sawtooth' },
  filter: { Q: 1, type: 'lowpass' },
  filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2.5 },
  envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.2 },
}).toDestination()
bass.volume.value = -6

const lead = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'sine' },
  envelope: { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.5 },
}).connect(out)
lead.volume.value = -8

// Percussion is synthesized per General MIDI note number (Groove MIDI kits plus Latin percussion).
const kit = new Tone.Gain(0.9).connect(out)
const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(kit)
const snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(new Tone.Filter(1800, 'highpass').connect(kit))
const snareBody = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1.5, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(kit)
snareBody.volume.value = -10
const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5 }).connect(kit)
hat.volume.value = -22
const cymbal = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.9, release: 0.3 }, harmonicity: 5.1, modulationIndex: 40, resonance: 5000, octaves: 1.5 }).connect(kit)
cymbal.volume.value = -26
const clave = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } }).connect(kit)
const bell = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 } }).connect(kit)
bell.volume.value = -22
const drum = new Tone.PolySynth(Tone.MembraneSynth, { pitchDecay: 0.02, octaves: 1.5, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 } }).connect(kit)
drum.volume.value = -4
const CONGA_HZ = { 62: 340, 63: 300, 64: 210 }
const TOM_HZ = { 41: 90, 43: 110, 45: 130, 47: 160, 48: 190, 50: 220 }

// One-voice synths throw if asked to start twice at the same instant (e.g. closed + open hat on one beat in
// Groove MIDI data): nudge the second hit 1 ms later instead of losing it.
const lastStart = new Map()
function slot(synth, time) {
  const prev = lastStart.get(synth)
  time = Math.max(time, Tone.getContext().currentTime) // Tone clamps late starts to now; nudge from there
  const t = prev !== undefined && time <= prev ? prev + 0.001 : time
  lastStart.set(synth, t)
  return t
}

function hitDrum(tono, time, vel) {
  if (tono === 35 || tono === 36) kick.triggerAttackRelease('C1', 0.3, slot(kick, time), vel)
  else if (tono === 38 || tono === 40 || tono === 37 || tono === 39) {
    snareNoise.triggerAttackRelease(tono === 37 ? 0.03 : 0.12, slot(snareNoise, time), vel)
    if (tono !== 39) snareBody.triggerAttackRelease(185, 0.08, slot(snareBody, time), vel)
  } else if (tono === 42 || tono === 44 || tono === 22) hat.triggerAttackRelease(400, 0.04, slot(hat, time), vel)
  else if (tono === 46 || tono === 26) hat.triggerAttackRelease(400, 0.25, slot(hat, time), vel)
  else if ([49, 51, 52, 53, 55, 57, 59].includes(tono)) cymbal.triggerAttackRelease(300, tono === 51 || tono === 59 ? 0.3 : 1, slot(cymbal, time), vel * 0.8)
  else if (TOM_HZ[tono]) drum.triggerAttackRelease(TOM_HZ[tono], 0.3, time, vel)
  else if (tono === 75 || tono === 76 || tono === 77) clave.triggerAttackRelease(2500, 0.05, slot(clave, time), vel)
  else if (tono === 56) bell.triggerAttackRelease([540, 800], 0.1, time, vel)
  else drum.triggerAttackRelease(CONGA_HZ[tono] ?? Tone.Frequency(tono, 'midi').toFrequency(), 0.2, time, vel)
}

// Track `instrumento` values: Spanish like the backend's data (bateria, piano, bajo, melodia); English aliases still play.
export const instrumentFor = (tipo) => ({ ritmo: 'bateria', acordes: 'piano', bajo: 'bajo', melodia: 'melodia' })[tipo] ?? 'piano'
const VOICE = { bateria: 'drums', drums: 'drums', bajo: 'bass', bass: 'bass', melodia: 'lead', lead: 'lead' }

function trigger(name, n, time) {
  const instrument = VOICE[name] ?? 'piano'
  const dur = `${Math.round(n.duracion * transport.PPQ)}i`
  const freq = Tone.Frequency(n.tono, 'midi').toFrequency()
  if (instrument === 'drums') hitDrum(n.tono, time, n.velocidad)
  else if (instrument === 'bass') bass.triggerAttackRelease(freq, dur, slot(bass, time), n.velocidad)
  else if (instrument === 'lead') lead.triggerAttackRelease(freq, dur, time, n.velocidad)
  else (pianoReady ? piano : pianoFallback).triggerAttackRelease(freq, dur, time, n.velocidad)
}

let part = null
let mix = [] // per song lane: { vol: 0–1, mute }
/** Lane mix for events that carry `lane`. Velocity scales linearly with gain in Tone's voices. */
export const setMix = (m) => (mix = m)
let pos = 0 // playhead in beats while not running: 0 after stop, kept on pause and seek
const ticks = (beats) => `${Math.round(beats * transport.PPQ)}i`

function halt() {
  transport.stop()
  transport.cancel()
  part?.dispose()
  part = null
}

/** events: [{ instrument, tono, inicio, duracion, velocidad }] in beats. Starts at `from` (default: last position). */
export async function play({ events, bpm, lengthBeats, loop, onEnd, from = pos }) {
  await Tone.start()
  halt()
  transport.bpm.value = bpm
  part = new Tone.Part((time, ev) => {
    const m = mix[ev.lane] // read at trigger time so lane faders and mutes apply while playing
    if (m?.mute) return
    trigger(ev.instrument, m ? { ...ev, velocidad: ev.velocidad * m.vol } : ev, time)
  }, events.map((e) => [ticks(e.inicio), e]))
  part.start(0)
  if (loop) Object.assign(transport, { loop: true, loopStart: 0, loopEnd: ticks(lengthBeats) })
  else {
    transport.loop = false
    transport.scheduleOnce(() => Tone.getDraw().schedule(() => { stop(); onEnd?.() }, Tone.now()), ticks(lengthBeats))
  }
  transport.start('+0.05', ticks(Math.min(from, lengthBeats - 0.01)))
}

export function pause() {
  pos = currentBeat()
  halt()
}

export function stop() {
  pos = 0
  halt()
}

/** Move the playhead; works while playing, paused or stopped. */
export function seek(beat) {
  pos = Math.max(0, beat)
  if (transport.state === 'started') transport.ticks = Math.round(pos * transport.PPQ)
}

export const setBpm = (bpm) => (transport.bpm.value = bpm)

let volume = 80 // percent; 0 mutes
Tone.getDestination().volume.value = 20 * Math.log10(volume / 100)
export const getVolume = () => volume
export function setVolume(v) {
  volume = v
  Tone.getDestination().volume.value = v ? 20 * Math.log10(v / 100) : -Infinity
}
/** Current playhead in beats. */
export const currentBeat = () => (transport.state === 'started' ? transport.ticks / transport.PPQ : pos)

/** Audition one note while editing. */
export async function previewNote(instrument, tono) {
  await Tone.start()
  trigger(instrument, { tono, duracion: 0.5, velocidad: 0.8 }, Tone.now())
}
