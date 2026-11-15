import { useEffect, useRef, useState } from 'react'
import { AudioLines, Plus } from 'lucide-react'
import { api } from '../api.js'
import { typeLabel } from './Browser.jsx'

/**
 * "Similar" button for the piano roll: the public pieces of the same type that sound most like this one, by musical
 * fingerprint (transposed, inverted or time-shifted versions count as the same). Open one, or add it to the song.
 */
export function SimilarPieces({ piece, onOpen, onAdd }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null) // null = loading; [] = none
  const [at, setAt] = useState(null) // fixed position under the button: the piano roll toolbar clips overflow
  const ref = useRef(null)
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 348)) })
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    let live = true
    setList(null)
    api.similar(piece.id).then((l) => live && setList(l ?? []), () => live && setList([]))
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      live = false
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, piece.id])

  return (
    <span className="similar" ref={ref}>
      <button className={`tbtn ${open ? 'on' : ''}`} onClick={toggle} aria-expanded={open} title="Pieces that sound like this one, in any key">
        <AudioLines size={13} aria-hidden="true" /> Similar
      </button>
      {open && (
        <div className="similar-pop panel" style={at} role="dialog" aria-label={`Pieces similar to ${piece.nombre}`}>
          <p className="similar-head">
            Sounds like <b>{piece.nombre}</b>
            <span className="dim"> · any key or start beat</span>
          </p>
          {list === null && <p className="fine similar-note">Comparing fingerprints…</p>}
          {list?.length === 0 && <p className="fine similar-note">No public {typeLabel(piece.tipo).toLowerCase()} pieces to compare with yet.</p>}
          {list?.length > 0 && (
            <ul>
              {list.map((p) => (
                <li key={p.id} className={`t-${p.tipo}`}>
                  <button className="similar-main" onClick={() => (setOpen(false), onOpen(p.id))} title={`Open ${p.nombre} in the piano roll`}>
                    <span className="similar-score" style={{ '--s': `${p.similitud}%` }}>
                      {p.similitud}%
                    </span>
                    <span className="similar-name">{p.nombre}</span>
                    <span className="similar-by">
                      {p.autor}
                      {p.tonalidad && ` · ${p.tonalidad}`}
                    </span>
                  </button>
                  <button className="icon small" onClick={() => onAdd(p.id)} aria-label={`Add ${p.nombre} to song`} title="Add to song">
                    <Plus size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  )
}
