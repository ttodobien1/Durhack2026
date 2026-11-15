import { useEffect, useMemo, useState } from 'react'
import { Play, Search, Square } from 'lucide-react'
import { api } from './api.js'
import * as audio from './audio.js'
import { SiteBar } from './Site.jsx'
import { useUser } from './profile.js'
import { useWidth } from './useWidth.js'
import { TYPES, typeLabel } from './components/Browser.jsx'
import './soundmap.css'

// Dots are coloured by where a piece came from: on this library the clusters mostly follow the source.
const SOURCES = [
  ['groove', 'Groove MIDI recordings', (p) => /\(Groove MIDI\)/.test(p.autor)],
  ['fmc', 'free-midi-chords', (p) => /free-midi-chords/.test(p.autor) || p.licencia === 'MIT'],
  ['generated', 'Stemma generator', (p) => p.autor === 'Stemma generator'],
  ['public-domain', 'Public-domain melodies', (p) => p.licencia === 'Public Domain'],
  ['people', 'Team and users', () => true],
]
const sourceOf = (p) => SOURCES.find(([, , test]) => test(p))[0]

/** Map bounds from the 2nd-98th percentiles, so a few far-out pieces do not squash everyone else into a corner. */
function bounds(values) {
  const v = [...values].sort((a, b) => a - b)
  const lo = v[Math.floor(v.length * 0.02)] ?? 0
  const hi = v[Math.ceil(v.length * 0.98) - 1] ?? 1
  const pad = (hi - lo || 1) * 0.08
  return [lo - pad, hi + pad]
}

const readHash = () => new URLSearchParams(location.hash.split('?')[1] ?? '')

/** #/map: every public piece of one type, placed by its musical fingerprint (backend lib/fingerprint.js, PCA). */
export function SoundMap() {
  const [user, setUser] = useUser()
  const [tipo, setTipo] = useState(() => (TYPES.some(([k]) => k && k === readHash().get('tipo')) ? readHash().get('tipo') : 'ritmo'))
  const [map, setMap] = useState(null) // { total, ejes, puntos } | { error }
  const [selId, setSelId] = useState(() => readHash().get('p'))
  const [hover, setHover] = useState(null)
  const [near, setNear] = useState([]) // similar pieces of the selected one
  const [q, setQ] = useState('')
  const [playing, setPlaying] = useState(false)
  const [measure, width] = useWidth()

  useEffect(() => {
    let live = true
    setMap(null)
    api.pieceMap(tipo).then((m) => live && setMap(m ?? { error: 'The sound map needs the backend (it is offline).' }), (e) => live && setMap({ error: e.message }))
    return () => {
      live = false
    }
  }, [tipo])
  useEffect(() => {
    history.replaceState(null, '', `#/map?tipo=${tipo}${selId ? `&p=${selId}` : ''}`)
  }, [tipo, selId])
  useEffect(() => () => audio.stop(), [])

  const sel = map?.puntos?.find((p) => p.id === selId) ?? null
  useEffect(() => {
    setNear([])
    audio.stop()
    setPlaying(false)
    if (!sel) return
    let live = true
    api.similar(sel.id).then((l) => live && setNear((l ?? []).slice(0, 5)))
    return () => {
      live = false
    }
  }, [sel?.id])

  const W = Math.max(280, width)
  const H = Math.round(Math.min(560, Math.max(320, W * 0.62)))
  const scale = useMemo(() => {
    if (!map?.puntos?.length) return null
    const [x0, x1] = bounds(map.puntos.map((p) => p.x))
    const [y0, y1] = bounds(map.puntos.map((p) => p.y))
    const sx = (x) => Math.min(W - 6, Math.max(6, ((x - x0) / (x1 - x0)) * W))
    const sy = (y) => Math.min(H - 6, Math.max(6, H - ((y - y0) / (y1 - y0)) * H))
    const out = (p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1
    return { sx, sy, out }
  }, [map, W, H])

  const text = q.trim().toLowerCase()
  const matches = text && map?.puntos ? map.puntos.filter((p) => `${p.nombre} ${p.autor} ${p.id}`.toLowerCase().includes(text)) : null
  const counts = useMemo(() => {
    const c = {}
    for (const p of map?.puntos ?? []) c[sourceOf(p)] = (c[sourceOf(p)] ?? 0) + 1
    return c
  }, [map])
  const byId = useMemo(() => Object.fromEntries((map?.puntos ?? []).map((p) => [p.id, p])), [map])

  const preview = async () => {
    if (playing) {
      audio.stop()
      return setPlaying(false)
    }
    const piece = await api.getPiece(sel.id)
    const instrument = audio.instrumentFor(piece.tipo)
    audio.play({ events: piece.notas.map((n) => ({ ...n, instrument })), bpm: piece.tempo, lengthBeats: piece.compases * 4, loop: false, from: 0, onEnd: () => setPlaying(false) })
    setPlaying(true)
  }

  const [ex, ey] = map?.ejes ?? []
  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main className="soundmap">
        <header className="sm-head">
          <h1>Sound map</h1>
          <p>
            Every public piece of one type, placed by its musical fingerprint. Dots close together sound alike, even in different keys or starting on
            different beats. Colours show where pieces came from: on this library, that is what most clusters follow.
          </p>
        </header>

        <div className="sm-tools">
          <div className="seg" role="radiogroup" aria-label="Piece type">
            {TYPES.filter(([k]) => k).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={tipo === k} className={tipo === k ? 'on' : ''} onClick={() => (setTipo(k), setSelId(null), setQ(''))}>
                {label}
              </button>
            ))}
          </div>
          <label className="search sm-find">
            <Search size={14} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && matches?.[0] && setSelId(matches[0].id)}
              placeholder={`Find a ${typeLabel(tipo).toLowerCase()} piece, e.g. a name or author`}
              aria-label="Find a piece on the map"
            />
            {matches && <span className="dim">{matches.length} found</span>}
          </label>
        </div>

        <div className="sm-body">
          <section className="panel sm-map" aria-label={`${typeLabel(tipo)} map`}>
            {!map && <p className="empty">Placing pieces…</p>}
            {map?.error && <p className="empty">{map.error}</p>}
            {map?.puntos?.length === 0 && <p className="empty">No public {typeLabel(tipo).toLowerCase()} pieces yet.</p>}
            <div className="sm-canvas" ref={measure}>
              {scale && (
                <svg width={W} height={H} role="img" aria-label={`${map.total} ${typeLabel(tipo).toLowerCase()} pieces. Click a dot to see what sounds like it.`}>
                  <line className="sm-axis" x1={0} x2={W} y1={H / 2} y2={H / 2} />
                  <line className="sm-axis" x1={W / 2} x2={W / 2} y1={0} y2={H} />
                  {sel &&
                    near
                      .filter((n) => byId[n.id])
                      .map((n) => <line key={n.id} className="sm-link" x1={scale.sx(sel.x)} y1={scale.sy(sel.y)} x2={scale.sx(byId[n.id].x)} y2={scale.sy(byId[n.id].y)} />)}
                  {map.puntos.map((p) => {
                    const dim = matches && !matches.includes(p)
                    return (
                      <circle
                        key={p.id}
                        className={`sm-dot s-${sourceOf(p)} ${scale.out(p) ? 'out' : ''} ${dim ? 'dim' : ''} ${matches && !dim ? 'hit' : ''} ${p.id === selId ? 'sel' : ''}`}
                        cx={scale.sx(p.x)}
                        cy={scale.sy(p.y)}
                        r={p.id === selId ? 7 : matches && !dim ? 5.5 : 4}
                        onMouseEnter={() => setHover(p)}
                        onMouseLeave={() => setHover((h) => (h === p ? null : h))}
                        onClick={() => setSelId(p.id)}
                      />
                    )
                  })}
                </svg>
              )}
              {hover && scale && (
                <div className="sm-tip" style={{ left: Math.min(W - 220, scale.sx(hover.x) + 10), top: Math.max(0, scale.sy(hover.y) - 34) }}>
                  <b>{hover.nombre}</b>
                  <span>{hover.autor}</span>
                </div>
              )}
            </div>
            {ex && (
              <p className="sm-xaxis">
                <span>← {ex.menos.join(' · ')}</span>
                <span className="dim">across: {Math.round(ex.varianza * 100)}% of the differences</span>
                <span>{ex.mas.join(' · ')} →</span>
              </p>
            )}
            {ey && (
              <p className="sm-yaxis">
                Up: <b>{ey.mas.join(' · ')}</b> · down: <b>{ey.menos.join(' · ')}</b> <span className="dim">({Math.round(ey.varianza * 100)}%)</span>
              </p>
            )}
            {map?.puntos?.length > 0 && (
              <ul className="sm-legend" aria-label="Colours">
                {SOURCES.filter(([key]) => counts[key]).map(([key, label]) => (
                  <li key={key}>
                    <i className={`s-${key}`} /> {label} <span className="dim">{counts[key]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="panel sm-side" aria-live="polite">
            {!sel ? (
              <p className="sm-hint">
                <b>Click a dot</b> to see the piece and the five that sound most like it. Lines join it to them on the map. You can also find a piece by
                name above.
              </p>
            ) : (
              <>
                <h2 className="sm-name">{sel.nombre}</h2>
                <p className="sm-meta">
                  {sel.autor} · {typeLabel(tipo)}
                  {sel.tonalidad && ` · ${sel.tonalidad}`} · {sel.tempo} BPM · {sel.licencia}
                </p>
                <button className={`tbtn ${playing ? 'on' : ''}`} onClick={preview}>
                  {playing ? <Square size={13} /> : <Play size={13} />} {playing ? 'Stop' : 'Preview'}
                </button>
                <h3>Sounds most like</h3>
                {near.length === 0 && <p className="fine">Comparing…</p>}
                <ul className="sm-near">
                  {near.map((n) => (
                    <li key={n.id}>
                      <button onClick={() => setSelId(n.id)} disabled={!byId[n.id]}>
                        <span className="similar-score" style={{ '--s': `${n.similitud}%` }}>
                          {n.similitud}%
                        </span>
                        <span>
                          <span className="sm-near-name">{n.nombre}</span>
                          <span className="dim">{n.autor}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="fine">Similarity compares notes and rhythm, ignoring key, tempo and start beat.</p>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}
