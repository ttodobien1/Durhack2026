import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Play, Plus, Search, Square, X } from 'lucide-react'
import { api } from './api.js'
import * as audio from './audio.js'
import { diffNotes } from './diff.js'
import { SiteBar } from './Site.jsx'
import { useUser } from './profile.js'
import { MiniNotes } from './components/Playlist.jsx'
import './landing.css'

const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function updated(iso) {
  const h = (new Date(iso) - Date.now()) / 3600e3
  return Math.abs(h) < 24 ? ago.format(Math.round(h), 'hour') : ago.format(Math.round(h / 24), 'day')
}

export function Landing() {
  const [projects, setProjects] = useState(null)
  const [pieces, setPieces] = useState({})
  const [user, setUser] = useUser()
  const [playing, setPlaying] = useState(null)

  const [chain, setChain] = useState(null) // [parent, fork] from the library, for the hero

  useEffect(() => {
    api.projects().then(async (list) => {
      const ids = [...new Set(list.flatMap((p) => p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id))))]
      const loaded = await Promise.all(ids.map((id) => api.getPiece(id).catch(() => null)))
      const byId = Object.fromEntries(loaded.filter(Boolean).map((p) => [p.id, p]))
      setPieces(byId)
      setProjects(list.map((p) => withMeta(p, byId)))
      if (location.hash === '#explore') requestAnimationFrame(() => document.getElementById('explore')?.scrollIntoView()) // arrived from another page
      // Hero: the first real fork in the library whose parent we can show.
      for (const tipo of ['acordes', 'melodia', 'bajo']) {
        const found = await api.search({ tipo }).catch(() => [])
        const fork = found.find((x) => x.parent_id && found.some((y) => y.id === x.parent_id))
        if (fork) return setChain([found.find((y) => y.id === fork.parent_id), fork])
      }
    }, (e) => setProjects([]) || console.error(e))
    return () => audio.stop()
  }, [])

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
          <LineageDemo chain={chain} />
        </section>

        <ol className="flow" aria-label="How it works">
          {[
            ['Search', 'Drum loops, chords, bass lines and melodies, filtered by type and key.'],
            ['Fork', 'Copy any piece to make it yours. The original author stays credited.'],
            ['Edit', 'Change notes in the piano roll and arrange pieces in the playlist.'],
            ['Diff', 'See what you changed: new notes in green, deleted in red, moved in yellow.'],
            ['Trace', 'The origin tree shows every piece in your song and who made it.'],
          ].map(([t, d]) => (
            <li key={t}>
              <strong>{t}</strong>
              <span>{d}</span>
            </li>
          ))}
        </ol>

        <Explore projects={projects} pieces={pieces} playing={playing} onPreview={preview} />
      </main>

      <footer className="site-foot">
        <span>Stemma · DurHack 2026</span>
        <span>Demo projects and pieces are sample data.</span>
      </footer>

    </div>
  )
}

/** Songs from the backend carry only contract fields: derive tags and a description from their pieces. */
export function withMeta(p, pieces) {
  const used = [...new Set(p.pistas.flatMap((t) => t.bloques.map((b) => b.pieza_id)))].map((id) => pieces[id]).filter(Boolean)
  const tags = [...new Set(used.flatMap((x) => [...(x.estilo ?? []), x.tonalidad && `${x.tonalidad.toLowerCase()}`]).filter(Boolean))]
  const names = used.map((x) => x.nombre)
  return {
    ...p,
    etiquetas: p.etiquetas?.length ? p.etiquetas : tags,
    descripcion: p.descripcion ?? (names.length ? `Built from ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.` : 'An empty project.'),
  }
}

/** A real lineage from the library ending in an example fork by you, with its actual diff counts. */
function LineageDemo({ chain }) {
  const [base, child] = chain ?? []
  const yours = useMemo(() => {
    if (!child) return null
    const notas = child.notas.map((n, i) => (i === 3 ? { ...n, inicio: n.inicio + 0.5 } : n)).concat({ ...child.notas[0], inicio: Math.min(child.compases * 4 - 1, 6) })
    return { ...child, id: 'p-new', autor: 'you', nombre: `${child.nombre} (your fork)`, notas }
  }, [child])
  if (!base || !child) return <div className="demo panel" aria-hidden="true" />
  const d = diffNotes(child.notas, yours.notas)
  const rows = [
    [base, null],
    [child, `forked by ${child.autor}`],
    [yours, 'forked by you'],
  ]
  return (
    <figure className="demo panel">
      <figcaption className="title">
        Origin of a fork <span className="dim">· example</span>
      </figcaption>
      <div className="demo-body">
        {rows.map(([p, how]) => (
          <div key={p.id} className="demo-step">
            {how && <span className="demo-link">{how}</span>}
            <div className={`clip t-${p.tipo} ${p.autor === 'you' ? 'mine' : ''}`}>
              <span className="clip-head">
                <span className="clip-name">
                  <span className="code">{p.id}</span> {p.nombre}
                </span>
                <span className="clip-by">
                  {p.autor} · {p.licencia}
                </span>
              </span>
              <MiniNotes notas={p.notas} beats={p.compases * 4} />
            </div>
          </div>
        ))}
        <p className="legend demo-legend">
          <i className="k-new" /> {d.nuevas.length} new <i className="k-mov" /> {d.movidas.length} moved <i className="k-del" /> {d.borradas.length} deleted{' '}
          <i className="k-same" /> {d.iguales.length} same
        </p>
      </div>
    </figure>
  )
}

function Explore({ projects, pieces, playing, onPreview }) {
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
      <h2 className="title">
        Public projects <span className="dim">· {projects ? `${shown.length} of ${projects.length}` : 'loading'}</span>
      </h2>
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
    </section>
  )
}

export function Arrangement({ song, pieces }) {
  const bars = Math.max(8, ...song.pistas.flatMap((t) => t.bloques.map((b) => b.compas + (pieces[b.pieza_id]?.compases ?? 0))))
  return (
    <div className="arr" aria-hidden="true">
      {song.pistas.map((t, i) => (
        <div key={i} className="arr-lane">
          {t.bloques.map((b, j) => {
            const p = pieces[b.pieza_id]
            return p && <i key={j} className={`t-${p.tipo}`} style={{ left: `${(b.compas / bars) * 100}%`, width: `calc(${(p.compases / bars) * 100}% - 2px)` }} />
          })}
        </div>
      ))}
    </div>
  )
}
