// Movable split between the Playlist (top) and the piano roll (bottom) of the project page, like VS Code's panel:
// drag the ↕ handle (or the strip between both panels) up to give the piano roll the whole column, or down until
// only its title bar is left; double-click toggles maximized / normal. Remembered in this browser.
import { useEffect, useRef, useState } from 'react'

const KEY = 'stemma-split'
const DEFAULT = 40 // Playlist share of the column, %
const MIN_TOP = 26 // px: the Playlist keeps its title bar
const MIN_BOTTOM = 26 // px: the piano roll keeps its title bar (with the handle)
const SPLITTER = 6 // px: the strip between both panels
const SNAP = 12 // px from an edge that snap to it

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    return v && typeof v.split === 'number' ? v : null
  } catch {
    return null // storage blocked or corrupt
  }
}

const isNormal = (v) => v > 0 && v < 100

/**
 * Returns { ref (on the column), style (--split for the CSS grid), className, handleProps (the ↕ handle: drag,
 * double-click, keyboard), stripProps (the strip between the panels: drag and double-click), maximized, collapsed }.
 * split: Playlist share in %; 0 = piano roll maximized, 100 = piano roll down to its title bar.
 */
export function usePaneSplit() {
  const [split, setSplit] = useState(() => read()?.split ?? DEFAULT)
  const [normal, setNormal] = useState(() => read()?.normal ?? DEFAULT) // size to go back to from maximized
  const [dragging, setDragging] = useState(false)
  const ref = useRef(null)
  const drag = useRef(null) // { y, top, height, moved }
  const lastTap = useRef(-1e9) // time of the last click that was not a drag (double-click / double-tap)

  useEffect(() => {
    if (dragging) return // write once, when the drag ends
    try {
      localStorage.setItem(KEY, JSON.stringify({ split, normal }))
    } catch {
      /* storage blocked: the size lasts for this visit */
    }
  }, [split, normal, dragging])

  const settle = (v) => {
    setSplit(v)
    if (isNormal(v)) setNormal(v)
  }
  // Playlist height in px -> split %, snapping to both ends.
  const toSplit = (top, height) => {
    if (top < MIN_TOP + SNAP) return 0
    if (height - top - SPLITTER < MIN_BOTTOM + SNAP) return 100
    return Math.round((top / height) * 1000) / 10
  }

  const onPointerDown = (e) => {
    if (e.button !== 0 || !ref.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const column = ref.current.getBoundingClientRect()
    const top = ref.current.firstElementChild.getBoundingClientRect().height // what the Playlist really takes now
    drag.current = { y: e.clientY, top, height: column.height, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dy) < 3) return // a click (or a double-click) is not a drag
    d.moved = true
    setSplit(toSplit(d.top + dy, d.height))
  }
  const onPointerUp = (e) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDragging(false)
    if (d.moved) return settle(toSplit(d.top + e.clientY - d.y, d.height))
    // Two clicks (or taps) in a row without dragging: toggle maximized / normal.
    if (e.type === 'pointerup' && e.timeStamp - lastTap.current < 350) {
      lastTap.current = -1e9
      toggle()
    } else lastTap.current = e.timeStamp
  }
  const toggle = () => {
    if (split === 0) setSplit(isNormal(normal) ? normal : DEFAULT)
    else {
      if (isNormal(split)) setNormal(split)
      setSplit(0)
    }
  }
  const onKeyDown = (e) => {
    const step = { ArrowUp: -5, ArrowDown: 5 }[e.key]
    if (step) settle(Math.min(100, Math.max(0, split + step)))
    else if (e.key === 'Home') setSplit(0)
    else if (e.key === 'End') setSplit(100)
    else if (e.key === 'Enter' || e.key === ' ') toggle()
    else return
    e.preventDefault()
  }

  const pointer = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
  const hint = `Drag to resize the piano roll · double-click to ${split === 0 ? 'restore its size' : 'maximize it'}`
  return {
    ref,
    style: { '--split': `${split}%` },
    className: dragging ? 'resizing' : '',
    maximized: split === 0,
    collapsed: split === 100,
    handleProps: {
      ...pointer,
      onKeyDown,
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'horizontal',
      'aria-label': 'Resize the piano roll (arrow keys, Home to maximize, End to minimize, Enter to toggle)',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.round(100 - split),
      title: hint,
    },
    stripProps: { ...pointer, 'aria-hidden': true, title: hint },
  }
}
