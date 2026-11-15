import { useEffect, useState } from 'react'
import { Play, Plus, Search, Square, Star } from 'lucide-react'
import { api } from '../api.js'
import { setFavorite, useFavorites } from '../favorites.js'
import { usePieceReuse } from '../reuse.js'

export const TYPES = [
  ['', 'All'],
  ['ritmo', 'Rhythm'],
  ['acordes', 'Chords'],
  ['bajo', 'Bass'],
  ['melodia', 'Melody'],
]
export const typeLabel = (t) => TYPES.find(([k]) => k === t)?.[1] ?? t

/** Browser tabs: All, then your Favorites, then one per piece type. */
export const FAVORITES = 'favoritos'
export const TABS = [TYPES[0], [FAVORITES, 'Favorites'], ...TYPES.slice(1)]

const matches = (p, text) => !text || `${p.nombre} ${p.autor} ${p.id}`.toLowerCase().includes(text)

// pieces: the project's piece cache (id → Pieza). Rows show that copy when there is one, so a piece renamed in the
// piano roll shows its new name here too, without searching again.
export function Browser({ pieces = {}, onResults, onSelect, onAdd, onPreview, onNeedLogin, playing, selectedId, fail }) {
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')
  const [results, setResults] = useState(null)
  const favorites = useFavorites()
  const [favPieces, setFavPieces] = useState({}) // id -> Pieza (or null if it could not be loaded)
  const onFavorites = tipo === FAVORITES

  useEffect(() => {
    if (onFavorites) return
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

  // Favorites tab: load each starred piece once (api.getPiece caches them for the visit).
  useEffect(() => {
    if (!onFavorites) return
    let live = true
    const missing = favorites.ids.filter((id) => !(id in favPieces))
    for (const id of missing)
      api.getPiece(id).then(
        (p) => live && (setFavPieces((s) => ({ ...s, [id]: p })), onResults([p])),
        () => live && setFavPieces((s) => ({ ...s, [id]: null })),
      )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFavorites, favorites.ids])

  // The Favorites list is computed from the starred ids on every render, so it can never drift from the stars.
  const text = q.trim().toLowerCase()
  const starred = favorites.ids.map((id) => favPieces[id]).filter(Boolean)
  const loadingFavs = favorites.ids.some((id) => !(id in favPieces))
  const list = onFavorites ? starred.filter((p) => matches(p, text)) : results
  const reuse = usePieceReuse((list ?? []).slice(0, 200).map((row) => row.id))
  const isFav = new Set(favorites.ids)

  const star = (p) => {
    if (!favorites.user) return onNeedLogin(() => setFavorite(p.id, true).catch(fail))
    if (!isFav.has(p.id)) setFavPieces((s) => ({ ...s, [p.id]: p })) // already loaded: no request needed
    setFavorite(p.id).catch(fail)
  }

  return (
    <aside className="panel browser">
      <h2 className="title">Browser</h2>
      <div className="browser-tools">
        <label className="search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pieces, authors, ids" aria-label="Search pieces" />
        </label>
        <div className="seg browser-tabs" role="radiogroup" aria-label="Piece type">
          {TABS.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={tipo === k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>
              {k === FAVORITES && <Star size={10} aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="pieces">
        {onFavorites && !favorites.user && <li className="empty">Log in and star pieces (☆) to keep your favorites here.</li>}
        {onFavorites && favorites.user && !favorites.ready && <li className="empty">Loading favorites…</li>}
        {onFavorites && favorites.ready && favorites.ids.length === 0 && <li className="empty">No favorites yet. Star a piece (☆) to keep it here.</li>}
        {onFavorites && favorites.ids.length > 0 && list.length === 0 && !loadingFavs && <li className="empty">No favorite matches “{q}”.</li>}
        {!onFavorites && results?.length === 0 && <li className="empty">No pieces match “{q}”. Try another word or type.</li>}
        {!onFavorites && results == null && <li className="empty">Loading pieces…</li>}
        {list?.map((row) => {
          const p = pieces[row.id] ?? row
          const fav = isFav.has(p.id)
          return (
            <li key={p.id} className={`piece-row t-${p.tipo} ${selectedId === p.id ? 'sel' : ''}`}>
              <button className="piece-main" onClick={() => onSelect(p.id)} title="Open in piano roll">
                <span className="code">{p.id}</span>
                <span className="piece-name">{p.nombre}</span>
                <span className="piece-meta">
                  {p.autor} · {p.licencia} · {typeLabel(p.tipo)} · {p.tonalidad}
                  {reuse[p.id]?.total > 0 && (
                    <span className="piece-reuse" title={`Reused ${reuse[p.id].total} ${reuse[p.id].total === 1 ? 'time' : 'times'} (projects and forks)`}>
                      {' '}
                      · ↻ {reuse[p.id].total}
                    </span>
                  )}
                </span>
              </button>
              <button className="icon" onClick={() => onPreview(p)} aria-label={playing === p.id ? `Stop ${p.nombre}` : `Preview ${p.nombre}`}>
                {playing === p.id ? <Square size={13} /> : <Play size={13} />}
              </button>
              <button className="icon" onClick={() => onAdd(p)} aria-label={`Add ${p.nombre} to song`} title="Add to song">
                <Plus size={14} />
              </button>
              <button
                className={`icon star ${fav ? 'on' : ''}`}
                onClick={() => star(p)}
                disabled={Boolean(favorites.user) && !favorites.ready}
                aria-pressed={fav}
                aria-label={fav ? `Remove ${p.nombre} from favorites` : `Add ${p.nombre} to favorites`}
                title={fav ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star size={13} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
