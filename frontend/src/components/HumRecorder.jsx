import { useEffect, useRef, useState } from 'react'
import { Mic, Play, RotateCcw, Send, Square, X } from 'lucide-react'
import { noteName, startHumRecorder, transcribe } from '../hum.js'
import { MiniRoll } from './MiniRoll.jsx'
import './hum.css'

const MAX_SECONDS = 15

/**
 * "Hum to DJ Stemy": records the microphone, turns the humming into notes (hum.js, all in the browser), lets you
 * listen to the result, then hands the notes to the chat. Audio never leaves the page.
 * Props: bpm (project tempo: notes are in beats at this tempo), onPreview(hum) / previewing (play the notes with the
 * project's piano), onSend({ notas, compases }), onClose().
 */
export function HumRecorder({ bpm, onPreview, previewing, onSend, onClose }) {
  const [stage, setStage] = useState('starting') // starting | recording | review | error
  const [live, setLive] = useState({ level: 0, midi: null, seconds: 0 })
  const [hum, setHum] = useState(null) // { notas, compases }
  const [error, setError] = useState(null)
  const recorder = useRef(null)
  const stopping = useRef(false)
  const session = useRef(0) // a newer start (or closing the panel) makes an older pending start drop its microphone

  const start = async () => {
    const mine = ++session.current
    recorder.current?.cancel()
    recorder.current = null
    setStage('starting')
    setError(null)
    setHum(null)
    stopping.current = false
    try {
      const rec = await startHumRecorder({ onLive: setLive, maxSeconds: MAX_SECONDS, onLimit: () => stop() })
      if (mine !== session.current) return rec.cancel()
      recorder.current = rec
      setStage('recording')
    } catch (e) {
      if (mine !== session.current) return
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      setError(denied ? 'DJ Stemy needs your microphone. Allow it in the browser’s address bar and try again.' : e.message || String(e))
      setStage('error')
    }
  }

  const stop = async () => {
    if (!recorder.current || stopping.current) return
    stopping.current = true
    const { samples, sampleRate } = await recorder.current.stop()
    recorder.current = null
    const result = transcribe(samples, sampleRate, bpm)
    if (result.notas.length < 3) {
      setError('I couldn’t catch a melody. Hum a bit louder and give each note its own “da”, like “da-da-daa”.')
      setStage('error')
      return
    }
    setHum(result)
    setStage('review')
  }

  // Start listening as soon as the panel opens; let go of the microphone when it closes.
  useEffect(() => {
    start()
    return () => {
      session.current++
      recorder.current?.cancel()
      recorder.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const beats = hum ? hum.compases * 4 : 4
  return (
    <div className="hum-card" role="region" aria-label="Hum a melody to DJ Stemy">
      <div className="hum-head">
        <Mic size={13} aria-hidden="true" />
        <b>Hum to DJ Stemy</b>
        <button className="icon small" onClick={onClose} aria-label="Close" title="Close">
          <X size={12} />
        </button>
      </div>

      {stage === 'starting' && <p className="hum-note">Opening the microphone…</p>}

      {stage === 'recording' && (
        <>
          <div className="hum-live" aria-live="off">
            <span className="hum-dot" aria-hidden="true" />
            <span className="hum-level" aria-hidden="true">
              <i style={{ width: `${Math.round(live.level * 100)}%` }} />
            </span>
            <span className="hum-pitch">{live.midi !== null ? noteName(live.midi) : '—'}</span>
            <span className="dim">
              0:{String(Math.floor(live.seconds)).padStart(2, '0')} / 0:{MAX_SECONDS}
            </span>
          </div>
          <p className="hum-note">Hum the melody, one “da” per note. Press Stop when you’re done.</p>
          <div className="hum-actions">
            <button className="tbtn accent" onClick={stop}>
              <Square size={12} /> Stop
            </button>
          </div>
        </>
      )}

      {stage === 'review' && hum && (
        <>
          <MiniRoll notes={hum.notas} beats={beats} />
          <p className="hum-note">
            {hum.notas.length} notes · {hum.compases} {hum.compases === 1 ? 'bar' : 'bars'} at {bpm} BPM. Listen to it before DJ Stemy does; anything
            you type below goes with it.
          </p>
          <div className="hum-actions">
            <button className={`tbtn ${previewing ? 'on' : ''}`} onClick={() => onPreview(hum)} aria-label={previewing ? 'Stop' : 'Play the notes'}>
              {previewing ? <Square size={12} /> : <Play size={13} />} {previewing ? 'Stop' : 'Play'}
            </button>
            <button className="tbtn" onClick={start}>
              <RotateCcw size={12} /> Hum again
            </button>
            <button className="tbtn accent" onClick={() => onSend(hum)}>
              <Send size={12} /> Send to DJ Stemy
            </button>
          </div>
        </>
      )}

      {stage === 'error' && (
        <>
          <p className="hum-note error-text" role="alert">
            {error}
          </p>
          <div className="hum-actions">
            <button className="tbtn accent" onClick={start}>
              <Mic size={12} /> Try again
            </button>
          </div>
        </>
      )}
    </div>
  )
}
