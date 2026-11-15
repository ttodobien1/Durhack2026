import { Flame, HandHelping, Lightbulb } from 'lucide-react'
import { Avatar } from '../Site.jsx'
import { Counts, withMeta } from '../projectMeta.jsx'
import { timeAgo } from './Comments.jsx'
import '../social.css'

/**
 * Home page community (cambios.md §14): the most popular public projects, and the help requests of artists stuck on
 * a song ("how can I move forward with this?"), answered in the project's comments.
 * Props: data ({ populares, ayuda } | null while loading), pieces (id → Pieza, for the derived descriptions).
 */
export function Community({ data, pieces }) {
  const populares = (data?.populares ?? []).map((p) => withMeta(p, pieces))
  const ayuda = data?.ayuda ?? []
  return (
    <section className="community" aria-label="Community">
      <div className="panel comm-panel">
        <h2 className="title">
          <Flame size={13} aria-hidden="true" /> Popular projects <span className="dim">· most forked and discussed</span>
        </h2>
        {!data && <p className="empty">Loading…</p>}
        {data && populares.length === 0 && <p className="empty">No public projects yet.</p>}
        <ul className="comm-list">
          {populares.map((p, i) => (
            <li key={p.id} className="comm-item">
              <span className="comm-rank">{i + 1}</span>
              <div>
                <div className="comm-name">
                  <a className="owner" href={`#/u/${encodeURIComponent(p.autor)}`}>
                    {p.autor}
                  </a>{' '}
                  / <a href={`#/project/${p.id}`}>{p.nombre}</a>
                </div>
                {p.descripcion && <p>{p.descripcion}</p>}
                <div className="proj-meta">
                  {p.tempo} BPM <Counts p={p} />
                  {p.permite_propuestas && <span className="count-inline">open to proposals</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel comm-panel">
        <h2 className="title">
          <HandHelping size={13} aria-hidden="true" /> Help wanted <span className="dim">· artists stuck on a song</span>
        </h2>
        {!data && <p className="empty">Loading…</p>}
        {data && ayuda.length === 0 && (
          <p className="empty">No open requests right now. Stuck yourself? Open your project, press Share and ask the community for ideas.</p>
        )}
        <ul className="comm-list">
          {ayuda.map((p) => (
            <li key={p.id} className="help-card">
              <blockquote>“{p.pide_ayuda}”</blockquote>
              <div className="help-by">
                <Avatar name={p.autor} size={20} />
                <a href={`#/u/${encodeURIComponent(p.autor)}`}>{p.autor}</a>
                <span className="dim">on</span>
                <a href={`#/project/${p.id}`}>{p.nombre}</a>
                <span className="dim">· {timeAgo(p.pide_ayuda_at)}</span>
              </div>
              <a className="tbtn accent" href={`#/project/${p.id}?comments=1`}>
                <Lightbulb size={13} aria-hidden="true" /> Give an idea{p.comentarios > 0 && ` · ${p.comentarios}`}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
