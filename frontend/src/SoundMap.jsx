import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCw, Search, Square } from 'lucide-react'
import { api } from './api.js'
import * as audio from './audio.js'
import { SiteBar } from './Site.jsx'
import { useUser } from './profile.js'
import { TYPES, typeLabel } from './components/Browser.jsx'
import { SoundMap3D } from './components/SoundMap3D.jsx'
import './soundmap.css'

// Dots are coloured by where a piece came from: on this library the clusters mostly follow the source.
// [key, label, test, colour token in index.css]
const SOURCES = [
  ['groove', 'Groove MIDI recordings', (p) => /\(Groove MIDI\)/.test(p.autor), '--t-ritmo'],
  ['fmc', 'free-midi-chords', (p) => /free-midi-chords/.test(p.autor) || p.licencia === 'MIT', '--t-acordes'],
  ['generated', 'Stemma generator', (p) => p.autor === 'Stemma generator', '--t-melodia'],
  ['public-domain', 'Public-domain melodies', (p) => p.licencia === 'Public Domain', '--mov'],
  ['people', 'Team and users', () => true, '--orange'],
]
const sourceOf = (p) => SOURCES.find(([, , test]) => test(p))[0]
const AXIS_NAMES = ['x', 'y', 'z']

const readHash = () => new URLSearchParams(location.hash.split('?')[1] ?? '')

/**
 * #/map: every public piece of one type in 3D, placed by its musical fingerprint (backend lib/fingerprint.js, PCA).
 * All three directions are fingerprint components, so "close together = sounds alike" holds whichever way you turn it.
 */
export function SoundMap() {
  const [user, setUser] = useUser()
  const [tipo, setTipo] = useState(() => (TYPES.some(([k]) => k && k === readHash().get('tipo')) ? readHash().get('tipo') : 'ritmo'))
  const [map, setMap] = useState(null) // { total, ejes, puntos } | { error }
  const [selId, setSelId] = useState(() => readHash().get('p'))
  const [hover, setHover] = useState(null)
  const [near, setNear] = useState([]) // similar pieces of the selected one
  const [q, setQ] = useState('')
  const [playing, setPlaying] = useState(false)
  const [spin, setSpin] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const scene = useRef(null)

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

  const text = q.trim().toLowerCase()
  const matches = useMemo(
    () => (text && map?.puntos ? map.puntos.filter((p) => `${p.nombre} ${p.autor} ${p.id}`.toLowerCase().includes(text)) : null),
    [text, map],
  )
  const matchIds = useMemo(() => matches && new Set(matches.map((p) => p.id)), [matches])
  const nearIds = useMemo(() => near.map((n) => n.id), [near])
  const colorOf = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const colors = Object.fromEntries(SOURCES.map(([key, , , token]) => [key, css.getPropertyValue(token).trim() || '#cccccc']))
    return (p) => colors[sourceOf(p)]
  }, [])
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

  const toggleSpin = () => {
    scene.current?.setAutoRotate(!spin)
    setSpin(!spin)
  }
  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />
      <main className="soundmap">
        <header className="sm-head">
          <h1>Sound map</h1>
          <p>
            Every public piece of one type in 3D, placed by its musical fingerprint. Dots close together sound alike, even in different keys or
            starting on different beats. Drag to turn it, scroll or pinch to zoom, right-drag to move. Colours show where pieces came from: on
            this library, that is what most clusters follow.
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
            {map?.puntos?.length > 0 && (
              <div className="sm-canvas" role="img" aria-label={`${map.total} ${typeLabel(tipo).toLowerCase()} pieces in 3D. Click a dot to see what sounds like it.`}>
                <SoundMap3D
                  ref={scene}
                  points={map.puntos}
                  axes={map.ejes}
                  colorOf={colorOf}
                  selId={selId}
                  nearIds={nearIds}
                  matches={matchIds}
                  onHover={(p, at) => setHover(p && { p, ...at })}
                  onSelect={setSelId}
                  onAutoRotate={setSpin}
                />
                <div className="sm3-tools">
                  <button className="tbtn" onClick={toggleSpin} aria-pressed={spin} title={spin ? 'Stop turning' : 'Turn slowly'}>
                    {spin ? <Pause size={13} /> : <RotateCw size={13} />} {spin ? 'Stop' : 'Turn'}
                  </button>
                  <button className="tbtn" onClick={() => scene.current?.reset()} title="Back to the starting view">
                    Reset view
                  </button>
                </div>
                {hover && (
                  <div className="sm-tip" style={{ left: hover.x + 240 > hover.w ? Math.max(0, hover.x - 232) : hover.x + 12, top: Math.max(0, hover.y - 38) }}>
                    <b>{hover.p.nombre}</b>
                    <span>{hover.p.autor}</span>
                  </div>
                )}
              </div>
            )}
            {map?.ejes?.length > 0 && (
              <ul className="sm-axes" aria-label="What the directions mean">
                {map.ejes.map((a, i) => (
                  <li key={AXIS_NAMES[i]}>
                    <b className={`ax-${AXIS_NAMES[i]}`}>{AXIS_NAMES[i]}</b>
                    <span>
                      − {a.menos.join(' · ') || '—'} <span className="dim">↔</span> + {a.mas.join(' · ') || '—'}
                    </span>
                    <span className="dim">{Math.round(a.varianza * 100)}%</span>
                  </li>
                ))}
                <li className="fine">
                  Together the three directions show {Math.round(map.ejes.reduce((t, a) => t + a.varianza, 0) * 100)}% of the differences between pieces.
                </li>
              </ul>
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
