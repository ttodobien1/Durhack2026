import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Disc3, Library, Lock, Play, Plus, Search, Square, X } from 'lucide-react'
import { api } from './api.js'
import * as audio from './audio.js'
import { SiteBar } from './Site.jsx'
import { Arrangement, withMeta } from './projectMeta.jsx'
import { useUser } from './profile.js'
import { HeroNetwork } from './components/HeroNetwork.jsx'
import { FlowDemo } from './components/FlowDemos.jsx'
import { PieceLibrary } from './components/PieceLibrary.jsx'
import { exampleEdit } from './exampleEdit.js'
import './landing.css'

const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function updated(iso) {
  const h = (new Date(iso) - Date.now()) / 3600e3
  return Math.abs(h) < 24 ? ago.format(Math.round(h), 'hour') : ago.format(Math.round(h / 24), 'day')
}

// Work saved without an account belongs to nobody: every visitor would read "you / …" as their own project.
const OWNERLESS = new Set(['you', 'anonymous'])

const FLOW = [
  ['Search', 'Drum loops, chords, bass lines and melodies, filtered by type and key.'],
  ['Fork', 'Copy any piece to make it yours. The original author stays credited.'],
  ['Edit', 'Change notes in the piano roll and arrange pieces in the playlist.'],
  ['Diff', 'See what you changed: new notes in green, deleted in red, moved in yellow.'],
  ['Trace', 'The origin tree shows every piece in your song and who made it.'],
]

export function Landing() {
  const [projects, setProjects] = useState(null)
  const [pieces, setPieces] = useState({})
  const [user, setUser] = useUser()
  const [playing, setPlaying] = useState(null)

  const [chain, setChain] = useState(null) // [parent, fork] from the library, for the "How it works" popups
  const [mine, setMine] = useState(null) // your projects (private ones included), only while logged in
  const [demo, setDemo] = useState(null) // the "How it works" step whose popup is open
  const closeDemo = useCallback(() => setDemo(null), [])

  useEffect(() => {
    setMine(null)
    if (user) api.projects(user.name).then(setMine, () => setMine([]))
  }, [user?.name])

  useEffect(() => {
    let live = true
    // The list shows as soon as it arrives; each project's tags, description and thumbnail fill in as its pieces load.
    api.projects().then(
      (list) => {
        const shown = list.filter((p) => !OWNERLESS.has(p.autor))
        setProjects(shown)
        if (location.hash === '#explore') requestAnimationFrame(() => document.getElementById('explore')?.scrollIntoView()) // arrived from another page
        const ids = [...new Set(shown.flatMap((p) => p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id))))]
        const loaded = ids.map((id) => api.getPiece(id).then((p) => (live && setPieces((s) => ({ ...s, [p.id]: p })), p), () => null))
        Promise.all(loaded).then((list) => live && showFork(list.filter(Boolean)))
      },
      (e) => setProjects([]) || console.error(e),
    )
    // Hero: a real fork and its parent. Usually a project already uses one (one small request for the parent);
    // only otherwise search the library, smallest piece types first.
    async function showFork(used) {
      const fork = used.find((p) => p.parent_id)
      const parent = fork && (await api.getPiece(fork.parent_id).catch(() => null))
      if (parent) return live && setChain([parent, fork])
      for (const tipo of ['melodia', 'bajo', 'acordes']) {
        const found = await api.search({ tipo }).catch(() => [])
        const f = found.find((x) => x.parent_id && found.some((y) => y.id === x.parent_id))
        if (f) return live && setChain([found.find((y) => y.id === f.parent_id), f])
      }
      // No forks in the library yet: the "How it works" popups still show a real piece.
      const any = (await api.search({ tipo: 'acordes' }).catch(() => [])).find((p) => p.notas?.length)
      if (any && live) setChain([null, any])
    }
    return () => {
      live = false
      audio.stop()
    }
  }, [])

  // The "How it works" popups follow one real piece: found, forked by you, edited, compared and traced.
  const story = useMemo(() => chain?.[1] && { base: chain[0], child: chain[1], ...exampleEdit(chain[1]) }, [chain])

  const explore = useMemo(() => projects && projects.map((p) => withMeta(p, pieces)), [projects, pieces])

  const preview = (project) => {
    if (playing === project.id) {
      audio.stop()
      return setPlaying(null)
    }
    const events = project.pistas.flatMap((t) =>
      t.bloques.flatMap((b) => (pieces[b.pieza_id]?.notas ?? []).map((n) => ({ ...n, instrument: t.instrumento, inicio: n.inicio + b.compas * 4 }))),
    )
    const bars = Math.max(...project.pistas.flatMap((t) => t.bloques.map((b) => b.compas + (pieces[b.pieza_id]?.compases ?? 0))))
    audio.play({ events, bpm: project.tempo, lengthBeats: bars * 4, loop: false, from: 0, onEnd: () => setPlaying(null) })
    setPlaying(project.id)
  }
  // One piece of the Library tab (same transport: starting one stops whatever was playing).
  const previewPiece = (piece) => {
    if (playing === piece.id) {
      audio.stop()
      return setPlaying(null)
    }
    const instrument = audio.instrumentFor(piece.tipo)
    audio.play({ events: piece.notas.map((n) => ({ ...n, instrument })), bpm: piece.tempo || 96, lengthBeats: piece.compases * 4, loop: false, from: 0, onEnd: () => setPlaying(null) })
    setPlaying(piece.id)
  }

  return (
    <div className="site">
      <SiteBar user={user} onUser={setUser} />

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Compose with pieces that remember who made them.</h1>
            <p>
              Stemma is version control for musical ideas. Find a short MIDI piece, fork it, change the notes, see exactly what changed, and trace every
              piece in your song back to its author.
            </p>
            <div className="hero-cta">
              <a className="tbtn accent big" href="#/project/new">
                <Plus size={16} /> Start a project
              </a>
              <a className="tbtn big" href="#explore">
                Explore public projects <ArrowRight size={15} />
              </a>
            </div>
            <p className="fine">MIDI only. Every piece carries its author and license, and the copilot suggests pieces but never writes your song.</p>
          </div>
          <HeroNetwork />
        </section>

        {user && <YourProjects name={user.name} projects={mine} />}

        <ol className="flow" aria-label="How it works">
          {FLOW.map(([t, d], i) => (
            <li key={t}>
              <button className="flow-step" onClick={() => setDemo(t)} aria-haspopup="dialog" aria-expanded={demo === t}>
                <strong>{t}</strong>
                <span>{d}</span>
                <span className="flow-watch">
                  <Play size={11} aria-hidden="true" /> See it in the app
                </span>
              </button>
              {demo === t && <FlowDemo step={t} n={i + 1} story={story} onClose={closeDemo} />}
            </li>
          ))}
        </ol>

        <Explore projects={explore} pieces={pieces} playing={playing} onPreview={preview} onPreviewPiece={previewPiece} onUser={setUser} />
      </main>

      <footer className="site-foot">
        <span>Stemma · DurHack 2026</span>
        <span>Demo projects and pieces are sample data.</span>
      </footer>

    </div>
  )
}

/** Like the repository list on GitHub's home page: only for the logged-in user, private projects included. */
function YourProjects({ name, projects }) {
  return (
    <section className="panel your-projects" aria-labelledby="your-projects-title">
      <h2 className="title" id="your-projects-title">
        Your projects <span className="dim">· {projects ? projects.length : 'loading'}</span>
        <a className="icon small wide" href="#/project/new" title="Start a new project">
          <Plus size={12} /> New
        </a>
      </h2>
      {projects?.length === 0 ? (
        <p className="empty">
          No projects yet. <a href="#/project/new">Start one</a>, or <a href="#/upload">publish pieces from a MIDI song</a>.
        </p>
      ) : (
        <ul>
          {(projects ?? []).map((p) => (
            <li key={p.id}>
              <a href={`#/project/${p.id}`}>
                <span className="dim">{name} /</span> {p.nombre}
              </a>
              {p.publica === false ? (
                <span className="public private">
                  <Lock size={10} aria-hidden="true" /> Private
                </span>
              ) : (
                <span className="public">Public</span>
              )}
              <span className="dim">{p.tempo} BPM</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}


function Explore({ projects, pieces, playing, onPreview, onPreviewPiece, onUser }) {
  const [view, setView] = useState('projects') // 'projects' | 'library'
  const [q, setQ] = useState('')
  const [tags, setTags] = useState([])
  const [sort, setSort] = useState('updated')

  const allTags = useMemo(() => {
    const count = {}
    for (const p of projects ?? []) for (const t of p.etiquetas) count[t] = (count[t] ?? 0) + 1
    return Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [projects])

  const stats = (p) => {
    const used = [...new Set(p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))].map((id) => pieces[id]).filter(Boolean)
    return { count: used.length, authors: new Set(used.map((x) => x.autor)).size, forked: used.filter((x) => x.parent_id).length }
  }

  const text = q.trim().toLowerCase()
  const shown = (projects ?? [])
    .filter((p) => tags.every((t) => p.etiquetas.includes(t)))
    .filter((p) => !text || `${p.nombre} ${p.descripcion} ${p.autor} ${p.etiquetas.join(' ')}`.toLowerCase().includes(text))
    .sort((a, b) => (sort === 'pieces' ? stats(b).count - stats(a).count : (b.actualizado ?? b.id).localeCompare(a.actualizado ?? a.id)))
  const toggle = (t) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))

  return (
    <section id="explore" className="explore panel">
      <h2 className="title explore-title">
        <span className="explore-tabs" role="tablist" aria-label="Explore">
          <button role="tab" aria-selected={view === 'projects'} className={view === 'projects' ? 'on' : ''} onClick={() => setView('projects')}>
            <Disc3 size={14} aria-hidden="true" /> Public projects
          </button>
          <button role="tab" aria-selected={view === 'library'} className={view === 'library' ? 'on' : ''} onClick={() => setView('library')}>
            <Library size={14} aria-hidden="true" /> Library
          </button>
        </span>
        {view === 'projects' && <span className="dim">{projects ? `${shown.length} of ${projects.length}` : 'loading'}</span>}
      </h2>
      {view === 'library' ? (
        <PieceLibrary playing={playing} onPreview={onPreviewPiece} onUser={onUser} />
      ) : (
        <>
          <div className="explore-tools">
            <label className="search">
              <Search size={14} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, authors, tags" aria-label="Search projects" />
            </label>
            <label className="snap">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort projects">
                <option value="updated">Recently updated</option>
                <option value="pieces">Most pieces</option>
              </select>
            </label>
          </div>
          <div className="tag-bar" role="group" aria-label="Filter by tag">
            {allTags.map(([t, n]) => (
              <button key={t} className={`tag ${tags.includes(t) ? 'on' : ''}`} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
                {t} <span>{n}</span>
              </button>
            ))}
            {tags.length > 0 && (
              <button className="tag clear" onClick={() => setTags([])}>
                <X size={11} /> Clear
              </button>
            )}
          </div>

          <ul className="projects">
            {projects && shown.length === 0 && (
              <li className="empty">
                No projects match{text && ` “${q}”`}
                {tags.length > 0 && ` with ${tags.join(' + ')}`}. Try fewer tags or another word.
              </li>
            )}
            {shown.map((p) => {
              const s = stats(p)
              return (
                <li key={p.id} className="proj">
                  <div className="proj-main">
                    <div className="proj-name">
                      <a className="owner" href={`#/u/${encodeURIComponent(p.autor)}`}>
                        {p.autor}
                      </a>{' '}
                      / <a href={`#/project/${p.id}`}>{p.nombre}</a>
                    </div>
                    <p>{p.descripcion}</p>
                    <div className="proj-tags">
                      {p.etiquetas.map((t) => (
                        <button key={t} className={`tag ${tags.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <div className="proj-meta">
                      {p.tempo} BPM · {s.count} pieces · {s.authors} {s.authors === 1 ? 'author' : 'authors'} · {s.forked} forked
                      {p.actualizado && ` · Updated ${updated(p.actualizado)}`}
                    </div>
                  </div>
                  <div className="proj-side">
                    <Arrangement song={p} pieces={pieces} />
                    <div className="proj-actions">
                      <button className={`tbtn square ${playing === p.id ? 'on' : ''}`} onClick={() => onPreview(p)} aria-label={`${playing === p.id ? 'Stop' : 'Preview'} ${p.nombre}`}>
                        {playing === p.id ? <Square size={13} /> : <Play size={14} />}
                      </button>
                      <a className="tbtn" href={`#/project/${p.id}`}>
                        Open <ArrowRight size={13} />
                      </a>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

