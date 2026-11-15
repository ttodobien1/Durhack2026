// Project helpers shared by the landing and profile pages.
import { GitFork, MessageSquare } from 'lucide-react'

/** Comments and forks of a project, when it has any (cambios.md §14). */
export function Counts({ p }) {
  return (
    <>
      {p.comentarios > 0 && (
        <span className="count-inline" title={`${p.comentarios} ${p.comentarios === 1 ? 'comment' : 'comments'}`}>
          <MessageSquare size={12} aria-hidden="true" /> {p.comentarios}
        </span>
      )}
      {p.forks > 0 && (
        <span className="count-inline" title={`${p.forks} ${p.forks === 1 ? 'fork' : 'forks'}`}>
          <GitFork size={12} aria-hidden="true" /> {p.forks}
        </span>
      )}
    </>
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
    descripcion:
      p.descripcion || // written by the author; otherwise derived from the pieces
      (names.length
        ? `Built from ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`
        : p.pistas.some((t) => t.bloques.length)
          ? '' // its pieces are still loading
          : 'An empty project.'),
  }
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
