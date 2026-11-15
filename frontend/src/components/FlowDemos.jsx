import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, GitCompare, GitFork, Play, Plus, Save, Search, Square, X } from 'lucide-react'
import { api } from '../api.js'
import { diffNotes } from '../diff.js'
import { TYPES, typeLabel } from './Browser.jsx'
import { MiniNotes } from './Playlist.jsx'
import './flowdemo.css'

/**
 * Popup that opens over one of the "How it works" steps on the landing page: the same width as the step and
 * twice its height. It plays a short loop of what that step looks like in the project page, with the same
 * controls and real pieces from the library (story = { base, child, yours, move, added }).
 */
export function FlowDemo({ step, n, story, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onDown = (e) => !ref.current?.contains(e.target) && onClose()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const Scene = SCENES[step]
  return (
    <div className="flow-demo panel" role="dialog" aria-label={`${step}: how it looks in the project page`} ref={ref}>
      <h3 className="title">
        <span className="fd-num">{n}</span> {step} <span className="dim">· in the project page</span>
        <button className="icon small" onClick={onClose} aria-label="Close" autoFocus>
          <X size={13} />
        </button>
      </h3>
      <div className="fd-stage" aria-hidden="true" inert>
        {story ? <Scene {...story} /> : <p className="fd-wait">Loading pieces from the library…</p>}
      </div>
    </div>
  )
}

/* ---------- Animation engine: a timeline of state patches plus a mouse cursor that moves to [data-at] targets ---------- */

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** steps: [[wait ms, patch]]; a patch with click: true shows a click ripple. The loop restarts after a pause. */
function Player({ initial, steps, children }) {
  const stage = useRef(null)
  const [s, setS] = useState(initial)
  const [cursor, setCursor] = useState(null)
  const still = useMemo(reduceMotion, [])

  useEffect(() => {
    if (still) return setS(steps.reduce((acc, [, patch]) => ({ ...acc, ...patch, at: null }), initial))
    const timers = []
    const run = () => {
      timers.length = 0
      setS(initial)
      let t = 500
      for (const [wait, patch] of steps) {
        t += wait
        timers.push(setTimeout(() => setS((prev) => ({ ...prev, ...patch, tick: patch.click ? (prev.tick ?? 0) + 1 : prev.tick })), t))
      }
      timers.push(setTimeout(run, t + 2600))
    }
    run()
    return () => timers.forEach(clearTimeout)
    // The timeline is fixed for the life of the popup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Point at the current target (re-measured on every change, since the layout moves under the cursor).
  useLayoutEffect(() => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    const el = s.at && stage.current.querySelector(`[data-at="${s.at}"]`)
    if (!el) return setCursor((c) => c ?? { x: box.width * 0.84, y: box.height * 0.9 })
    const r = el.getBoundingClientRect()
    setCursor({ x: r.left - box.left + Math.min(r.width / 2, 22), y: r.top - box.top + r.height / 2 })
  }, [s])

  return (
    <div className="fd-play" ref={stage}>
      {children(s)}
      {!still && cursor && (
        <>
          {s.tick > 0 && <span key={s.tick} className="fd-click" style={{ left: cursor.x, top: cursor.y }} />}
          <svg className="fd-cursor" style={{ transform: `translate(${cursor.x - 1}px, ${cursor.y - 1}px)` }} viewBox="0 0 14 20" width="14" height="20">
            <path d="M1 1v15l3.8-3.6 2.7 6.3 2.6-1.1-2.7-6.2H13z" />
          </svg>
        </>
      )}
    </div>
  )
}

/** A non-interactive copy of a toolbar button (the stage is inert). */
function Btn({ at, on, accent, disabled, children }) {
  return (
    <button tabIndex={-1} data-at={at} className={`tbtn ${on ? 'on' : ''} ${accent ? 'accent' : ''}`} disabled={disabled}>
      {children}
    </button>
  )
}

/* ---------- Mini piano roll (same colours and note states as PianoRoll.jsx) ---------- */

const BLACK = new Set([1, 3, 6, 8, 10])

/** items: [{ n, cls, at }] drawn as notes; marks: [{ n, at }] invisible targets for the cursor; lines: moved notes. */
function Roll({ piece, items, marks = [], lines = [], playing }) {
  const beats = piece.compases * 4
  const pitches = piece.notas.map((x) => x.tono)
  const hi = Math.max(...pitches) + 1
  const lo = Math.min(...pitches) - 1
  const rows = Math.max(hi - lo + 1, 8)
  const top = hi
  const box = (n) => ({
    left: `${(n.inicio / beats) * 100}%`,
    width: `${(Math.max(n.duracion, 0.15) / beats) * 100}%`,
    top: `${((top - n.tono) / rows) * 100}%`,
    height: `${100 / rows}%`,
  })
  const mid = (n) => [((n.inicio + Math.max(n.duracion, 0.15) / 2) / beats) * 100, ((top - n.tono + 0.5) / rows) * 100]
  return (
    <div className="fd-roll-body">
      <div className="fd-keys">
        {Array.from({ length: rows }, (_, i) => (
          <i key={i} className={BLACK.has((((top - i) % 12) + 12) % 12) ? 'black' : ''} />
        ))}
      </div>
      <div className="fd-grid" style={{ '--bars': piece.compases, '--beats': beats, '--rows': rows }}>
        {items.map(({ n, cls = '', at }, i) => (
          <i key={i} className={`fd-note ${cls}`} style={box(n)} data-at={at} />
        ))}
        {marks.map(({ n, at }) => (
          <i key={at} className="fd-mark" style={box(n)} data-at={at} />
        ))}
        {lines.length > 0 && (
          <svg className="fd-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            {lines.map(([a, b], i) => {
              const [x1, y1] = mid(a)
              const [x2, y2] = mid(b)
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
            })}
          </svg>
        )}
        {playing && <span className="fd-playhead" />}
      </div>
    </div>
  )
}

/** The piano roll panel around the grid: title, credit line (as in PianoRoll.jsx), tools and footer. */
function RollPanel({ piece, parent, tools, foot, children }) {
  return (
    <div className="fd-roll">
      <div className="fd-line fd-rtitle">
        Piano roll <span className="dim">· {piece.nombre}</span>
      </div>
      <div className="fd-line credit">
        <span className="code">{piece.id}</span> {typeLabel(piece.tipo)} by <b>{piece.autor}</b>
        {parent ? (
          <>
            {' '}
            · forked from <span className="code">{parent.id}</span> {parent.autor}
          </>
        ) : (
          ` · ${piece.licencia}`
        )}
      </div>
      <div className="fd-tools">{tools}</div>
      {children}
      <div className="fd-line fd-foot">{foot}</div>
    </div>
  )
}

/* ---------- 1 Search: type in the Browser, filter by type, preview a piece and select it ---------- */

const library = new Map() // child id → { all, hits, typed, word }

function searchWord(child) {
  const words = child.nombre.toLowerCase().split(/[^a-z0-9áéíóúñ]+/).filter((w) => w.length >= 4)
  return words.sort((a, b) => b.length - a.length)[0] ?? child.id
}

async function loadLibrary(child) {
  if (library.has(child.id)) return library.get(child.id)
  const word = searchWord(child)
  const [all, hits, typed] = await Promise.all([api.search({}), api.search({ q: word }), api.search({ q: word, tipo: child.tipo })])
  const lib = { word, all: all.slice(0, 8), hits: hits.slice(0, 8), typed: typed.length ? typed : [child] }
  library.set(child.id, lib)
  return lib
}

function SearchScene({ child }) {
  const [lib, setLib] = useState(library.get(child.id) ?? null)
  useEffect(() => {
    let live = true
    loadLibrary(child).then(
      (l) => live && setLib(l),
      () => live && setLib({ word: searchWord(child), all: [child], hits: [child], typed: [child] }),
    )
    return () => {
      live = false
    }
  }, [child])
  if (!lib) return <p className="fd-wait">Loading pieces from the library…</p>

  const target = lib.typed.find((p) => p.id === child.id) ?? lib.typed[0]
  const steps = [
    [300, { at: 'search' }],
    [650, { click: true, focus: true }],
    ...[...lib.word].map((_, i) => [110, { q: lib.word.slice(0, i + 1) }]),
    [350, { list: 'hits' }], // the Browser waits 150 ms after the last key, then shows the results
    [700, { at: `type-${target.tipo}` }],
    [650, { click: true, tipo: target.tipo, list: 'typed' }],
    [800, { at: 'play' }],
    [650, { click: true, playing: true }],
    [1700, { playing: false }],
    [250, { at: 'row' }],
    [700, { click: true, sel: true }],
  ]
  return (
    <Player initial={{ at: null, q: '', tipo: '', list: 'all', focus: false, playing: false, sel: false }} steps={steps}>
      {(s) => {
        const list = lib[s.list]
        const at = list.indexOf(target)
        const shown = list.slice(s.list === 'typed' ? Math.max(0, at - 1) : 0)
        return (
          <div className="fd-browser">
            <div className="fd-btools">
              <label className={`search ${s.focus ? 'focus' : ''}`} data-at="search">
                <Search size={12} />
                <span className={s.q ? 'fd-typed' : 'fd-ph'}>{s.q || 'Search pieces, authors, ids'}</span>
                {s.focus && <i className="fd-caret" />}
              </label>
              <div className="seg">
                {TYPES.map(([k, label]) => (
                  <button key={k} tabIndex={-1} data-at={`type-${k}`} className={s.tipo === k ? 'on' : ''}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="pieces">
              {shown.map((p) => {
                const it = p === target
                return (
                  <li key={p.id} className={`piece-row t-${p.tipo} ${it && s.sel ? 'sel' : ''}`}>
                    <button tabIndex={-1} className="piece-main" data-at={it ? 'row' : undefined}>
                      <span className="code">{p.id}</span>
                      <span className="piece-name">{p.nombre}</span>
                      <span className="piece-meta">
                        {p.autor} · {p.licencia} · {typeLabel(p.tipo)} · {p.tonalidad}
                      </span>
                    </button>
                    <button tabIndex={-1} className="icon" data-at={it ? 'play' : undefined}>
                      {it && s.playing ? <Square size={11} /> : <Play size={11} />}
                    </button>
                    <button tabIndex={-1} className="icon">
                      <Plus size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }}
    </Player>
  )
}

/* ---------- 2 Fork: someone else's piece is read-only; Fork to edit makes your copy ---------- */

function ForkScene({ child, yours }) {
  const copy = { ...yours, notas: child.notas } // a fork starts with exactly the same notes
  const steps = [
    [300, { at: 'preview' }],
    [650, { click: true, playing: true }],
    [2000, { playing: false }],
    [300, { at: 'fork' }],
    [700, { click: true, forked: true }],
  ]
  return (
    <Player initial={{ at: null, playing: false, forked: false }} steps={steps}>
      {(s) => {
        const piece = s.forked ? copy : child
        return (
          <RollPanel
            piece={piece}
            parent={s.forked ? child : null}
            tools={
              <>
                <Btn at="preview" on={s.playing}>
                  {s.playing ? <Square size={11} /> : <Play size={11} />} {s.playing ? 'Stop' : 'Preview'}
                </Btn>
                {s.forked ? (
                  <>
                    <Btn disabled>
                      <Save size={11} /> Saved
                    </Btn>
                    <Btn>
                      <GitCompare size={11} /> What changed?
                    </Btn>
                  </>
                ) : (
                  <Btn at="fork" accent>
                    <GitFork size={11} /> Fork to edit
                  </Btn>
                )}
              </>
            }
            foot={s.forked ? 'Click to add · drag notes to move' : `This piece belongs to ${child.autor}. Fork it to edit your own copy.`}
          >
            <Roll piece={child} items={piece.notas.map((n) => ({ n }))} playing={s.playing} />
          </RollPanel>
        )
      }}
    </Player>
  )
}

/* ---------- 3 Edit: click to add a note, drag a note to move it, save ---------- */

function EditScene({ child, yours, move, added }) {
  const from = child.notas[move]
  const to = yours.notas[move]
  const steps = [
    [300, { at: 'cell' }],
    [700, { click: true, added: true, dirty: true }],
    [800, { at: 'from' }],
    [650, { drag: true }],
    [80, { at: 'to', moved: true }],
    [750, { drag: false }],
    [500, { at: 'save' }],
    [700, { click: true, dirty: false }],
  ]
  return (
    <Player initial={{ at: null, added: false, moved: false, drag: false, dirty: false }} steps={steps}>
      {(s) => {
        const notes = child.notas.map((n, k) => ({ n: k === move && s.moved ? to : n, cls: k === move && (s.drag || s.moved) ? 'sel' : '' }))
        if (s.added) notes.push({ n: added, cls: 'pop' })
        return (
          <RollPanel
            piece={{ ...yours, notas: child.notas }}
            parent={child}
            tools={
              <>
                <Btn>
                  <Play size={11} /> Preview
                </Btn>
                <Btn at="save" disabled={!s.dirty}>
                  <Save size={11} /> {s.dirty ? 'Save' : 'Saved'}
                </Btn>
                <Btn>
                  <GitCompare size={11} /> What changed?
                </Btn>
              </>
            }
            foot="Click to add · drag notes to move"
          >
            <Roll
              piece={child}
              items={notes}
              marks={[
                { n: added, at: 'cell' },
                { n: from, at: 'from' },
                { n: to, at: 'to' },
              ]}
            />
          </RollPanel>
        )
      }}
    </Player>
  )
}

/* ---------- 4 Diff: "What changed?" colours the notes against the piece you forked ---------- */

function DiffScene({ child, yours }) {
  const d = useMemo(() => diffNotes(child.notas, yours.notas), [child, yours])
  const steps = [
    [300, { at: 'diff' }],
    [700, { click: true, diff: true }],
    [1300, { at: d.nuevas.length ? 'new' : d.movidas.length ? 'mov' : 'diff' }],
    [1300, { at: d.movidas.length ? 'mov' : 'diff' }],
  ]
  return (
    <Player initial={{ at: null, diff: false }} steps={steps}>
      {(s) => (
        <RollPanel
          piece={yours}
          parent={child}
          tools={
            <>
              <Btn>
                <Play size={11} /> Preview
              </Btn>
              <Btn disabled>
                <Save size={11} /> Saved
              </Btn>
              <Btn at="diff" on={s.diff}>
                <GitCompare size={11} /> {s.diff ? 'Exit diff' : 'What changed?'}
              </Btn>
            </>
          }
          foot={
            s.diff ? (
              <span className="legend">
                <i className="k-new" /> {d.nuevas.length} new <i className="k-del" /> {d.borradas.length} deleted <i className="k-mov" /> {d.movidas.length} moved{' '}
                <i className="k-same" /> {d.iguales.length} same
              </span>
            ) : (
              'Click to add · drag notes to move'
            )
          }
        >
          <Roll
            piece={child}
            items={
              s.diff
                ? [
                    ...d.iguales.map((n) => ({ n, cls: 'same' })),
                    ...d.borradas.map((n) => ({ n, cls: 'del' })),
                    ...d.nuevas.map((n, i) => ({ n, cls: 'new', at: i === 0 ? 'new' : undefined })),
                    ...d.movidas.map((m) => ({ n: m.antes, cls: 'was' })),
                    ...d.movidas.map((m, i) => ({ n: m.despues, cls: 'mov', at: i === 0 ? 'mov' : undefined })),
                  ]
                : yours.notas.map((n) => ({ n }))
            }
            lines={s.diff ? d.movidas.map((m) => [m.antes, m.despues]) : []}
          />
        </RollPanel>
      )}
    </Player>
  )
}

/* ---------- 5 Trace: History → Tree shows where every piece in the song comes from ---------- */

function TraceScene({ base, child, yours }) {
  const nodes = [base, child, yours].filter(Boolean)
  const authors = new Set(nodes.filter((p) => p.autor !== 'you').map((p) => p.autor))
  const steps = [
    [300, { at: 'history' }],
    [700, { click: true, open: true }],
    [1000, { at: 'you' }],
  ]
  return (
    <Player initial={{ at: null, open: false }} steps={steps}>
      {(s) =>
        s.open ? (
          <div className="fd-history">
            <nav className="hist-tabs">
              {['Tree', 'Changes', 'Versions', 'Merge', 'Credits'].map((t) => (
                <button key={t} tabIndex={-1} className={t === 'Tree' ? 'on' : ''}>
                  {t}
                </button>
              ))}
            </nav>
            <p className="fd-line fd-summary">
              This song has <b>1</b> piece drawing on <b>{authors.size}</b> {authors.size === 1 ? 'author' : 'authors'}. <b className="mine-text">1</b> piece is
              yours.
            </p>
            <div className="fd-tree">
              {nodes.map((p, i) => (
                <div key={p.id} className="fd-tree-step">
                  {i > 0 && <span className={`fd-edge ${p === yours ? 'mine' : ''}`} />}
                  <div className={`tree-node t-${p.tipo} ${p === yours ? 'mine' : 'ancestor'}`} data-at={p === yours ? 'you' : undefined}>
                    <div className="tree-head">
                      <span className="code">{p.id}</span> {typeLabel(p.tipo)}
                    </div>
                    <span className="fd-node-line">
                      <strong>{p.nombre}</strong> <span className="tree-meta">· {p.autor} · {p.licencia}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="fd-studio">
            <div className="fd-bar">
              <b>Untitled project</b>
              <Btn at="history">
                <GitBranch size={12} /> History
              </Btn>
            </div>
            <div className="fd-line fd-rtitle">Playlist</div>
            <div className="fd-lane">
              <div className={`clip t-${yours.tipo} mine`}>
                <span className="clip-head">
                  <span className="clip-name">{yours.nombre}</span>
                </span>
                <MiniNotes notas={yours.notas} beats={yours.compases * 4} />
              </div>
            </div>
          </div>
        )
      }
    </Player>
  )
}

const SCENES = { Search: SearchScene, Fork: ForkScene, Edit: EditScene, Diff: DiffScene, Trace: TraceScene }
