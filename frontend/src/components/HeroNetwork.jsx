import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/*
 * Landing hero: music pieces are added one by one, each forked from an earlier one, growing to the right like
 * the origin tree. As the tree grows the camera zooms out, the clips shrink into nodes and the tree turns into a
 * network, with lights (ideas) travelling along the links from node to node.
 *
 * Drawn on a canvas from a seeded generator: no network request, so it starts on the first frame.
 *
 * `background`: the canvas covers the whole landing page behind its content (fixed to the window, never takes
 * clicks), the first pieces grow on the right, away from the hero text, and the network then spreads over the
 * whole screen. The captions stay in the hero.
 *
 * Once the network is complete it lives for REPLAY_AFTER seconds, fades out and the story starts again from the
 * first piece, over and over while the component is on screen (not with reduced motion: that one stays still).
 */

const COUNT = 150 // pieces in the full network
const REPLAY_AFTER = 40 // seconds the finished network lives before the story starts again (forever, while shown)
const FADE = 1.2 // seconds of fade out / fade in between two runs
const BW = 1 // clip width (world units)
const BH = 0.42 // clip height
const DX = 1.5 // distance between columns (one fork to the right)
const ROW = 0.62 // minimum vertical gap between clips in a column
const MAX_DEPTH = 13
const TYPES = ['acordes', 'ritmo', 'bajo', 'melodia']

const CAPTIONS = ['Start with one piece.', 'Fork it. Change it. Fork it again.', 'Every idea stays connected to where it came from.']

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Short note pattern for a clip, like the mini notes of a Playlist clip (x, y, w in 0..1 of the clip body). */
function notesFor(type, r) {
  const n = type === 'ritmo' ? 8 : type === 'bajo' ? 4 : 6
  const notes = []
  for (let i = 0; i < n; i++) {
    if (type !== 'bajo' && r() < 0.18) continue
    const w = type === 'bajo' ? 0.85 / n : type === 'acordes' ? 0.6 / n : 0.45 / n
    const y = type === 'ritmo' ? [0.75, 0.3, 0.55][i % 3] : 0.15 + r() * 0.7
    notes.push({ x: (i + 0.05) / n, y, w })
    if (type === 'acordes') notes.push({ x: (i + 0.05) / n, y: Math.max(0.08, y - 0.25), w })
  }
  return notes
}

/** The whole network, in birth order: a tree of forks plus "synapses" between nearby pieces. */
function build(seed = 7) {
  const r = random(seed)
  const nodes = []
  const columns = new Map() // depth -> [y]
  const free = (depth, y) => (columns.get(depth) ?? []).every((yy) => Math.abs(yy - y) >= ROW * 0.98)
  const add = (parent, depth, y, type) => {
    const node = { i: nodes.length, parent, depth, x: depth * DX, y, type, mine: nodes.length > 3 && r() < 0.13, notes: notesFor(type, r), kids: 0, edges: [], jx: r() - 0.5, jy: r() - 0.5 }
    nodes.push(node)
    columns.set(depth, [...(columns.get(depth) ?? []), y])
    if (parent) parent.kids++
    return node
  }
  add(null, 0, 0, 'acordes')
  let guard = 0
  while (nodes.length < COUNT && guard++ < 20000) {
    const n = nodes.length
    // The first pieces form a line to the right; then forks branch off, mostly from recent pieces.
    const parent = n < 4 ? nodes[n - 1] : nodes[Math.floor(n * (1 - r() ** 1.6))]
    if (parent.depth >= MAX_DEPTH || parent.kids >= 3) continue
    const depth = parent.depth + 1
    const sign = r() < 0.5 ? 1 : -1
    const offsets = parent.kids === 0 && n < 4 ? [0] : [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2].map((k) => k * sign)
    const y = offsets.map((k) => parent.y + k * ROW * 1.15).find((yy) => free(depth, yy))
    if (y === undefined) continue
    add(parent, depth, y, r() < 0.6 ? parent.type : TYPES[Math.floor(r() * 4)])
  }

  const edges = []
  const link = (a, b, kind) => {
    const e = { a, b, kind, birth: Math.max(a.i, b.i) }
    edges.push(e)
    a.edges.push(e)
    b.edges.push(e)
  }
  for (const node of nodes) if (node.parent) link(node.parent, node, 'tree')
  // Synapses: each piece also connects to its nearest pieces, which turns the tree into a network.
  for (const a of nodes) {
    const near = nodes
      .filter((b) => b !== a && b.parent !== a && a.parent !== b)
      .map((b) => [b, Math.hypot(b.x - a.x, b.y - a.y)])
      .filter(([, d]) => d < DX * 1.9)
      .sort((p, q) => p[1] - q[1])
      .slice(0, 3)
    for (const [b] of near) if (!a.edges.some((e) => e.a === b || e.b === b)) link(a, b, 'syn')
  }
  return { nodes, edges }
}

/** Time (s) between one piece and the next: slow at first, then faster and faster. */
const gap = (i) => (i < 4 ? 1.0 : Math.max(0.035, 0.85 * 0.86 ** (i - 3)))

function glowSprite(color) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.18, color)
  grad.addColorStop(1, 'transparent')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

export function HeroNetwork({ background = false }) {
  const canvasRef = useRef(null)
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback
    const color = {
      ritmo: token('--t-ritmo', '#d2766e'),
      acordes: token('--t-acordes', '#72a6d2'),
      bajo: token('--t-bajo', '#a98bd6'),
      melodia: token('--t-melodia', '#6cbca1'),
      mine: token('--orange', '#ff9a1f'),
      well: token('--well', '#2a3034'),
      line: '#8a979e',
    }
    const sprites = Object.fromEntries(Object.entries(color).map(([k, v]) => [k, glowSprite(v)]))
    const tint = (n) => (n.mine ? 'mine' : n.type)

    const { nodes, edges } = build()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0
    let H = 0
    let dpr = 1
    const cam = { x: BW / 2, y: 0, s: 0 }
    let t = 0
    let born = 0
    let nextBirth = 0
    let pulses = []
    let last = performance.now()
    let raf = 0
    let visible = true
    let shownStage = 0
    let doneAt = null // story time when the last piece was born
    let fading = null // real time (ms) when the fade out started

    // Largest clip size, and where the tree sits on screen (fx, fy: share of the width / height; pad: margin).
    // As a background it starts small and on the right of the hero text, then spreads over the whole window.
    const maxScale = () => (background ? Math.min(W * 0.12, 160) : W * 0.36) / BW
    // 0 = clips, 1 = network, from the size of a clip on screen (relative to the window when it is the background).
    const netFactor = (scale) => (background ? smooth(W * 0.09, W * 0.05, BW * scale) : smooth(80, 24, BW * scale))
    // Wide screens: above the captions, right of the hero text. Narrow ones (stacked hero): under the hero text.
    const focus = (nf) => {
      if (!background) return { fx: 0.5, fy: 0.5, pad: 0.14 }
      const early = 1 - nf
      return W >= 900 ? { fx: 0.5 + 0.2 * early, fy: 0.5 - 0.14 * early, pad: 0.12 - 0.08 * nf } : { fx: 0.5, fy: 0.5 + 0.18 * early, pad: 0.12 - 0.08 * nf }
    }

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, background ? 1.5 : 2)
      W = box.width
      H = box.height
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      if (!cam.s) placeCamera()
    }
    function placeCamera() {
      cam.s = maxScale()
      const { fx, fy } = focus(0)
      cam.x = BW / 2 - ((fx - 0.5) * W) / cam.s
      cam.y = -((fy - 0.5) * H) / cam.s
    }

    // Start the story again: no pieces, no ideas, the camera back on the first piece.
    const restart = () => {
      t = 0
      born = 0
      nextBirth = 0
      pulses = []
      doneAt = null
      for (const n of nodes) {
        n.born = undefined
        n.flash = 0
      }
      placeCamera()
      step(0, 0)
      nodes[0].born = -1 // the first piece is there on the very first frame
    }

    // Where a link starts and ends: clip edges while they are clips, node centres once they are a network.
    const anchors = (e, nf) => {
      const open = (BW / 2) * (1 - nf)
      const left = e.a.px <= e.b.px ? e.a : e.b
      const right = left === e.a ? e.b : e.a
      return [left.px + BW / 2 + (e.kind === 'tree' ? open : 0), left.py, right.px + BW / 2 - (e.kind === 'tree' ? open : 0), right.py, left]
    }
    const point = (x1, y1, x2, y2, k) => {
      // Cubic curve with horizontal tangents (like the origin tree's links).
      const mx = (x1 + x2) / 2
      const u = 1 - k
      return [u * u * u * x1 + 3 * u * u * k * mx + 3 * u * k * k * mx + k * k * k * x2, u * u * u * y1 + 3 * u * u * k * y1 + 3 * u * k * k * y2 + k * k * k * y2]
    }

    const send = (edge, from, speed = 1) => {
      if (pulses.length > 90) return
      const to = edge.a === from ? edge.b : edge.a
      const len = Math.hypot(edge.a.x - edge.b.x, edge.a.y - edge.b.y)
      pulses.push({ edge, from, to, k: 0, dur: (0.35 + len * 0.22) / speed })
    }

    const birth = (node) => {
      node.born = t
      node.flash = 0
      if (node.parent) send(node.edges.find((e) => e.kind === 'tree' && (e.a === node.parent || e.b === node.parent)), node.parent, 1.6)
    }

    const step = (dt, nf) => {
      t += dt
      while (born < COUNT && t >= nextBirth) {
        birth(nodes[born])
        born++
        nextBirth += gap(born)
        if (born === COUNT) doneAt = t
      }
      // Ideas: more of them as the network appears; when one reaches a node it lights it and may go on.
      if (Math.random() < dt * nf * 14 && born > 3) {
        const n = nodes[Math.floor(Math.random() * born)]
        const options = n.edges.filter((e) => e.birth < born)
        if (options.length) send(options[Math.floor(Math.random() * options.length)], n)
      }
      const arrived = []
      pulses = pulses.filter((p) => {
        p.k += dt / p.dur
        if (p.k < 1) return true
        arrived.push(p)
        return false
      })
      for (const p of arrived) {
        p.to.flash = 1
        if (Math.random() > 0.15 + nf * 0.5) continue
        const options = p.to.edges.filter((e) => e !== p.edge && e.birth < born)
        if (options.length) send(options[Math.floor(Math.random() * options.length)], p.to)
      }
      for (let i = 0; i < born; i++) nodes[i].flash = (nodes[i].flash ?? 0) * Math.exp(-dt * 2.6)

      // Camera: keep every piece in view, zooming out as the tree grows; then drift slowly.
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (let i = 0; i < born; i++) {
        const n = nodes[i]
        x0 = Math.min(x0, n.x)
        x1 = Math.max(x1, n.x + BW)
        y0 = Math.min(y0, n.y - BH / 2)
        y1 = Math.max(y1, n.y + BH / 2)
      }
      if (born) {
        const { fx, fy, pad } = focus(nf)
        const breathe = 1 + 0.025 * Math.sin(t * 0.25) * nf
        const roomW = W * 2 * Math.min(fx, 1 - fx) // the room around the focus point
        const roomH = H * 2 * Math.min(fy, 1 - fy)
        const s = Math.min((roomW * (1 - 2 * pad)) / (x1 - x0), (roomH * (1 - 2 * pad - 0.06)) / (y1 - y0), maxScale()) * breathe
        const ease = 1 - Math.exp(-dt * 1.6)
        cam.s += (s - cam.s) * ease
        const tx = (x0 + x1) / 2 + Math.sin(t * 0.11) * 0.25 * nf - ((fx - 0.5) * W) / cam.s
        const ty = (y0 + y1) / 2 - (H * 0.03) / cam.s + Math.cos(t * 0.09) * 0.2 * nf - ((fy - 0.5) * H) / cam.s
        cam.x += (tx - cam.x) * ease
        cam.y += (ty - cam.y) * ease
      }
    }

    const draw = () => {
      const s = cam.s
      const nf = netFactor(s)
      const X = (x) => (x - cam.x) * s + W / 2
      const Y = (y) => (y - cam.y) * s + H / 2
      // As a network the nodes leave their columns and float a little, so it reads as neurons, not a grid.
      for (let i = 0; i < born; i++) {
        const n = nodes[i]
        n.px = n.x + nf * (n.jx * 0.8 + Math.sin(t * 0.5 + i) * 0.07)
        n.py = n.y + nf * (n.jy * 0.55 + Math.cos(t * 0.41 + i * 1.3) * 0.07)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = color.well
      ctx.fillRect(0, 0, W, H)
      const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.75)
      vignette.addColorStop(0, `rgba(114,166,210,${0.06 * nf})`)
      vignette.addColorStop(1, 'rgba(0,0,0,0.35)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, W, H)

      // Playlist-style bar lines while the pieces are still clips.
      if (nf < 1) {
        ctx.strokeStyle = `rgba(68,77,83,${0.9 * (1 - nf)})`
        ctx.lineWidth = 1
        for (let c = Math.floor((cam.x - W / 2 / s) / DX) - 1; c * DX < cam.x + W / 2 / s + DX; c++) {
          const x = Math.round(X(c * DX - (DX - BW) / 2)) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, H)
          ctx.stroke()
        }
      }

      // Links.
      for (const e of edges) {
        if (e.birth >= born) continue
        const appear = smooth(0, 0.45, t - nodes[e.birth].born)
        const alpha = e.kind === 'tree' ? 0.75 - 0.45 * nf : 0.2 * nf
        if (alpha * appear < 0.01) continue
        const [x1, y1, x2, y2] = anchors(e, nf)
        ctx.globalCompositeOperation = nf > 0.5 ? 'lighter' : 'source-over'
        ctx.strokeStyle = e.kind === 'tree' && nf < 0.5 ? color.line : color[tint(e.b)]
        ctx.globalAlpha = alpha * appear
        ctx.lineWidth = e.kind === 'tree' ? 1.5 - 0.6 * nf : 0.8
        ctx.setLineDash(e.kind === 'tree' && nf < 0.5 && e.b.mine ? [4, 3] : [])
        ctx.beginPath()
        ctx.moveTo(X(x1), Y(y1))
        const mx = X((x1 + x2) / 2)
        ctx.bezierCurveTo(mx, Y(y1), mx, Y(y2), X(x2), Y(y2))
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // Pieces: clips that fade into glowing nodes.
      for (let i = 0; i < born; i++) {
        const n = nodes[i]
        const a = smooth(0, 0.45, t - n.born)
        const from = n.parent ?? n
        const nx = from.px + (n.px - from.px) * a
        const ny = from.py + (n.py - from.py) * a
        const c = color[tint(n)]
        if (nf < 1) {
          const w = BW * s
          const h = BH * s
          const x = X(nx)
          const y = Y(ny) - h / 2
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = a * (1 - nf)
          ctx.fillStyle = color.well
          ctx.fillRect(x, y, w, h)
          ctx.globalAlpha = a * (1 - nf) * 0.32
          ctx.fillStyle = c
          ctx.fillRect(x, y, w, h)
          ctx.globalAlpha = a * (1 - nf)
          const head = Math.max(2, h * 0.24)
          ctx.fillRect(x, y, w, head)
          const body = h - head
          for (const note of n.notes) ctx.fillRect(x + note.x * w, y + head + 2 + note.y * (body - 6), Math.max(1, note.w * w), Math.max(1, body * 0.1))
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'
          ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
        }
        if (nf > 0) {
          const r = Math.min(3.2, Math.max(1.6, BH * s * 0.3))
          const glow = r * (4 + 5 * n.flash)
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a * nf * (0.2 + 0.6 * n.flash)
          ctx.drawImage(sprites[tint(n)], X(nx + BW / 2) - glow, Y(ny) - glow, glow * 2, glow * 2)
          ctx.globalAlpha = a * nf
          ctx.fillStyle = c
          ctx.beginPath()
          ctx.arc(X(nx + BW / 2), Y(ny), r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Ideas travelling along the links.
      ctx.globalCompositeOperation = 'lighter'
      for (const p of pulses) {
        const [x1, y1, x2, y2, left] = anchors(p.edge, nf)
        const forward = left === p.from
        const sprite = sprites[tint(p.to)]
        for (let k = 0; k < 4; k++) {
          const kk = Math.max(0, p.k - k * 0.035)
          const [px, py] = point(x1, y1, x2, y2, forward ? kk : 1 - kk)
          const size = (6 + 3 * nf) * (1 - k * 0.22)
          ctx.globalAlpha = 0.9 - k * 0.22
          ctx.drawImage(sprite, X(px) - size, Y(py) - size, size * 2, size * 2)
        }
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      const nextStage = born < 3 ? 0 : nf < 0.6 ? 1 : 2
      if (nextStage !== shownStage) setStage((shownStage = nextStage))
    }

    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Replay: REPLAY_AFTER seconds after the network is complete, fade out, start over, fade back in.
      if (doneAt !== null && fading === null && t - doneAt >= REPLAY_AFTER) {
        fading = now
        canvas.style.opacity = '0'
      }
      if (fading !== null && now - fading >= FADE * 1000) {
        fading = null
        restart()
        canvas.style.opacity = ''
      }
      step(dt, netFactor(cam.s))
      draw()
      raf = visible ? requestAnimationFrame(loop) : 0
    }

    resize()
    if (still) {
      // Reduced motion: the finished network, lit, without movement.
      born = COUNT
      t = 60
      for (const n of nodes) {
        n.born = 0
        n.flash = Math.random() < 0.25 ? 0.6 : 0
      }
      for (let i = 0; i < 200; i++) step(0.05, 1)
      pulses = []
      draw()
    } else {
      canvas.style.transition = `opacity ${FADE}s ease`
      step(0, 0)
      nodes[0].born = -1 // the first piece is there on the very first frame
      draw()
      raf = requestAnimationFrame(loop)
    }

    const sized = new ResizeObserver(() => {
      resize()
      if (still || !raf) draw()
    })
    sized.observe(canvas)
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && !still && !raf) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    })
    seen.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      sized.disconnect()
      seen.disconnect()
    }
  }, [background])

  if (background) {
    return (
      <>
        {createPortal(<canvas ref={canvasRef} className="bg-net" aria-hidden="true" />, document.body)}
        <div className="hero-live" aria-live="polite">
          <p key={stage} className="hero-net-cap">
            {CAPTIONS[stage]}
          </p>
          <span className="hero-steps" aria-hidden="true">
            {CAPTIONS.map((_, i) => (
              <i key={i} className={i <= stage ? 'on' : ''} />
            ))}
          </span>
        </div>
      </>
    )
  }

  return (
    <figure className="hero-net panel">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Music pieces are added one by one, each forked from an earlier one, then the view zooms out into a network of connected ideas with lights travelling between them."
      />
      <figcaption key={stage} className="hero-net-cap">
        {CAPTIONS[stage]}
      </figcaption>
    </figure>
  )
}
