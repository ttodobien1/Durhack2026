// Library tab of the landing page's Explore block: every piece in Stemma, with the project Browser's tabs (All,
// Favorites, one per type), search, pages, a preview button and the favorite star (add / remove) on each piece.
// The whole library is loaded once, when the tab opens; search, tabs and pages work on that copy.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Play, Search, Square, Star } from 'lucide-react'
import { api } from '../api.js'
import { setFavorite, useFavorites } from '../favorites.js'
import { AuthDialog } from '../Site.jsx'
import { FAVORITES, TABS, typeLabel } from './Browser.jsx'
import { MiniNotes } from './Playlist.jsx'
import { Reuse } from './Reuse.jsx'
import { usePieceReuse } from '../reuse.js'
import './library.css'

const PER_PAGE = 24
const matches = (p, text) => !text || `${p.nombre} ${p.autor} ${p.id} ${p.tonalidad ?? ''} ${(p.estilo ?? []).join(' ')}`.toLowerCase().includes(text)

/** Page numbers to show around `page`, with null for each gap: 1 … 4 5 6 … 59. */
function pageList(page, pages) {
  const want = new Set([1, pages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => want.add(n))
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => want.add(n))
  const sorted = [...want].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out = []
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(null)
    out.push(n)
  })
  return out
}

function Pager({ page, pages, onPage }) {
  return (
    <nav className="pager" aria-label="Library pages">
      <button className="tbtn" disabled={page === 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} aria-hidden="true" /> Previous
      </button>
      {pageList(page, pages).map((n, i) =>
        n == null ? (
          <span key={`gap-${i}`} className="pager-gap">
            …
          </span>
        ) : (
          <button key={n} className={`tbtn ${n === page ? 'on' : ''}`} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>
            {n}
          </button>
        ),
      )}
      <button className="tbtn" disabled={page === pages} onClick={() => onPage(page + 1)}>
        Next <ChevronRight size={14} aria-hidden="true" />
      </button>
    </nav>
  )
}

/** Props: playing (id of what plays now), onPreview(piece), onUser(user) after a login asked by a star. */
export function PieceLibrary({ playing, onPreview, onUser }) {
  const [all, setAll] = useState(null) // every piece the visitor can see
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('')
  const [page, setPage] = useState(1)
  const [extra, setExtra] = useState({}) // starred pieces missing from the list, loaded one by one
  const [login, setLogin] = useState(null) // { mode, piece } while a star waits for a login
  const favorites = useFavorites()

  // Your private pieces are only listed for you, so load again when the account changes.
  useEffect(() => {
    let live = true
    api.search({}).then(
      (list) => live && setAll(list),
      (e) => live && setError(e.message || String(e)),
    )
    return () => {
      live = false
    }
  }, [favorites.user])

  const byId = useMemo(() => new Map((all ?? []).map((p) => [p.id, p])), [all])
  useEffect(() => {
    if (tab !== FAVORITES || !all) return
    let live = true
    for (const id of favorites.ids.filter((x) => !byId.has(x) && !(x in extra))) {
      api.getPiece(id).then(
        (p) => live && setExtra((s) => ({ ...s, [id]: p })),
        () => live && setExtra((s) => ({ ...s, [id]: null })),
      )
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, all, favorites.ids])

  const onFavorites = tab === FAVORITES
  const text = q.trim().toLowerCase()
  const source = onFavorites ? favorites.ids.map((id) => byId.get(id) ?? extra[id]).filter(Boolean) : (all ?? []).filter((p) => !tab || p.tipo === tab)
  const shown = source.filter((p) => matches(p, text))
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const current = Math.min(page, pages)
  const first = (current - 1) * PER_PAGE
  const slice = shown.slice(first, first + PER_PAGE)
  const isFav = new Set(favorites.ids)
  const reuse = usePieceReuse(slice.map((p) => p.id))

  const goTo = (n) => {
    setPage(n)
    document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const star = (p) => {
    if (!favorites.user) return setLogin({ mode: 'login', piece: p })
    setFavorite(p.id).catch((e) => setError(e.message || String(e)))
  }

  let status = 'Loading the library…'
  if (all && shown.length) status = `Showing ${first + 1}–${first + slice.length} of ${shown.length} ${shown.length === 1 ? 'piece' : 'pieces'}${shown.length < all.length && !onFavorites ? ` (library: ${all.length})` : ''}`
  else if (all) status = `0 of ${all.length} pieces`

  return (
    <>
      <div className="explore-tools">
        <label className="search">
          <Search size={14} aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="Search pieces, authors, ids, keys, styles"
            aria-label="Search the library"
          />
        </label>
      </div>
      <div className="lib-bar">
        <div className="seg lib-tabs" role="radiogroup" aria-label="Piece type">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={tab === k}
              className={tab === k ? 'on' : ''}
              onClick={() => {
                setTab(k)
                setPage(1)
              }}
            >
              {k === FAVORITES && <Star size={11} aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
        <span className="lib-status">{status}</span>
      </div>

      {error && (
        <p className="empty error-text" role="alert">
          {error}
        </p>
      )}
      <ul className="lib-grid">
        {onFavorites && !favorites.user && <li className="empty">Log in and star pieces (☆) to keep your favorites here.</li>}
        {onFavorites && favorites.user && !favorites.ready && <li className="empty">Loading favorites…</li>}
        {onFavorites && favorites.ready && favorites.user && favorites.ids.length === 0 && <li className="empty">No favorites yet. Star a piece (☆) to keep it here.</li>}
        {all && source.length > 0 && shown.length === 0 && <li className="empty">No pieces match “{q}”. Try another word or tab.</li>}
        {slice.map((p) => {
          const fav = isFav.has(p.id)
          return (
            <li key={p.id} className={`lib-piece t-${p.tipo}`}>
              <div className="lib-head">
                <span className="code">{p.id}</span>
                <span className="lib-type">{typeLabel(p.tipo)}</span>
                {p.tonalidad && <span className="lib-key">{p.tonalidad}</span>}
                {p.publica === false && (
                  <span className="lib-private" title="Only you can see it until you save it in a public project">
                    <Lock size={10} aria-hidden="true" /> private
                  </span>
                )}
                <button
                  className={`icon star ${fav ? 'on' : ''}`}
                  onClick={() => star(p)}
                  disabled={Boolean(favorites.user) && !favorites.ready}
                  aria-pressed={fav}
                  aria-label={fav ? `Remove ${p.nombre} from favorites` : `Add ${p.nombre} to favorites`}
                  title={fav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star size={14} fill={fav ? 'currentColor' : 'none'} />
                </button>
              </div>
              <strong className="lib-name" title={p.nombre}>
                {p.nombre}
              </strong>
              <span className="lib-meta">
                <a href={`#/u/${encodeURIComponent(p.autor)}`}>{p.autor}</a> · {p.licencia}
                {p.parent_id && ` · fork of ${p.parent_id}`}
              </span>
              <div className="lib-notes">
                <MiniNotes notas={p.notas} beats={p.compases * 4} />
                {!p.notas.length && <span className="dim">No notes yet</span>}
              </div>
              <div className="lib-actions">
                <button
                  className={`tbtn square ${playing === p.id ? 'on' : ''}`}
                  onClick={() => onPreview(p)}
                  disabled={!p.notas.length}
                  aria-label={`${playing === p.id ? 'Stop' : 'Play'} ${p.nombre}`}
                >
                  {playing === p.id ? <Square size={13} /> : <Play size={14} />}
                </button>
                <span className="dim">
                  {p.compases} {p.compases === 1 ? 'bar' : 'bars'} · {p.tempo} BPM
                </span>
                <Reuse kind="pieza" id={p.id} count={reuse[p.id]?.total} />
              </div>
            </li>
          )
        })}
      </ul>
      {pages > 1 && <Pager page={current} pages={pages} onPage={goTo} />}

      {login && (
        <AuthDialog
          mode={login.mode}
          reason="Log in to keep your favorite pieces."
          onMode={(mode) => setLogin({ ...login, mode })}
          onClose={() => setLogin(null)}
          onDone={(u) => {
            onUser(u)
            const { piece } = login
            setLogin(null)
            setFavorite(piece.id, true).catch((e) => setError(e.message || String(e)))
          }}
        />
      )}
    </>
  )
}
