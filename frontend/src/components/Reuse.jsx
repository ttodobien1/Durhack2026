import { useEffect, useRef, useState } from 'react'
import { GitFork, Lock, Repeat2 } from 'lucide-react'
import { api } from '../api.js'
import './reuse.css'

/**
 * Popularity of a piece or a project: how many times it has been reused, with a popover listing where.
 *   kind "pieza":   projects that use the piece + pieces forked from it (GET /piezas/:id/usos)
 *   kind "cancion": copies (forks) of the project (GET /canciones/:id/forks)
 * Public items are links; private ones only add to the count. Renders nothing while the count is 0.
 */
export function Reuse({ kind, id, count, label = false }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!count) return null
  const what = kind === 'pieza' ? 'Reused' : 'Copied'
  const title = `${what} ${count} ${count === 1 ? 'time' : 'times'}: see where`
  return (
    <span className="reuse" ref={box}>
      <button
        type="button"
        className="reuse-btn"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-label={title}
        title={title}
      >
        <Repeat2 size={12} aria-hidden="true" /> {count}
        {label && <span>{count === 1 ? ' reuse' : ' reuses'}</span>}
      </button>
      {open && (kind === 'pieza' ? <PieceUses id={id} /> : <SongCopies id={id} count={count} />)}
    </span>
  )
}

function useLoad(load) {
  const [state, setState] = useState({ data: null, error: null })
  useEffect(() => {
    let live = true
    load().then(
      (data) => live && setState({ data, error: null }),
      (e) => live && setState({ data: null, error: e.message || String(e) }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

const hidden = (total, shown) => total - shown > 0 && <li className="reuse-more">+{total - shown} private</li>

function PieceUses({ id }) {
  const { data, error } = useLoad(() => api.pieceUsage(id))
  return (
    <div className="reuse-pop" role="dialog" aria-label="Where this piece is reused">
      {error && <p className="reuse-empty">{error}</p>}
      {!data && !error && <p className="reuse-empty">Loading…</p>}
      {data && (
        <>
          <h4>
            Used in {data.canciones.total} {data.canciones.total === 1 ? 'project' : 'projects'}
          </h4>
          <ul>
            {data.canciones.lista.map((c) => (
              <li key={c.id}>
                <a href={`#/project/${c.id}`}>{c.nombre}</a>
                <span className="dim"> by {c.autor}</span>
                {!c.publica && <Lock size={10} aria-label="private" />}
              </li>
            ))}
            {hidden(data.canciones.total, data.canciones.lista.length)}
          </ul>
          <h4>
            <GitFork size={11} aria-hidden="true" /> Forked {data.forks.total} {data.forks.total === 1 ? 'time' : 'times'}
          </h4>
          <ul>
            {data.forks.lista.map((p) => (
              <li key={p.id}>
                <span className="code">{p.id}</span> {p.nombre}
                <span className="dim">
                  {' '}
                  by <a href={`#/u/${encodeURIComponent(p.autor)}`}>{p.autor}</a>
                </span>
              </li>
            ))}
            {hidden(data.forks.total, data.forks.lista.length)}
          </ul>
        </>
      )}
    </div>
  )
}

function SongCopies({ id, count }) {
  const { data, error } = useLoad(() => api.related(id))
  const forks = data?.forks ?? []
  return (
    <div className="reuse-pop" role="dialog" aria-label="Copies of this project">
      <h4>
        <GitFork size={11} aria-hidden="true" /> Copied {count} {count === 1 ? 'time' : 'times'}
      </h4>
      {error && <p className="reuse-empty">{error}</p>}
      {!data && !error && <p className="reuse-empty">Loading…</p>}
      {data && (
        <ul>
          {forks.map((c) => (
            <li key={c.id}>
              <a href={`#/project/${c.id}`}>{c.nombre}</a>
              <span className="dim"> by {c.autor}</span>
            </li>
          ))}
          {hidden(count, forks.length)}
        </ul>
      )}
    </div>
  )
}
