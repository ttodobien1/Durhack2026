import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useWidth } from '../useWidth.js'
import { isMine } from '../profile.js'
import { STARTER } from './Copilot.jsx'

const MIN_BARS = 16 // the arrangement always shows at least this many bars, plus 4 empty ones after the last clip
const HEAD = 150
const LANE_H = 52
const RULER_H = 20

const LANE_NAMES = { bateria: 'Drums', drums: 'Drums', piano: 'Piano', bajo: 'Bass', bass: 'Bass', melodia: 'Lead', lead: 'Lead' }

/** True when a block of `len` bars at `compas` would overlap a block in the lane other than those `skip(j)` accepts. */
export function overlaps(bloques, pieces, compas, len, skip = () => false) {
  return bloques.some((b, j) => !skip(j) && compas < b.compas + (pieces[b.pieza_id]?.compases ?? 0) && b.compas < compas + len)
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const keyOf = (lane, compas) => `${lane}:${compas}` // a block is unique by lane + start bar (lanes never overlap)

export function Playlist({ song, pieces, selectedId, songBars, mix, onMix, onSelect, onRemoveLane, onMoveBlocks, onAddBlock, onRemoveBlocks, onSeek, onStarter, playhead }) {
  const [measure, width] = useWidth()
  const [drag, setDrag] = useState(null) // { items: [{ lane, j, compas, len, pieza_id }], click, x0, y0, dBar, dLane, copy, moved }
  const [box, setBox] = useState(null) // marquee in playlist-body content pixels: { x0, y0, x1, y1, moved, add }
  const [sel, setSel] = useState([]) // selected block keys
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
  const lanes = song.pistas.length
  useEffect(() => {
    setSel([]) // lane indices shift when a lane goes away
  }, [lanes])

  const itemsOf = (keys) =>
    song.pistas.flatMap((t, lane) =>
      t.bloques.flatMap((b, j) => (keys.includes(keyOf(lane, b.compas)) ? [{ lane, j, compas: b.compas, len: pieces[b.pieza_id]?.compases ?? 1, pieza_id: b.pieza_id }] : [])),
    )
  const at = (e) => {
    const el = body.current
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop }
  }

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

  // Clips: drag to move between bars and lanes (the whole selection if the clip is in it), Ctrl/Cmd-drag to copy, click to open.
  const clipDown = (e, lane, j) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const b = song.pistas[lane].bloques[j]
    const key = keyOf(lane, b.compas)
    const items = itemsOf(sel.includes(key) ? sel : [key])
    setDrag({ items, click: { key, pieza_id: b.pieza_id }, x0: e.clientX, y0: e.clientY, dBar: 0, dLane: 0, copy: e.ctrlKey || e.metaKey, moved: false })
  }
  const clipMove = (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    const { items } = drag
    const dBar = clamp(Math.round(dx / barW), -Math.min(...items.map((x) => x.compas)), VIEW_BARS - Math.max(...items.map((x) => x.compas + x.len)))
    const dLane = clamp(Math.round(dy / LANE_H), -Math.min(...items.map((x) => x.lane)), lanes - 1 - Math.max(...items.map((x) => x.lane)))
    setDrag({ ...drag, dBar, dLane, moved: drag.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4, copy: e.ctrlKey || e.metaKey })
  }
  const blocked =
    drag?.moved &&
    drag.items.some((x) => {
      const to = x.lane + drag.dLane
      const moving = (j) => !drag.copy && drag.items.some((y) => y.lane === to && y.j === j)
      return overlaps(song.pistas[to].bloques, pieces, x.compas + drag.dBar, x.len, moving)
    })
  const clipUp = () => {
    if (!drag) return
    if (!drag.moved) {
      onSelect(drag.click.pieza_id)
      setSel([drag.click.key])
    } else if (!blocked && (drag.dBar || drag.dLane || drag.copy)) {
      onMoveBlocks(drag.items, drag.dLane, drag.dBar, drag.copy)
      setSel(drag.items.map((x) => keyOf(x.lane + drag.dLane, x.compas + drag.dBar))) // the moved blocks (or the new copies)
    }
    setDrag(null)
  }

  // Empty lane space: drag to select an area of clips (Shift adds), click to paint the lane's piece at that bar.
  const laneDown = (e) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    body.current.focus({ preventScroll: true }) // so Delete / Esc / Ctrl+A reach the playlist
    const p = at(e)
    setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, add: e.shiftKey })
  }
  const laneMove = (e) => {
    if (!box) return
    const p = at(e)
    setBox({ ...box, x1: p.x, y1: p.y, moved: box.moved || Math.abs(p.x - box.x0) > 4 || Math.abs(p.y - box.y0) > 4 })
  }
  const laneUp = (e, i) => {
    if (!box) return
    setBox(null)
    if (box.moved) {
      const [l, r, t, b] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1), Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
      const hit = song.pistas.flatMap((pista, lane) =>
        pista.bloques
          .filter((bl) => {
            const x = HEAD + bl.compas * barW
            const y = RULER_H + lane * LANE_H
            return x < r && x + (pieces[bl.pieza_id]?.compases ?? 1) * barW > l && y < b && y + LANE_H > t
          })
          .map((bl) => keyOf(lane, bl.compas)),
      )
      return setSel(box.add ? [...new Set([...sel, ...hit])] : hit)
    }
    setSel([])
    const pista = song.pistas[i]
    const pieza_id = pista.bloques[0]?.pieza_id
    if (!pieza_id) return
    const len = pieces[pieza_id]?.compases ?? 1
    const compas = Math.min(VIEW_BARS - len, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / barW))
    if (!overlaps(pista.bloques, pieces, compas, len)) onAddBlock(i, pieza_id, compas)
  }

  const onKeyDown = (e) => {
    if (e.target.closest('input')) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      onRemoveBlocks(itemsOf(sel))
      setSel([])
      body.current.focus({ preventScroll: true }) // the focused clip may be gone; keep shortcuts in the playlist
    } else if (e.key === 'Escape') setSel([])
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') setSel(song.pistas.flatMap((t, lane) => t.bloques.map((b) => keyOf(lane, b.compas))))
    else return
    e.preventDefault()
  }

  return (
    <section className="panel playlist" onContextMenu={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      <h2 className="title">
        Playlist <span className="dim">· {song.nombre}</span>
        <span className="title-hint">Drag empty space to select · drag clips to move · Ctrl-drag to copy · click to paint · Del or right-click to delete · Ctrl+Z undo</span>
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
      <div className="playlist-body" ref={setBody} tabIndex={-1}>
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
          const name = LANE_NAMES[pista.instrumento] ?? pista.instrumento
          const { vol, mute } = mix[i] ?? { vol: 1, mute: false }
          const dropping = drag?.moved && drag.items.some((x) => x.lane + drag.dLane === i)
          return (
            <div className={`lane ${dropping ? 'drop' : ''} ${mute ? 'muted' : ''}`} key={i} style={{ height: LANE_H }}>
              <div className="lane-head" style={{ width: HEAD }}>
                <button className={`led ${mute ? '' : 'on'}`} onClick={() => onMix(i, { mute: !mute })} aria-pressed={mute} aria-label={`Mute ${name}`} title={mute ? 'Unmute' : 'Mute'} />
                <span className="lane-name" title={first?.nombre}>
                  <b>{name}</b> {first?.nombre ?? 'Empty'}
                </span>
                <button className="icon small" onClick={() => onRemoveLane(i)} aria-label={`Remove track ${first?.nombre ?? i + 1}`}>
                  <X size={12} />
                </button>
                <input
                  className="fader"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(vol * 100)}
                  onChange={(e) => onMix(i, { vol: e.target.value / 100 })}
                  aria-label={`${name} volume`}
                  title={`${name} volume ${Math.round(vol * 100)}%`}
                />
              </div>
              <div
                className="lane-grid"
                style={{ width: VIEW_BARS * barW, backgroundSize: `${barW}px 100%, ${barW / 4}px 100%` }}
                onPointerDown={laneDown}
                onPointerMove={laneMove}
                onPointerUp={(e) => laneUp(e, i)}
                onPointerCancel={() => setBox(null)}
              >
                {songBars < VIEW_BARS && <div className="after-end" style={{ left: songBars * barW }} />}
                {pista.bloques.map((b, j) => {
                  const p = pieces[b.pieza_id]
                  if (!p) return null
                  const dragging = drag?.moved && drag.items.some((x) => x.lane === i && x.j === j)
                  return (
                    <button
                      key={j}
                      className={`clip t-${p.tipo} ${isMine(p.autor) ? 'mine' : ''} ${selectedId === p.id ? 'sel' : ''} ${sel.includes(keyOf(i, b.compas)) ? 'picked' : ''} ${dragging && !drag.copy ? 'lifted' : ''}`}
                      style={{ left: b.compas * barW, width: p.compases * barW - 2 }}
                      onPointerDown={(e) => clipDown(e, i, j)}
                      onPointerMove={clipMove}
                      onPointerUp={clipUp}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => e.detail === 0 && onSelect(p.id)} // keyboard activation; mouse clicks go through clipUp
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onRemoveBlocks([{ lane: i, j }])
                      }}
                      title={`${p.nombre} · ${p.autor} · ${p.licencia}`}
                    >
                      <ClipFace p={p} />
                    </button>
                  )
                })}
                {drag?.moved &&
                  drag.items
                    .filter((x) => x.lane + drag.dLane === i)
                    .map((x) => (
                      <div
                        key={`g${x.lane}:${x.j}`}
                        className={`clip ghost t-${pieces[x.pieza_id]?.tipo} ${blocked ? 'blocked' : ''}`}
                        style={{ left: (x.compas + drag.dBar) * barW, width: x.len * barW - 2 }}
                        aria-hidden="true"
                      >
                        <ClipFace p={pieces[x.pieza_id]} />
                      </div>
                    ))}
              </div>
            </div>
          )
        })}
        {playhead != null && song.pistas.length > 0 && (
          // Spans every lane, not just the visible part, so it keeps going when the playlist scrolls down.
          <div
            className="playhead"
            style={{ left: HEAD + (playhead / 4) * barW, top: RULER_H, bottom: 'auto', height: `max(${lanes * LANE_H}px, calc(100% - ${RULER_H}px))` }}
          />
        )}
        {box?.moved && (
          <div
            className="marquee"
            style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
            aria-hidden="true"
          />
        )}
      </div>
    </section>
  )
}

function ClipFace({ p }) {
  return (
    <>
      <span className="clip-head">
        <span className="clip-name">{p.nombre}</span> <span className="clip-by">{isMine(p.autor) ? 'yours' : p.autor}</span>
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
