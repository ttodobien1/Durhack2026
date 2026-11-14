import { useEffect, useState } from 'react'
import { Play, Plus, Search, Square } from 'lucide-react'
import { api } from '../api.js'

export const TYPES = [
  ['', 'All'],
  ['ritmo', 'Rhythm'],
  ['acordes', 'Chords'],
  ['bajo', 'Bass'],
  ['melodia', 'Melody'],
]
export const typeLabel = (t) => TYPES.find(([k]) => k === t)?.[1] ?? t

export function Browser({ onResults, onSelect, onAdd, onPreview, playing, selectedId, fail }) {
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      try {
        const list = await api.search({ q, tipo })
        if (!live) return
        setResults(list)
        onResults(list)
      } catch (e) {
        if (live) fail(e)
      }
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tipo])

  return (
    <aside className="panel browser">
      <h2 className="title">Browser</h2>
      <div className="browser-tools">
        <label className="search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pieces, authors, ids" aria-label="Search pieces" />
        </label>
        <div className="seg" role="radiogroup" aria-label="Piece type">
          {TYPES.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={tipo === k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="pieces">
        {results?.length === 0 && <li className="empty">No pieces match “{q}”. Try another word or type.</li>}
        {results == null && <li className="empty">Loading pieces…</li>}
        {results?.map((p) => (
          <li key={p.id} className={`piece-row t-${p.tipo} ${selectedId === p.id ? 'sel' : ''}`}>
            <button className="piece-main" onClick={() => onSelect(p.id)} title="Open in piano roll">
              <span className="code">{p.id}</span>
              <span className="piece-name">{p.nombre}</span>
              <span className="piece-meta">
                {p.autor} · {p.licencia} · {typeLabel(p.tipo)} · {p.tonalidad}
              </span>
            </button>
            <button className="icon" onClick={() => onPreview(p)} aria-label={playing === p.id ? `Stop ${p.nombre}` : `Preview ${p.nombre}`}>
              {playing === p.id ? <Square size={13} /> : <Play size={13} />}
            </button>
            <button className="icon" onClick={() => onAdd(p)} aria-label={`Add ${p.nombre} to song`} title="Add to song">
              <Plus size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
