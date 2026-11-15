// Mock backend that follows CLAUDE.md §4. Used automatically when the real API is unreachable.
// shortcut: hand-written demo pieces, replace with role C's seeds from /data once the backend serves them.
import { diffNotes } from './diff.js'

const note = (tono, inicio, duracion = 0.5, velocidad = 0.8) => ({ tono, inicio, duracion, velocidad })

// Voicings: low, middle pair, top. Am Dm E7 Am in La menor.
const AM = { low: 57, mid: [60, 64], top: 69 }
const DM = { low: 62, mid: [65, 69], top: 74 }
const E7 = { low: 56, mid: [62, 64], top: 68 }
const GM = { low: 55, mid: [58, 62], top: 67 }
const A7 = { low: 57, mid: [61, 64], top: 67 }

// Straight block chords on every beat.
const blockComping = (chords) =>
  chords.flatMap((c, bar) =>
    [0, 1, 2, 3].flatMap((b) => [c.low, ...c.mid, c.top].map((t) => note(t, bar * 4 + b, 0.5, 0.65))),
  )

// Guajeo: octaves on the downbeats, inner voices on the offbeats, anticipating the next chord on 4&.
const guajeo = (chords) =>
  chords.flatMap((c, bar) => {
    const s = bar * 4
    const next = chords[(bar + 1) % chords.length]
    return [
      note(c.low, s, 0.5, 0.85), note(c.top, s, 0.5, 0.85),
      ...c.mid.map((t) => note(t, s + 0.5, 0.5, 0.6)),
      note(c.low, s + 1.5, 0.5, 0.8), note(c.top, s + 1.5, 0.5, 0.8),
      ...c.mid.map((t) => note(t, s + 2, 0.5, 0.6)),
      note(c.low, s + 2.5, 0.5, 0.8), note(c.top, s + 2.5, 0.5, 0.8),
      ...next.mid.map((t) => note(t, s + 3.5, 0.5, 0.7)),
    ]
  })

// Tumbao: fifth on 2&, next root anticipated on 4.
const tumbao = (roots) =>
  roots.flatMap(([root, fifth], bar) => {
    const s = bar * 4
    const nextRoot = roots[(bar + 1) % roots.length][0]
    return [...(bar === 0 ? [note(root, s, 1.5, 0.9)] : []), note(fifth, s + 1.5, 1.5, 0.85), note(nextRoot, s + 3, 1, 0.9)]
  })

const clave23 = [1, 2, 4, 5.5, 7].map((b) => note(75, b, 0.25, 0.9))

const congas = [0, 4].flatMap((s) => [
  note(64, s, 0.25, 0.45), note(62, s + 1, 0.25, 0.75), note(64, s + 2, 0.25, 0.45),
  note(63, s + 3, 0.25, 0.9), note(63, s + 3.5, 0.25, 0.9),
  ...[0, 1, 2, 3].map((b) => note(56, s + b, 0.25, b === 0 ? 0.6 : 0.4)),
])

const coro = [
  note(76, 0, 1.5), note(74, 1.5), note(72, 2, 1), note(71, 3, 1),
  note(69, 4, 1.5), note(72, 5.5), note(74, 6, 2),
  note(71, 8, 1.5), note(68, 9.5), note(71, 10, 1), note(74, 11, 1),
  note(72, 12, 1), note(71, 13), note(69, 13.5, 2.5),
]
const pregon = coro.map((n) =>
  n.inicio === 2 ? { ...n, inicio: 2.5 } : n.inicio === 11 ? { ...n, tono: 76 } : n,
).concat([note(64, 15, 1, 0.7)])

const base = { licencia: 'CC BY 4.0', fuente: 'mock data (frontend)', tonalidad: 'Am', tempo: 96, estilo: ['salsa', 'romantica'] }

const SEED = [
  { ...base, id: 'p-003', nombre: 'Basic montuno', tipo: 'acordes', autor: 'luis', compases: 4, parent_id: null, notas: blockComping([AM, DM, E7, AM]) },
  { ...base, id: 'p-017', nombre: 'Montuno in A minor', tipo: 'acordes', autor: 'ana', compases: 4, parent_id: 'p-003', notas: guajeo([AM, DM, E7, AM]) },
  { ...base, id: 'p-010', nombre: 'Montuno in D minor', tipo: 'acordes', autor: 'luis', compases: 4, parent_id: null, tonalidad: 'Dm', notas: guajeo([DM, GM, A7, DM]) },
  { ...base, id: 'p-021', nombre: 'Romantic 2-3 clave', tipo: 'ritmo', autor: 'cristobal', compases: 2, parent_id: null, notas: clave23 },
  { ...base, id: 'p-024', nombre: 'Congas and bell', tipo: 'ritmo', autor: 'cristobal', compases: 2, parent_id: null, notas: congas },
  { ...base, id: 'p-022', nombre: 'Anticipated tumbao', tipo: 'bajo', autor: 'cristobal', compases: 4, parent_id: null, notas: tumbao([[45, 40], [50, 45], [40, 47], [45, 40]]) },
  { ...base, id: 'p-040', nombre: 'Bolero bass', tipo: 'bajo', autor: 'luis', compases: 4, parent_id: null, tonalidad: 'Dm', notas: tumbao([[50, 45], [43, 50], [45, 52], [50, 45]]) },
  { ...base, id: 'p-030', nombre: 'Falling chorus', tipo: 'melodia', autor: 'ana', compases: 4, parent_id: null, notas: coro },
  { ...base, id: 'p-031', nombre: 'Pregón in A minor', tipo: 'melodia', autor: 'luis', compases: 4, parent_id: 'p-030', notas: pregon },
]

const db = new Map(SEED.map((p) => [p.id, structuredClone(p)]))
let nextId = 100

const notFound = (id) => Object.assign(new Error(`Piece ${id} not found`), { status: 404 })
const get = (id) => {
  const p = db.get(id)
  if (!p) throw notFound(id)
  return structuredClone(p)
}

// Public projects for the landing page. Songs follow contract 4.2 plus publica/descripcion (stored by the backend); etiquetas/actualizado are mock-only extras.
// shortcut: the contract has no route to list or load songs; ask role B for GET /canciones and GET /canciones/:id.
const lane = (instrumento, pieza_id, compases, every, from = 0, to = 8) => {
  const bloques = []
  for (let compas = from; compas < to; compas += every) bloques.push({ pieza_id, compas })
  return { instrumento, bloques }
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const PROJECTS = [
  {
    id: 'c-101', nombre: 'Late-night salsa in A minor', autor: 'ana', tempo: 96, actualizado: hoursAgo(3),
    descripcion: 'Clave, congas and a guajeo montuno under a falling chorus. Fork the montuno and make it yours.',
    etiquetas: ['salsa', 'romantica', 'a-minor', 'montuno'],
    pistas: [lane('drums', 'p-021', 2, 2), lane('drums', 'p-024', 2, 2), lane('piano', 'p-017', 4, 4), lane('bass', 'p-022', 4, 4), lane('lead', 'p-030', 4, 4, 4)],
  },
  {
    id: 'c-103', nombre: 'Pregón remix', autor: 'cristobal', tempo: 100, actualizado: hoursAgo(20),
    descripcion: "luis's pregón over the basic montuno, with the anticipated tumbao holding it down.",
    etiquetas: ['salsa', 'pregon', 'a-minor', 'remix'],
    pistas: [lane('drums', 'p-021', 2, 2), lane('piano', 'p-003', 4, 4), lane('bass', 'p-022', 4, 4), lane('lead', 'p-031', 4, 4)],
  },
  {
    id: 'c-102', nombre: 'Bolero for a rainy Sunday', autor: 'luis', tempo: 72, actualizado: hoursAgo(50),
    descripcion: 'A slow D minor montuno and a bolero bass. Room for a melody, if you have one.',
    etiquetas: ['bolero', 'd-minor', 'slow'],
    pistas: [lane('piano', 'p-010', 4, 4), lane('bass', 'p-040', 4, 4)],
  },
  {
    id: 'c-104', nombre: 'Percussion sketch', autor: 'cristobal', tempo: 104, actualizado: hoursAgo(75),
    descripcion: 'Just the 2-3 clave and the conga tumbao, a rhythm bed to build on.',
    etiquetas: ['rhythm', 'clave', 'congas'],
    pistas: [lane('drums', 'p-021', 2, 2), lane('drums', 'p-024', 2, 2)],
  },
  {
    id: 'c-105', nombre: 'Montuno study', autor: 'luis', tempo: 90, actualizado: hoursAgo(140),
    descripcion: 'The basic montuno, then ana\'s guajeo fork of it, back to back. Hit "What changed?" on the second one.',
    etiquetas: ['montuno', 'a-minor', 'piano', 'study'],
    pistas: [{ instrumento: 'piano', bloques: [{ pieza_id: 'p-003', compas: 0 }, { pieza_id: 'p-017', compas: 4 }] }],
  },
]

// Favorite pieces while offline: kept in this browser, per username (the backend keeps them per account).
const favKey = (user) => `stemma-favorites:${user}`
function readFavorites(user) {
  try {
    const ids = JSON.parse(localStorage.getItem(favKey(user)))
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

export const mock = {
  favorites: (user) => readFavorites(user).filter((id) => db.has(id)),
  setFavorite(user, id, on) {
    if (on && !db.has(id)) throw notFound(id)
    const ids = readFavorites(user).filter((x) => x !== id)
    localStorage.setItem(favKey(user), JSON.stringify(on ? [id, ...ids] : ids))
    return {}
  },
  // Same rule as the backend: public songs, or every song by `autor` (private ones included).
  projects: (autor) => structuredClone(PROJECTS.filter((p) => (autor ? p.autor === autor : p.publica !== false))),
  saveProject(song) {
    const saved = { ...structuredClone(song), id: song.id ?? `c-${nextId++}`, actualizado: new Date().toISOString(), etiquetas: song.etiquetas ?? [] }
    const i = PROJECTS.findIndex((x) => x.id === saved.id)
    if (i >= 0) PROJECTS[i] = { ...PROJECTS[i], ...saved }
    else PROJECTS.unshift(saved)
    return structuredClone(saved)
  },
  project(id) {
    const p = PROJECTS.find((x) => x.id === id)
    if (!p) throw Object.assign(new Error(`Project ${id} not found`), { status: 404 })
    return structuredClone(p)
  },
  search({ q = '', tipo = '', tonalidad = '', estilo = '' } = {}) {
    const text = q.toLowerCase()
    return [...db.values()]
      .filter((p) => !tipo || p.tipo === tipo)
      .filter((p) => !tonalidad || p.tonalidad === tonalidad)
      .filter((p) => !estilo || p.estilo.includes(estilo))
      .filter((p) => !text || `${p.nombre} ${p.autor} ${p.id}`.toLowerCase().includes(text))
      .map((p) => structuredClone(p))
  },
  get,
  create(pieza) {
    const p = { ...structuredClone(pieza), id: `p-${nextId++}`, parent_id: null }
    db.set(p.id, p)
    return structuredClone(p)
  },
  fork(id, { autor = 'you' } = {}) {
    const src = get(id)
    const copy = { ...src, id: `p-${nextId++}`, autor, parent_id: id, fuente: 'forked in Stemma', nombre: `${src.nombre} (fork)` }
    db.set(copy.id, copy)
    return structuredClone(copy)
  },
  update(id, { notas, compases }) {
    const p = db.get(id)
    if (!p) throw notFound(id)
    p.notas = structuredClone(notas)
    if (compases) p.compases = compases
    return structuredClone(p)
  },
  diff(id, otherId) {
    return diffNotes(get(otherId).notas, get(id).notas)
  },
  copilot({ mensaje }) {
    const wantsMelody = /melod|chorus|coro|vocal|lead/i.test(mensaje)
    const ids = ['p-021', 'p-024', 'p-017', 'p-022', ...(wantsMelody ? ['p-030'] : [])]
    return {
      texto:
        'For a romantic salsa about heartbreak: a 2-3 clave at 96 BPM sets the pulse, the congas and bell fill it in, ' +
        "ana's A minor montuno anticipates each chord so it keeps moving, and cristobal's tumbao lands the bass just before the bar. " +
        'All four are in A minor, so they fit together. Pick what you like; the composing is yours.',
      piezas_sugeridas: ids,
    }
  },
}
