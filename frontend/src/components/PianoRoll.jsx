import { useCallback, useEffect, useRef, useState } from 'react'
import { GitCompare, GitFork, Magnet, Minus, Play, Plus, Redo2, Save, Square, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useWidth } from '../useWidth.js'
import { instrumentFor, previewNote } from '../audio.js'
import { typeLabel } from './Browser.jsx'
import { isMine } from '../profile.js'

const ROW = 14
const KEYS = 64
const RULER = 18
const VEL_H = 56
const SNAPS = [
  [0.125, '1/32'],
  [0.25, '1/16'],
  [0.5, '1/8'],
  [1, 'Beat'],
]
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const DRUM_NAMES = {
  35: 'Kick 2', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare 2', 41: 'Tom low', 42: 'Hat closed', 43: 'Tom low 2',
  44: 'Hat pedal', 45: 'Tom mid', 46: 'Hat open', 47: 'Tom mid 2', 48: 'Tom high', 49: 'Crash', 50: 'Tom high 2', 51: 'Ride',
  52: 'China', 53: 'Ride bell', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 59: 'Ride 2', 62: 'Conga slap', 63: 'Conga open',
  64: 'Conga low', 75: 'Clave', 22: 'Hat closed', 26: 'Hat open',
}
export const noteName = (t) => `${NAMES[t % 12]}${Math.floor(t / 12) - 1}`
const isBlack = (t) => NAMES[t % 12].includes('#')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function PianoRoll({ piece, parent, notes, bars, dirty, editable, diff, onChange, onBars, onFork, onSave, onToggleDiff, onPreview, previewing, playhead }) {
  const [measure, width] = useWidth()
  const [zoom, setZoom] = useState(1)
  const scroller = useRef(null)
  const zoomBy = (f) => setZoom((z) => Math.min(8, Math.max(0.5, z * f)))
  const setScroller = useCallback((el) => {
    measure(el)
    scroller.current = el
  }, [measure])
  // Ctrl/Cmd + wheel zooms the time axis; plain wheel and Shift+wheel scroll as usual.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [piece?.id])
  const [sel, setSel] = useState([]) // selected note indices
  const [hover, setHover] = useState(null) // { tono, beat }
  const [step, setStep] = useState(0.25) // snap in beats
  const [lastLen, setLastLen] = useState(0.5) // new notes copy the last touched length, like FL
  const [box, setBox] = useState(null) // marquee in grid px
  const drag = useRef(null)
  const past = useRef([])
  const future = useRef([])

  useEffect(() => {
    setSel([])
    past.current = []
    future.current = []
  }, [piece?.id])

  const snap = (b) => Math.round(b / step) * step
  const beats = (bars ?? piece?.compases ?? 1) * 4
  const minBars = Math.max(1, Math.ceil(Math.max(0, ...notes.map((n) => n.inicio + n.duracion)) / 4)) // never cut notes off
  const drums = piece?.tipo === 'ritmo'
  const instrument = instrumentFor(piece?.tipo)

  /** Apply an edit; `record` pushes one undo step (drags record once at their first change). */
  const edit = (next, record = true) => {
    if (record) {
      past.current.push(notes)
      future.current = []
    }
    onChange(next)
  }
  const undo = () => {
    if (!past.current.length) return
    future.current.push(notes)
    onChange(past.current.pop())
    setSel([])
  }
  const redo = () => {
    if (!future.current.length) return
    past.current.push(notes)
    onChange(future.current.pop())
    setSel([])
  }
  const quantize = () => {
    const targets = sel.length ? new Set(sel) : null
    edit(notes.map((n, i) => (!targets || targets.has(i) ? { ...n, inicio: clamp(snap(n.inicio), 0, beats - n.duracion) } : n)))
  }

  // Rows, top to bottom: used drum sounds only, or a keyboard range around the notes.
  const all = diff ? [...diff.iguales, ...diff.nuevas, ...diff.borradas, ...diff.movidas.flatMap((m) => [m.antes, m.despues])] : notes
  const pitches = all.map((n) => n.tono)
  let rows
  if (drums) rows = [...new Set(pitches)].sort((a, b) => b - a)
  else {
    let lo = Math.min(...pitches, 60) - 3
    let hi = Math.max(...pitches, 60) + 3
    while (hi - lo < 24) [lo, hi] = [lo - 1, hi + 1]
    rows = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i)
  }
  const rowOf = (t) => rows.indexOf(t)
  const shiftRow = (t, d) => rows[clamp(rowOf(t) - d, 0, rows.length - 1)] // d > 0 moves up
  /** Limit a move of the `group` notes so the whole group stays inside the roll: chords keep their shape at the edges. */
  const clampMove = (base, group, dBeat, dRow) => {
    const g = group.map((i) => base[i])
    const rs = g.map((n) => rowOf(n.tono))
    return [
      clamp(dBeat, -Math.min(...g.map((n) => n.inicio)), beats - Math.max(...g.map((n) => n.inicio + n.duracion))),
      clamp(dRow, Math.max(...rs) - (rows.length - 1), Math.min(...rs)),
    ]
  }
  const beatW = Math.max(12, ((width - KEYS - 2) / Math.min(beats, 16)) * zoom) // zoom 1 fits up to 4 bars; longer pieces scroll sideways

  // Keyboard shortcuts while a piece you own is open.
  useEffect(() => {
    if (!editable) return
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, .playlist')) return // the playlist has its own Delete / Ctrl+A
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const pick = new Set(sel)
      const moveSel = (fn) => edit(notes.map((n, i) => (pick.has(i) ? fn(n) : n)))
      if (mod && k === 'z') e.shiftKey ? redo() : undo()
      else if (mod && k === 'y') redo()
      else if (mod && k === 'a') setSel(notes.map((_, i) => i))
      else if (mod && k === 'd' && sel.length) {
        const chosen = notes.filter((_, i) => pick.has(i))
        const start = Math.min(...chosen.map((n) => n.inicio))
        const span = Math.ceil(Math.max(...chosen.map((n) => n.inicio + n.duracion)) - start)
        const copies = chosen.map((n) => ({ ...n, inicio: n.inicio + span })).filter((n) => n.inicio + n.duracion <= beats)
        edit([...notes, ...copies])
        setSel(copies.map((_, i) => notes.length + i))
      } else if (e.key === 'Escape') setSel([])
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        edit(notes.filter((_, i) => !pick.has(i)))
        setSel([])
      } else if (e.key.startsWith('Arrow') && sel.length) {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? (e.shiftKey && !drums ? 12 : 1) : e.key === 'ArrowDown' ? (e.shiftKey && !drums ? -12 : -1) : 0
        const [bx, by] = clampMove(notes, sel, dx, dy)
        moveSel((n) => ({ ...n, inicio: n.inicio + bx, tono: by ? shiftRow(n.tono, by) : n.tono }))
        if (by && sel.length === 1) previewNote(instrument, shiftRow(notes[sel[0]].tono, by))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!piece)
    return (
      <section className="panel roll" onContextMenu={(e) => e.preventDefault()}>
        <h2 className="title">Piano roll</h2>
        <div className="empty roll-empty">Pick a piece in the Browser or Playlist to see its notes, then fork it to edit your own copy.</div>
      </section>
    )

  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return { beat: clamp(x / beatW, 0, beats), tono: rows[clamp(Math.floor(y / ROW), 0, rows.length - 1)], x, y }
  }
  const hitTest = (p) => notes.findLastIndex((n) => n.tono === p.tono && p.beat >= n.inicio && p.beat < n.inicio + n.duracion)

  const onDown = (e) => {
    if (!editable || e.button !== 0) return
    const p = at(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.ctrlKey || e.metaKey) {
      drag.current = { mode: 'box', start: p, add: e.shiftKey ? sel : [] }
      setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return
    }
    const hit = hitTest(p)
    if (hit >= 0) {
      if (e.shiftKey) return setSel(sel.includes(hit) ? sel.filter((i) => i !== hit) : [...sel, hit])
      const group = sel.includes(hit) ? sel : [hit]
      setSel(group)
      const n = notes[hit]
      setLastLen(n.duracion)
      const edge = (n.inicio + n.duracion) * beatW - p.x < 7
      drag.current = { mode: edge ? 'resize' : 'move', start: p, base: notes, group, anchor: n }
    } else {
      // Empty space: dragging draws a selection box (Shift adds to it); a plain click is handled in onUp.
      drag.current = { mode: 'empty', start: p, add: e.shiftKey ? sel : [] }
    }
  }

  const onMove = (e) => {
    const p = at(e)
    // Only re-render when the readout would change (same row and grid step = same text).
    setHover((h) => (h && h.tono === p.tono && Math.floor(h.beat / step) === Math.floor(p.beat / step) ? h : p))
    const d = drag.current
    if (!d) return
    if (d.mode === 'empty') {
      if (Math.abs(p.x - d.start.x) < 4 && Math.abs(p.y - d.start.y) < 4) return
      d.mode = 'box'
    }
    if (d.mode === 'box') return setBox({ x0: d.start.x, y0: d.start.y, x1: p.x, y1: p.y })
    const group = new Set(d.group)
    const dBeat = snap(p.beat - d.start.beat)
    let next
    if (d.mode === 'move') {
      const [b, r] = clampMove(d.base, d.group, dBeat, rowOf(d.start.tono) - rowOf(p.tono))
      next = d.base.map((n, i) => (group.has(i) ? { ...n, inicio: n.inicio + b, tono: shiftRow(n.tono, r) } : n))
      const moved = next[d.group[0]]
      if (moved.tono !== notes[d.group[0]]?.tono) previewNote(instrument, moved.tono)
    } else {
      next = d.base.map((n, i) => (group.has(i) ? { ...n, duracion: clamp(n.duracion + dBeat, step, beats - n.inicio) } : n))
      setLastLen(next[d.group[0]].duracion)
    }
    if (next.some((n, i) => n !== notes[i])) {
      edit(next, !d.recorded)
      d.recorded = true
    }
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'empty') {
      // A click on empty space: with a selection it only deselects; otherwise it adds a note there.
      if (sel.length) return setSel([])
      const p = d.start
      const n = { tono: p.tono, inicio: clamp(Math.floor(p.beat / step) * step, 0, beats - lastLen), duracion: Math.min(lastLen, beats), velocidad: 0.8 }
      edit([...notes, n])
      return previewNote(instrument, p.tono)
    }
    if (d?.mode !== 'box' || !box) return
    const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)]
    const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)]
    const inside = notes.flatMap((n, i) => {
      const nx = n.inicio * beatW
      const ny = rowOf(n.tono) * ROW
      return nx < x1 && nx + n.duracion * beatW > x0 && ny < y1 && ny + ROW > y0 ? [i] : []
    })
    setSel([...new Set([...d.add, ...inside])])
    setBox(null)
  }

  const onContext = (e) => {
    e.preventDefault()
    if (!editable) return
    const hit = hitTest(at(e))
    if (hit < 0) return
    edit(notes.filter((_, i) => i !== hit))
    setSel([])
  }

  // Velocity lane: drag up/down over a column to set the velocity of the notes starting there.
  const velAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const beat = (e.clientX - r.left) / beatW
    const v = clamp(1 - (e.clientY - r.top) / VEL_H, 0.05, 1)
    const targets = new Set(sel.length ? sel : notes.map((_, i) => i))
    const hits = notes.flatMap((n, i) => (targets.has(i) && Math.abs(n.inicio - beat) < Math.max(step, 6 / beatW) ? [i] : []))
    if (!hits.length) return
    const near = Math.min(...hits.map((i) => Math.abs(notes[i].inicio - beat)))
    const pick = new Set(hits.filter((i) => Math.abs(notes[i].inicio - beat) === near)) // the column under the pointer, chords together
    const d = drag.current
    edit(notes.map((n, i) => (pick.has(i) ? { ...n, velocidad: Math.round(v * 100) / 100 } : n)), !d?.recorded)
    if (d) d.recorded = true
  }
  const velDown = (e) => {
    if (!editable || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode: 'vel' }
    velAt(e)
  }

  const noteBox = (n) => ({ left: n.inicio * beatW, top: rowOf(n.tono) * ROW, width: n.duracion * beatW - 1 })
  const one = sel.length === 1 ? notes[sel[0]] : null
  const pitchLabel = (t) => (drums ? DRUM_NAMES[t] ?? t : noteName(t))
  const fmt = (b) => `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}${b % 1 ? `.${Math.round((b % 1) * 4) + 1}` : ''}`
  const readout =
    sel.length > 1
      ? `${sel.length} notes selected`
      : one
        ? `${pitchLabel(one.tono)} · ${fmt(one.inicio)} · len ${one.duracion} · vel ${Math.round(one.velocidad * 100)}`
        : hover
          ? `${pitchLabel(hover.tono)} · ${fmt(Math.floor(hover.beat / step) * step)}`
          : '—'
  const gridW = beats * beatW
  const picked = new Set(sel)

  return (
    <section className="panel roll" onContextMenu={(e) => e.preventDefault()}>
      <h2 className="title roll-title">
        <span>
          Piano roll <span className="dim">· {piece.nombre}</span>
        </span>
        <span className="credit">
          <span className="code">{piece.id}</span> {typeLabel(piece.tipo)} by <b>{piece.autor}</b> · {piece.licencia}
          {parent && (
            <>
              {' '}
              · forked from <span className="code">{parent.id}</span> {parent.autor}
            </>
          )}
        </span>
        <span className="title-tools">
          <button className="icon small" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (Ctrl+wheel)">
            <ZoomOut size={13} />
          </button>
          <button className="icon small" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (Ctrl+wheel)">
            <ZoomIn size={13} />
          </button>
        </span>
      </h2>

      <div className="roll-tools">
        <button className={`tbtn ${previewing ? 'on' : ''}`} onClick={onPreview}>
          {previewing ? <Square size={13} /> : <Play size={13} />} {previewing ? 'Stop' : 'Preview'}
        </button>
        {!isMine(piece.autor) ? (
          <button className="tbtn accent" onClick={onFork} title="Copy this piece so you can edit it. The original author stays credited.">
            <GitFork size={13} /> Fork to edit
          </button>
        ) : (
          <button className="tbtn" onClick={onSave} disabled={!dirty}>
            <Save size={13} /> {dirty ? 'Save' : 'Saved'}
          </button>
        )}
        {piece.parent_id && (
          <button className={`tbtn ${diff ? 'on' : ''}`} onClick={onToggleDiff} aria-pressed={!!diff} title={`Compare with ${piece.parent_id} by ${parent?.autor ?? 'its author'}`}>
            <GitCompare size={13} /> {diff ? 'Exit diff' : 'What changed?'}
          </button>
        )}
        {diff ? (
          <span className="legend">
            <i className="k-new" /> {diff.nuevas.length} new <i className="k-del" /> {diff.borradas.length} deleted <i className="k-mov" />{' '}
            {diff.movidas.length} moved <i className="k-same" /> {diff.iguales.length} same
          </span>
        ) : (
          editable && (
            <>
              <span className="sep" />
              <span className="bars" role="group" aria-label="Piece length">
                <button className="icon small" onClick={() => onBars(bars - 1)} disabled={bars <= minBars} aria-label="One bar shorter">
                  <Minus size={12} />
                </button>
                <span>{bars} bars</span>
                <button className="icon small" onClick={() => onBars(bars + 1)} disabled={bars >= 32} aria-label="One bar longer">
                  <Plus size={12} />
                </button>
              </span>
              <label className="snap" title="Snap: grid for placing, moving and resizing notes">
                <Magnet size={13} aria-hidden="true" />
                <select value={step} onChange={(e) => setStep(+e.target.value)} aria-label="Snap">
                  {SNAPS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button className="tbtn" onClick={quantize} title={`Snap ${sel.length ? 'selected' : 'all'} note starts to the grid`}>
                Quantize
              </button>
              <button className="tbtn square" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">
                <Undo2 size={14} />
              </button>
              <button className="tbtn square" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                <Redo2 size={14} />
              </button>
              <span
                className="hint"
                title="Click empty: add a note (or deselect) · Drag empty: box select (Shift adds) · Drag a note: move · Drag its end: resize · Shift-click: add to selection · Arrows: nudge (Shift = octave) · Ctrl+D: duplicate · Ctrl+A: select all · Delete / right-click: remove"
              >
                Click to add · drag empty to select · drag notes to move · hover for more
              </span>
            </>
          )
        )}
        {!diff && (
          <span className="readout" aria-live="off">
            {readout}
          </span>
        )}
      </div>

      <div className="roll-scroll" ref={setScroller}>
        <div className="roll-canvas" style={{ width: KEYS + gridW }}>
          <div className="roll-ruler" style={{ height: RULER }}>
            <div className="roll-corner" style={{ width: KEYS }} />
            <div className="roll-bars" style={{ width: gridW, '--beat': `${beatW}px` }}>
              {Array.from({ length: beats / 4 }, (_, i) => (
                <span key={i} style={{ left: i * 4 * beatW }}>
                  {i + 1}
                </span>
              ))}
              {playhead != null && <i className="ruler-head" style={{ left: playhead * beatW }} />}
            </div>
          </div>

          <div className="roll-inner" style={{ height: rows.length * ROW }}>
            <div className="keys" style={{ width: KEYS }}>
              {rows.map((t) => (
                <div
                  key={t}
                  className={`key ${!drums && isBlack(t) ? 'black' : ''} ${!drums && t % 12 === 0 ? 'c' : ''}`}
                  style={{ height: ROW }}
                  onPointerDown={() => previewNote(instrument, t)}
                >
                  {drums ? DRUM_NAMES[t] ?? t : t % 12 === 0 ? noteName(t) : ''}
                </div>
              ))}
            </div>
            <div
              className={`grid ${editable ? 'editable' : ''}`}
              style={{ width: gridW, '--beat': `${beatW}px`, '--step': `${step * beatW}px`, '--row': `${ROW}px` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setHover(null)}
              onContextMenu={onContext}
            >
              {!drums && rows.map((t, i) => isBlack(t) && <div key={t} className="black-row" style={{ top: i * ROW, height: ROW }} />)}

              {diff ? (
                <>
                  {diff.iguales.map((n, i) => <div key={`s${i}`} className="note same" style={noteBox(n)} />)}
                  {diff.borradas.map((n, i) => <div key={`d${i}`} className="note del" style={noteBox(n)} title="Deleted" />)}
                  {diff.nuevas.map((n, i) => <div key={`n${i}`} className="note new" style={noteBox(n)} title="New" />)}
                  {diff.movidas.map((m, i) => <div key={`ma${i}`} className="note was" style={noteBox(m.antes)} />)}
                  {diff.movidas.map((m, i) => <div key={`mb${i}`} className="note mov" style={noteBox(m.despues)} title="Moved" />)}
                  <svg className="moves" width={gridW} height={rows.length * ROW} aria-hidden="true">
                    {diff.movidas.map((m, i) => (
                      <line
                        key={i}
                        x1={m.antes.inicio * beatW + 4}
                        y1={rowOf(m.antes.tono) * ROW + ROW / 2}
                        x2={m.despues.inicio * beatW + 4}
                        y2={rowOf(m.despues.tono) * ROW + ROW / 2}
                      />
                    ))}
                  </svg>
                </>
              ) : (
                notes.map((n, i) => (
                  <div key={i} className={`note ${picked.has(i) ? 'sel' : ''}`} style={{ ...noteBox(n), opacity: 0.45 + n.velocidad * 0.55 }}>
                    {!drums && n.duracion * beatW > 30 && <span>{noteName(n.tono)}</span>}
                  </div>
                ))
              )}
              {box && (
                <div
                  className="marquee"
                  style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
                />
              )}
              {playhead != null && <div className="playhead" style={{ left: playhead * beatW }} />}
            </div>
          </div>

          {!diff && (
            <div className="vel-row" style={{ height: VEL_H }}>
              <div className="vel-label" style={{ width: KEYS }}>
                Velocity
              </div>
              <div
                className={`vel-lane ${editable ? 'editable' : ''}`}
                style={{ width: gridW, '--beat': `${beatW}px` }}
                onPointerDown={velDown}
                onPointerMove={(e) => drag.current?.mode === 'vel' && velAt(e)}
                onPointerUp={() => (drag.current = null)}
                title={editable ? 'Drag up or down on a note column to set its velocity' : undefined}
              >
                {notes.map((n, i) => (
                  <i key={i} className={picked.has(i) ? 'sel' : ''} style={{ left: n.inicio * beatW, height: `${n.velocidad * 100}%` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {!editable && !diff && <p className="roll-foot">This piece belongs to {piece.autor}. Fork it to edit your own copy; they stay credited in the origin tree.</p>}
    </section>
  )
}
