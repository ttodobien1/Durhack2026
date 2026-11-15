import { useEffect, useState } from 'react'
import { Lock, Plus, X } from 'lucide-react'
import { TYPES } from './Browser.jsx'

const DEFAULT_NAMES = { ritmo: 'My beat', acordes: 'My chords', bajo: 'My bass line', melodia: 'My melody' }
const BARS = [1, 2, 4, 8]
const KEYS = ['', 'C', 'Cm', 'C#m', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm', 'F#m', 'G', 'Gm', 'Ab', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm']

/**
 * "New piece" window: the "+" on a track (or on the Playlist title bar) creates an empty piece of your own, which
 * opens in the piano roll to draw its notes.
 * Props: tipo (preset type, or null), lane (track name when it goes on an existing track), onCreate({ nombre, tipo,
 * compases, tonalidad }) -> Promise, onClose().
 */
export function NewPieceDialog({ tipo: preset, lane, onCreate, onClose }) {
  const [tipo, setTipo] = useState(preset ?? 'acordes')
  const [nombre, setNombre] = useState(DEFAULT_NAMES[preset ?? 'acordes'])
  const [touched, setTouched] = useState(false)
  const [compases, setCompases] = useState(4)
  const [tonalidad, setTonalidad] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pickType = (t) => {
    setTipo(t)
    if (!touched) setNombre(DEFAULT_NAMES[t])
  }
  const submit = async (e) => {
    e.preventDefault()
    const clean = nombre.trim()
    if (!clean) return setError('Give your piece a name.')
    setBusy(true)
    setError(null)
    try {
      await onCreate({ nombre: clean, tipo, compases, tonalidad: tipo === 'ritmo' ? null : tonalidad || null })
    } catch (err) {
      setError(err.message || String(err))
      setBusy(false)
    }
  }

  return (
    <div className="window-backdrop" onClick={() => !busy && onClose()}>
      <form className="panel window auth save-as new-piece" role="dialog" aria-modal="true" aria-labelledby="new-piece-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="title roll-title" id="new-piece-title">
          <span>{lane ? `New piece on the ${lane} track` : 'New piece on a new track'}</span>
          <button type="button" className="icon small" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </h2>
        <div className="auth-body">
          <p className="auth-reason">Compose your own piece: it opens empty in the piano roll, where you draw its notes and press Save.</p>
          <label>
            Name
            <input
              autoFocus
              value={nombre}
              maxLength={80}
              onChange={(e) => {
                setNombre(e.target.value)
                setTouched(true)
                setError(null)
              }}
            />
          </label>
          <fieldset className="save-vis">
            <legend>Type</legend>
            <div className="seg" role="radiogroup" aria-label="Type">
              {TYPES.filter(([k]) => k).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={tipo === k} className={tipo === k ? 'on' : ''} onClick={() => pickType(k)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="new-piece-row">
            <fieldset className="save-vis">
              <legend>Length</legend>
              <div className="seg" role="radiogroup" aria-label="Length in bars">
                {BARS.map((b) => (
                  <button key={b} type="button" role="radio" aria-checked={compases === b} className={compases === b ? 'on' : ''} onClick={() => setCompases(b)}>
                    {b} {b === 1 ? 'bar' : 'bars'}
                  </button>
                ))}
              </div>
            </fieldset>
            {tipo !== 'ritmo' && (
              <label>
                Key
                <select value={tonalidad} onChange={(e) => setTonalidad(e.target.value)}>
                  {KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k || 'Any'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="fine">
            <Lock size={11} aria-hidden="true" /> Only you can see it until you save it in a public project. Then anyone can find it, play it and fork it
            (CC BY 4.0, credited to you).
          </p>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="tbtn accent big" type="submit" disabled={busy}>
            <Plus size={15} aria-hidden="true" /> {busy ? 'Creating…' : 'Create and open in the piano roll'}
          </button>
        </div>
      </form>
    </div>
  )
}
