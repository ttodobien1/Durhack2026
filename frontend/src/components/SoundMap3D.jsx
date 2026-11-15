import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

// 3D sound map (three.js): one sphere per piece at its first three fingerprint components (backend lib/fingerprint.js).
// Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to pan. The page keeps the selection, search and
// panels; this component only draws and reports hover / click.

const S = 5 // half size of the cube the points are fitted into
const R = 0.11 // dot radius
const AXES = [
  ['x', '#d2766e', new THREE.Vector3(1, 0, 0)],
  ['y', '#6cbca1', new THREE.Vector3(0, 1, 0)],
  ['z', '#72a6d2', new THREE.Vector3(0, 0, 1)],
]
const HOME = new THREE.Vector3(S * 2.1, S * 1.35, S * 2.5)
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Bounds from the 2nd-98th percentiles, so a few far-out pieces do not squash everyone else together. */
function bounds(values) {
  const v = [...values].sort((a, b) => a - b)
  const lo = v[Math.floor(v.length * 0.02)] ?? 0
  const hi = v[Math.ceil(v.length * 0.98) - 1] ?? 1
  return hi - lo > 1e-9 ? [lo, hi] : [lo - 1, hi + 1]
}

/** Piece -> position inside the cube (each axis stretched to fill it, far-out pieces kept on its faces). */
function layout(points) {
  const fit = (key) => {
    const [lo, hi] = bounds(points.map((p) => p[key] ?? 0))
    return (v) => THREE.MathUtils.clamp((((v ?? 0) - lo) / (hi - lo)) * 2 - 1, -1.04, 1.04) * S * 0.92
  }
  const [fx, fy, fz] = ['x', 'y', 'z'].map(fit)
  return points.map((p) => new THREE.Vector3(fx(p.x), fy(p.y), fz(p.z)))
}

/**
 * props: points [{ id, x, y, z, ... }], axes [{ menos, mas }] x3, colorOf(p) -> css colour, selId, nearIds, matches
 * (Set of ids or null), onHover(p | null, { x, y, w }), onSelect(id), onAutoRotate(on) when a drag stops the turning. ref: { reset(), setAutoRotate(on) }.
 */
export function SoundMap3D({ ref, points, axes, colorOf, selId, nearIds, matches, onHover, onSelect, onAutoRotate }) {
  const box = useRef(null)
  const world = useRef(null) // three.js objects that live as long as the component
  const latest = useRef({}) // newest props, for the pointer handlers set up once below
  useLayoutEffect(() => {
    latest.current = { points, onHover, onSelect, onAutoRotate }
  })

  useImperativeHandle(ref, () => ({
    reset: () => world.current?.reset(),
    setAutoRotate: (on) => world.current?.setAutoRotate(on),
  }))

  // Renderer, camera, controls, frame: built once.
  useEffect(() => {
    const el = box.current
    const css = getComputedStyle(el)
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setClearColor(token('--well', '#2a3034'))
    el.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer()
    labels.domElement.className = 'sm3-labels'
    el.appendChild(labels.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(token('--well', '#2a3034'), S * 3.2, S * 7)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
    camera.position.copy(HOME)
    scene.add(new THREE.HemisphereLight('#ffffff', '#30383d', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.4)
    sun.position.set(6, 10, 8)
    scene.add(sun)

    // Frame: cube edges, a floor grid, and the three axes through the middle with their meaning at both ends.
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * S, 2 * S, 2 * S)), new THREE.LineBasicMaterial({ color: '#3d464c' }))
    scene.add(edges)
    const grid = new THREE.GridHelper(2 * S, 10, '#3a4348', '#323a3f')
    grid.position.y = -S
    scene.add(grid)
    const axisLabels = []
    for (const [name, color, dir] of AXES) {
      const geo = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-S), dir.clone().multiplyScalar(S)])
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })))
      for (const sign of [-1, 1]) {
        const div = document.createElement('div')
        div.className = `sm3-axis ax-${name}`
        const label = new CSS2DObject(div)
        label.position.copy(dir).multiplyScalar(sign * S * 1.08)
        scene.add(label)
        axisLabels.push({ name, sign, div })
      }
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = S * 0.5
    controls.maxDistance = S * 6
    controls.autoRotate = !reduced()
    controls.autoRotateSpeed = 0.7
    controls.addEventListener('start', () => {
      if (controls.autoRotate) {
        controls.autoRotate = false
        latest.current.onAutoRotate?.(false)
      }
    })

    // Dots (rebuilt when the pieces change), the selection halo, its drop line to the floor, and lines to its nearest.
    const sphere = new THREE.SphereGeometry(1, 18, 12)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 })
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.35 }))
    halo.visible = false
    scene.add(halo)
    const drop = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.15, gapSize: 0.12, transparent: true, opacity: 0.4 }))
    drop.visible = false
    scene.add(drop)
    const links = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.2, gapSize: 0.14, transparent: true, opacity: 0.75 }))
    scene.add(links)

    const w = {
      mesh: null,
      pos: [], // Vector3 per piece, same order as points
      index: new Map(), // id -> i
      hovered: -1,
      target: null, // animated look-at point after a selection
    }

    w.setPoints = (list) => {
      if (w.mesh) {
        scene.remove(w.mesh)
        w.mesh.dispose()
      }
      w.pos = layout(list)
      w.index = new Map(list.map((p, i) => [p.id, i]))
      w.hovered = -1
      w.mesh = list.length ? new THREE.InstancedMesh(sphere, material, list.length) : null
      if (w.mesh) scene.add(w.mesh)
    }

    w.setAxes = (ax) => {
      for (const { name, sign, div } of axisLabels) {
        const a = ax?.['xyz'.indexOf(name)]
        const words = a ? (sign < 0 ? a.menos : a.mas) : []
        div.replaceChildren()
        if (words?.length) {
          const tag = document.createElement('b')
          tag.textContent = `${sign < 0 ? '−' : '+'}${name}`
          const text = document.createElement('span')
          text.textContent = ` ${words.join(' · ')}`
          div.append(tag, text)
        }
        div.style.display = words?.length ? '' : 'none'
      }
    }

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const color = new THREE.Color()
    const bg = new THREE.Color(token('--well', '#2a3034'))
    w.paint = ({ list, colorOf, selId, nearIds, matches }) => {
      if (!w.mesh) return
      const near = new Set(nearIds)
      list.forEach((p, i) => {
        const dim = matches && !matches.has(p.id)
        const r = p.id === selId ? R * 2.1 : i === w.hovered ? R * 1.7 : (matches && !dim) || near.has(p.id) ? R * 1.45 : dim ? R * 0.7 : R
        m.compose(w.pos[i], q, scale.setScalar(r))
        w.mesh.setMatrixAt(i, m)
        color.set(colorOf(p))
        if (dim) color.lerp(bg, 0.8)
        if (p.id === selId || i === w.hovered) color.lerp(new THREE.Color('#ffffff'), 0.25)
        w.mesh.setColorAt(i, color)
      })
      w.mesh.instanceMatrix.needsUpdate = true
      if (w.mesh.instanceColor) w.mesh.instanceColor.needsUpdate = true
      w.mesh.computeBoundingSphere()

      const s = w.index.get(selId)
      halo.visible = drop.visible = s != null
      if (s != null) {
        const p = w.pos[s]
        halo.position.copy(p)
        halo.scale.setScalar(R * 3.6)
        drop.geometry.setFromPoints([p, new THREE.Vector3(p.x, -S, p.z)])
        drop.computeLineDistances()
      }
      const seg = []
      if (s != null) for (const id of nearIds) if (w.index.has(id)) seg.push(w.pos[s], w.pos[w.index.get(id)])
      links.geometry.setFromPoints(seg)
      links.computeLineDistances()
    }

    w.focus = (id) => {
      const i = w.index.get(id)
      if (i == null) return
      if (reduced()) controls.target.copy(w.pos[i])
      else w.target = w.pos[i].clone()
    }
    w.reset = () => {
      w.target = null
      controls.target.set(0, 0, 0)
      camera.position.copy(HOME)
      controls.update()
    }
    w.setAutoRotate = (on) => {
      controls.autoRotate = on && !reduced()
    }

    // Hover and click: raycast against the dots. A press that moves more than a few pixels is a drag, not a click.
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pick = (e) => {
      if (!w.mesh) return -1
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray.intersectObject(w.mesh)[0]?.instanceId ?? -1
    }
    let down = null
    const onMove = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.drag = true
      if (e.buttons) return
      const i = pick(e)
      if (i === w.hovered) return
      w.hovered = i
      renderer.domElement.style.cursor = i >= 0 ? 'pointer' : ''
      const rect = el.getBoundingClientRect()
      latest.current.onHover?.(i >= 0 ? latest.current.points[i] : null, { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width })
    }
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY, drag: false }
    }
    const onUp = (e) => {
      const click = down && !down.drag
      down = null
      if (!click) return
      const i = pick(e)
      if (i >= 0) latest.current.onSelect?.(latest.current.points[i].id)
    }
    const onLeave = () => {
      if (w.hovered < 0) return
      w.hovered = -1
      latest.current.onHover?.(null, null)
    }
    const canvas = renderer.domElement
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    const resize = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      labels.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // Draw only while the map is on screen.
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(el)
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!visible || document.hidden) return
      if (w.target) {
        const step = w.target.clone().sub(controls.target).multiplyScalar(0.12)
        controls.target.add(step)
        camera.position.add(step)
        if (step.lengthSq() < 1e-6) w.target = null
      }
      controls.update()
      renderer.render(scene, camera)
      labels.render(scene, camera)
    }
    tick()

    world.current = w
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      w.mesh?.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      sphere.dispose()
      material.dispose()
      renderer.dispose()
      canvas.remove()
      labels.domElement.remove()
      world.current = null
    }
  }, [])

  useEffect(() => {
    world.current?.setPoints(points ?? [])
  }, [points])
  useEffect(() => {
    world.current?.setAxes(axes)
  }, [axes])
  useEffect(() => {
    world.current?.paint({ list: points ?? [], colorOf, selId, nearIds: nearIds ?? [], matches })
  })
  useEffect(() => {
    if (selId) world.current?.focus(selId)
  }, [selId, points])

  return <div className="sm3" ref={box} />
}
