// Plays of one piece per hour over the last 24 hours (GET /piezas/:id/actividad, from the events hypertable), as a
// tiny bar chart next to the piece's name in the piano roll. Refreshes every 30 s; hidden offline.
import { useEffect, useState } from 'react'
import { api } from '../api.js'

const W = 60
const H = 14

export function ActivitySpark({ pieceId }) {
  const [act, setAct] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => document.visibilityState === 'visible' && api.activity(pieceId).then((a) => live && setAct(a?.pieza_id === pieceId ? a : null))
    load()
    const t = setInterval(load, 30000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [pieceId])
  if (!act?.horas?.length) return null
  const max = Math.max(1, ...act.horas.map((h) => h.reproducciones))
  const bw = W / act.horas.length
  const label = `${act.total} ${act.total === 1 ? 'play' : 'plays'} in the last 24 hours`
  return (
    <span className="spark" title={`${label} (one bar per hour, newest on the right)`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {act.horas.map((h, i) => {
          const bh = h.reproducciones ? Math.max(2, (h.reproducciones / max) * H) : 1
          return <rect key={h.hora} x={i * bw + 0.5} y={H - bh} width={bw - 1} height={bh} className={h.reproducciones ? 'on' : ''} />
        })}
      </svg>
      <span>{act.total} · 24 h</span>
    </span>
  )
}
