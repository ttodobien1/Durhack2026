/** Read-only piano roll (project history: diffs, credits, version tree). Notes are colored by class (same/new/del/mov/from, see rolls.js) or by `color`. */
export function MiniRoll({ notes, beats }) {
  if (!notes.length) return <div className="mini-roll none">No notes</div>
  const lo = Math.min(...notes.map((n) => n.tono)) - 1
  const hi = Math.max(...notes.map((n) => n.tono)) + 1
  const rows = hi - lo + 1
  const W = 800
  const bw = W / Math.max(beats, 1)
  const lines = []
  for (let b = 4; b < beats; b += 4) lines.push(b)
  return (
    <svg className="mini-roll" viewBox={`0 0 ${W} ${rows * 10}`} preserveAspectRatio="none" style={{ height: Math.min(120, Math.max(44, rows * 5)) }} aria-hidden="true">
      {lines.map((b) => (
        <line key={b} x1={b * bw} x2={b * bw} y1="0" y2={rows * 10} vectorEffect="non-scaling-stroke" />
      ))}
      {notes.map((n, i) => (
        <rect
          key={i}
          className={n.cls ? `mr-${n.cls}` : undefined}
          x={n.inicio * bw}
          y={(hi - n.tono) * 10 + 0.5}
          width={Math.max(n.duracion * bw - 1.5, 2)}
          height="9"
          fill={n.color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
