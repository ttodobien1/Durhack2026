import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useWidth } from '../useWidth.js'
import { ME } from '../api.js'
import { STARTER } from './Copilot.jsx'

const MIN_BARS = 16 // the arrangement always shows at least this many bars, plus 4 empty ones after the last clip
const HEAD = 150
const LANE_H = 52
const RULER_H = 20

const LANE_NAMES = { bateria: 'Drums', drums: 'Drums', piano: 'Piano', bajo: 'Bass', bass: 'Bass', melodia: 'Lead', lead: 'Lead' }

/** True when a block of `len` bars at `compas` would overlap another block in the lane. */
export function overlaps(bloques, pieces, compas, len, skip = -1) {
  return bloques.some((b, j) => j !== skip && compas < b.compas + (pieces[b.pieza_id]?.compases ?? 0) && b.compas < compas + len)
}

export function Playlist({ song, pieces, selectedId, songBars, onSelect, onRemoveLane, onMoveBlock, onAddBlock, onRemoveBlock, onSeek, onStarter, playhead }) {
  const [measure, width] = useWidth()
  const [drag, setDrag] = useState(null) // { from, j, len, pieza_id, x0, y0, compas0, to, compas, copy, moved }
  const [zoom, setZoom] = useState(1)
  const [room, setRoom] = useState(MIN_BARS) // bars the user opened up with "+4 bars"
  const seeking = useRef(false)
  const body = useRef(null)
  const VIEW_BARS = Math.max(room, songBars + 4)
  const barW = Math.max(20, ((width - HEAD) / MIN_BARS) * zoom) // zoom 1 fits 16 bars; more bars scroll sideways
  const setBody = useCallback((el) => {
    measure(el)
    body.current = el
  }, [measure])
  const zoomBy = (f) => setZoom((z) => Math.min(6, Math.max(0.4, z * f)))

  // Ctrl/Cmd + wheel zooms the timeline (needs a non-passive listener to stop the page zoom).
  useEffect(() => {
    const el = body.current
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Ruler: click or drag to move the playhead (snaps to beats).
  const seekAt = (e) => onSeek(Math.round(Math.max(0, e.clientX - e.currentTarget.getBoundingClientRect().left - HEAD) / (barW / 4)))
  const rulerDown = (e) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    seeking.current = true
    seekAt(e)
  }

  // Clips: drag to move between bars and lanes, Ctrl/Cmd-drag to copy, click to open.
  const clipDown = (e, from, j) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const b = song.pistas[from].bloques[j]
    const len = pieces[b.pieza_id]?.compases ?? 1
    setDrag({ from, j, len, pieza_id: b.pieza_id, x0: e.clientX, y0: e.clientY, compas0: b.compas, to: from, compas: b.compas, copy: e.ctrlKey || e.metaKey, moved: false })
  }
  const clipMove = (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    const moved = drag.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4
    const compas = Math.min(VIEW_BARS - drag.len, Math.max(0, drag.compas0 + Math.round(dx / barW)))
    const to = Math.min(song.pistas.length - 1, Math.max(0, drag.from + Math.round(dy / LANE_H)))
    setDrag({ ...drag, compas, to, moved, copy: e.ctrlKey || e.metaKey })
  }
  const blocked = drag && overlaps(song.pistas[drag.to].bloques, pieces, drag.compas, drag.len, drag.to === drag.from && !drag.copy ? drag.j : -1)
  const clipUp = () => {
    if (!drag) return
    if (!drag.moved) onSelect(drag.pieza_id)
    else if (!blocked && (drag.to !== drag.from || drag.compas !== drag.compas0 || drag.copy)) onMoveBlock(drag.from, drag.j, drag.to, drag.compas, drag.copy)
    setDrag(null)
  }

  // Empty lane space: click to paint the lane's piece at that bar.
  const laneDown = (e, i) => {
    const pista = song.pistas[i]
    const pieza_id = pista.bloques[0]?.pieza_id
    if (e.button !== 0 || !pieza_id) return
    const len = pieces[pieza_id]?.compases ?? 1
    const compas = Math.min(VIEW_BARS - len, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / barW))
    if (!overlaps(pista.bloques, pieces, compas, len)) onAddBlock(i, pieza_id, compas)
  }

  return (
    <section className="panel playlist" onContextMenu={(e) => e.preventDefault()}>
      <h2 className="title">
        Playlist <span className="dim">· {song.nombre}</span>
        <span className="title-hint">Drag clips to move · Ctrl-drag to copy · click empty space to paint · right-click to delete</span>
        <span className="title-tools">
          <button className="icon small" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (Ctrl+wheel)">
            <ZoomOut size={13} />
          </button>
          <button className="icon small" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (Ctrl+wheel)">
            <ZoomIn size={13} />
          </button>
          <button className="icon small wide" onClick={() => setRoom(VIEW_BARS + 4)} title="Make the arrangement 4 bars longer">
            <Plus size={12} /> 4 bars
          </button>
        </span>
      </h2>
      <div
        className="playlist-body"
        ref={setBody}
      >
        <div
          className="ruler"
          style={{ paddingLeft: HEAD, height: RULER_H }}
          onPointerDown={rulerDown}
          onPointerMove={(e) => seeking.current && seekAt(e)}
          onPointerUp={() => (seeking.current = false)}
          title="Click or drag to move the playhead"
        >
          {Array.from({ length: VIEW_BARS }, (_, i) => (
            <span key={i} className={i >= songBars ? 'out' : ''} style={{ width: barW }}>
              {i + 1}
            </span>
          ))}
          {playhead != null && <div className="ruler-head" style={{ left: HEAD + (playhead / 4) * barW }} />}
        </div>

        {song.pistas.length === 0 && (
          <div className="empty lanes-empty">
            <p>
              <strong>No tracks yet.</strong> Add pieces from the Browser with <b>+</b>, or let the Copilot suggest a start:
            </p>
            <button className="tbtn accent" onClick={onStarter}>
              Try: “{STARTER}”
            </button>
          </div>
        )}

        {song.pistas.map((pista, i) => {
          const first = pieces[pista.bloques[0]?.pieza_id]
          return (
            <div className={`lane ${drag?.moved && drag.to === i ? 'drop' : ''}`} key={i} style={{ height: LANE_H }}>
              <div className="lane-head" style={{ width: HEAD }}>
                <span className="lane-inst">{LANE_NAMES[pista.instrumento] ?? pista.instrumento}</span>
                <span className="lane-piece">{first?.nombre ?? 'Empty'}</span>
                <button className="icon small" onClick={() => onRemoveLane(i)} aria-label={`Remove track ${first?.nombre ?? i + 1}`}>
                  <X size={12} />
                </button>
              </div>
              <div
                className="lane-grid"
                style={{ width: VIEW_BARS * barW, backgroundSize: `${barW}px 100%, ${barW / 4}px 100%` }}
                onPointerDown={(e) => laneDown(e, i)}
              >
                {songBars < VIEW_BARS && <div className="after-end" style={{ left: songBars * barW }} />}
                {pista.bloques.map((b, j) => {
                  const p = pieces[b.pieza_id]
                  if (!p) return null
                  const dragging = drag?.moved && drag.from === i && drag.j === j
                  return (
                    <button
                      key={j}
                      className={`clip t-${p.tipo} ${p.autor === ME ? 'mine' : ''} ${selectedId === p.id ? 'sel' : ''} ${dragging && !drag.copy ? 'lifted' : ''}`}
                      style={{ left: b.compas * barW, width: p.compases * barW - 2 }}
                      onPointerDown={(e) => clipDown(e, i, j)}
                      onPointerMove={clipMove}
                      onPointerUp={clipUp}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => e.detail === 0 && onSelect(p.id)} // keyboard activation; mouse clicks go through clipUp
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onRemoveBlock(i, j)
                      }}
                      title={`${p.nombre} · ${p.autor} · ${p.licencia}`}
                    >
                      <ClipFace p={p} />
                    </button>
                  )
                })}
                {drag?.moved && drag.to === i && (
                  <div
                    className={`clip ghost t-${pieces[drag.pieza_id]?.tipo} ${blocked ? 'blocked' : ''}`}
                    style={{ left: drag.compas * barW, width: drag.len * barW - 2 }}
                    aria-hidden="true"
                  >
                    <ClipFace p={pieces[drag.pieza_id]} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {playhead != null && song.pistas.length > 0 && <div className="playhead" style={{ left: HEAD + (playhead / 4) * barW, top: RULER_H }} />}
      </div>
    </section>
  )
}

function ClipFace({ p }) {
  return (
    <>
      <span className="clip-head">
        <span className="clip-name">{p.nombre}</span> <span className="clip-by">{p.autor === ME ? 'yours' : p.autor}</span>
      </span>
      <MiniNotes notas={p.notas} beats={p.compases * 4} />
    </>
  )
}

export function MiniNotes({ notas, beats }) {
  if (!notas.length) return null
  const lo = Math.min(...notas.map((n) => n.tono))
  const hi = Math.max(...notas.map((n) => n.tono))
  const span = Math.max(hi - lo, 1)
  return (
    <svg className="mini" viewBox={`0 0 ${beats} 100`} preserveAspectRatio="none" aria-hidden="true">
      {notas.map((n, i) => (
        <rect key={i} x={n.inicio} width={Math.max(n.duracion, 0.15)} y={90 - ((n.tono - lo) / span) * 80} height="8" />
      ))}
    </svg>
  )
}
