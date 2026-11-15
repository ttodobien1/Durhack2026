// API client for CLAUDE.md §4.3 plus the account routes (/auth, /usuarios). Falls back to the in-memory mock
// when the backend is unreachable, so the UI keeps working without role B's server.
import { mock } from './mock.js'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SESSION_KEY = 'stemma-session' // { user: { name, email }, token }

function readSession() {
  try {
    localStorage.removeItem('lineage-user') // the old browser-only login: sign in again for real
    return JSON.parse(localStorage.getItem(SESSION_KEY))
  } catch {
    return null // storage blocked or corrupt
  }
}

let session = readSession()
const listeners = new Set()

/**
 * Author name of the person using the app: their username when logged in, "you" when signed out.
 * A live binding: it changes on log in / log out, so read it when rendering, not once at import.
 */
export let ME = session?.user?.name ?? 'you'
export const currentUser = () => session?.user ?? null

/** Calls fn(user | null) whenever someone logs in or out. Returns the unsubscribe function. */
export function onSession(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setSession(next) {
  session = next
  ME = next?.user?.name ?? 'you'
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage blocked: logged in for this visit only */
  }
  for (const fn of listeners) fn(currentUser())
}

// shortcut: another person's edit to a piece shows up here after a reload; fine for single-session demos.
const pieceCache = new Map() // piece id -> Promise<Pieza>
let usingMock = false
export const isMock = () => usingMock

async function call(path, options, fallback) {
  if (!usingMock) {
    const token = session?.token
    let res
    try {
      res = await fetch(BASE + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: options?.body && JSON.stringify(options.body),
      })
    } catch {
      usingMock = true // network error: backend not running
    }
    if (res) {
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
      // Expired or revoked session: continue signed out (a wrong password on /auth/* is not that).
      if (res.status === 401 && token && !path.startsWith('/auth/login') && !path.startsWith('/auth/registro')) {
        setSession(null)
        return call(path, options, fallback)
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      return data
    }
  }
  return fallback()
}

const toUser = (u) => ({ name: u.nombre, email: u.email })

// Offline fallback for what only the server can do (comments, collaborators, proposals, messages).
const needsServer = () => {
  throw new Error('This needs the Stemma server, and the app is running on local demo data right now.')
}
const enc = encodeURIComponent

/** Stores the session returned by /auth/login or /auth/registro and returns { user, perfil }. */
function startSession({ usuario, token }) {
  setSession({ user: toUser(usuario), token })
  return { user: currentUser(), perfil: usuario.perfil ?? {} }
}

// Offline (mock) accounts: the old browser-only behaviour, so the demo still works without the backend.
const offlineSession = (nombre) => ({ usuario: { nombre, perfil: {} }, token: null })

export const api = {
  // Accounts (cambios.md §8). Passwords go only to the backend, which stores a hash.
  register: ({ nombre, email, password }) =>
    call('/auth/registro', { method: 'POST', body: { nombre, email, password } }, () => offlineSession(nombre)).then(startSession),
  login: ({ usuario, password }) =>
    call('/auth/login', { method: 'POST', body: { usuario, password } }, () => offlineSession(usuario)).then(startSession),
  logout: async () => {
    if (session?.token) await call('/auth/logout', { method: 'POST' }, () => ({})).catch(() => {})
    setSession(null)
  },
  /** Checks the stored session against the backend (signs out if it expired). Returns the profile or null. */
  me: () =>
    session?.token
      ? call('/auth/yo', undefined, () => null).then((r) => r?.usuario?.perfil ?? null).catch(() => null)
      : Promise.resolve(null),
  saveProfile: (perfil) =>
    session?.token ? call('/auth/yo', { method: 'PUT', body: { perfil } }, () => null) : Promise.resolve(null),
  /** Public profile { nombre, perfil, creado }, or null if that user has no account. */
  getUser: (nombre) => call(`/usuarios/${encodeURIComponent(nombre)}`, undefined, () => null).catch(() => null),

  // Songs: extra routes from the backend (cambios.md §3), not in the §4.3 table.
  // Public projects, or every project by `autor` including private ones (no accounts: private means unlisted).
  projects: (autor) => call(autor ? `/canciones?autor=${encodeURIComponent(autor)}` : '/canciones', undefined, () => mock.projects(autor)),
  project: (id) => call(`/canciones/${id}`, undefined, () => mock.project(id)),
  // `mensaje` (optional) describes the version this save creates; a copy sends `parent_id` / `parent_version`.
  saveProject: ({ id, mensaje, ...song }) =>
    id && id !== 'c-new'
      ? call(`/canciones/${id}`, { method: 'PUT', body: { ...song, mensaje } }, () => mock.saveProject({ id, ...song }))
      : call('/canciones', { method: 'POST', body: { ...song, mensaje } }, () => mock.saveProject(song)),
  // Trash (cambios.md §13): deleting moves a project to the trash; its author can restore it for 20 days, then the
  // server deletes it for good. Each project in `trash()` carries `borrada` and `se_borra` (ISO dates).
  deleteProject: (id) => call(`/canciones/${id}`, { method: 'DELETE' }, () => mock.trashProject(id)),
  trash: () => call('/canciones/papelera', undefined, () => mock.trash(ME)),
  restoreProject: (id) => call(`/canciones/${id}/restaurar`, { method: 'POST' }, () => mock.restoreProject(id)),
  purgeProject: (id) => call(`/canciones/papelera/${id}`, { method: 'DELETE' }, () => mock.purgeProject(id)),

  // Project history (cambios.md §9): versions, diff between versions, forks, merge and credits.
  // They need the backend: offline (mock) they resolve to null and the History window says so.
  // `snapshots`: every version (newest 40) with its full snapshot, for the version tree.
  versions: (id, snapshots = false) => call(`/canciones/${id}/versiones${snapshots ? '?snapshots=1' : ''}`, undefined, () => null),
  version: (id, n) => call(`/canciones/${id}/versiones/${n}`, undefined, () => null),
  versionDiff: (id, n, contra) => call(`/canciones/${id}/versiones/${n}/diff${contra ? `?contra=${contra}` : ''}`, undefined, () => null),
  related: (id) => call(`/canciones/${id}/forks`, undefined, () => null),
  mergePreview: (id, otra, resoluciones) => call(`/canciones/${id}/merge/${otra}/preview`, { method: 'POST', body: { resoluciones } }, () => null),
  merge: (id, otra, resoluciones, mensaje) =>
    call(`/canciones/${id}/merge/${otra}`, { method: 'POST', body: { resoluciones, mensaje } }, () => {
      throw new Error('Merging needs the Stemma server.')
    }),
  credits: (id) => call(`/canciones/${id}/creditos`, undefined, () => null),
  // Favorite pieces of the signed-in account (cambios.md §11): ids, most recently starred first. Offline
  // accounts (no token) keep them in this browser.
  favorites: () => (session?.token ? call('/auth/yo/favoritos', undefined, () => mock.favorites(ME)) : Promise.resolve(mock.favorites(ME))),
  setFavorite: (id, on) =>
    session?.token
      ? call(`/auth/yo/favoritos/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' }, () => mock.setFavorite(ME, id, on))
      : Promise.resolve().then(() => mock.setFavorite(ME, id, on)),
  search: (filters) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
    return call(`/piezas?${qs}`, undefined, () => mock.search(filters))
  },
  // New original piece: POST /piezas. The upload page publishes; the editor's "+" sends publica: false (private until
  // the piece is saved in a public project, cambios.md §10).
  createPiece: (pieza) => call('/piezas', { method: 'POST', body: pieza }, () => mock.create(pieza)),
  // Cached for the visit: the landing, profile and project pages ask for the same pieces again and again.
  // Musical fingerprints (backend lib/fingerprint.js). Offline (mock) there is nothing to compare with.
  similar: (id, n = 6) => call(`/piezas/${id}/parecidas?n=${n}`, undefined, () => []),
  // Plays and trends (cambios.md §18; a TimescaleDB hypertable on TigerData). Offline (mock) there is nothing to count.
  /** Counts one play of a saved song ({ cancion_id }) or of pieces ({ pieza_ids }). Fire-and-forget: never throws. */
  logPlay: (what) => {
    if (usingMock) return
    call('/eventos/reproduccion', { method: 'POST', body: what }, () => null).catch(() => {})
  },
  /** Public pieces most played and forked in the last 24 h: [{ ...Pieza, reproducciones, forks }]. Offline: []. */
  trending: () => call('/piezas/tendencia', undefined, () => []).catch(() => []),
  /** One piece's plays per hour over 24 h: { horas: [{ hora, reproducciones, forks }], total }. Offline: null. */
  activity: (id) => call(`/piezas/${id}/actividad`, undefined, () => null).catch(() => null),
  /** "git blame" of one piece: { autores: [{ autor, notas, porcentaje }], notas: [{ ...nota, autor }] }. Offline: null. */
  blame: (id) => call(`/piezas/${id}/blame`, undefined, () => null),
  /** DJ Stemy explains a diff: { texto, hechos, fuente: "modelo" | "plantilla" }. Offline: null. */
  explainDiff: (id, otra) => call(`/piezas/${id}/diff/${otra}/explicacion`, undefined, () => null),
  /** Sound map of one piece type: { total, ejes, puntos } (PCA of the fingerprints). Offline: null. */
  pieceMap: (tipo) => call(`/piezas/mapa?tipo=${tipo}`, undefined, () => null),
  /** { parecidas, aviso }: aviso = a public piece by someone else that these notes nearly copy, or null. */
  checkSimilar: (pieza) => call('/piezas/parecidas', { method: 'POST', body: pieza }, () => null).catch(() => null),
  getPiece: (id) => {
    if (!pieceCache.has(id)) pieceCache.set(id, call(`/piezas/${id}`, undefined, () => mock.get(id)).catch((e) => (pieceCache.delete(id), Promise.reject(e))))
    return pieceCache.get(id).then((p) => structuredClone(p)) // callers may change their copy
  },
  fork: (id, autor) => call(`/piezas/${id}/fork`, { method: 'POST', body: { autor } }, () => mock.fork(id, { autor })),
  saveNotes: (id, notas, compases) => {
    pieceCache.delete(id)
    return call(`/piezas/${id}`, { method: 'PUT', body: { notas, compases } }, () => mock.update(id, { notas, compases }))
  },
  // Only the author of a piece can rename it (PUT /piezas/:id with just `nombre`; notes, author and lineage stay).
  renamePiece: (id, nombre) => {
    pieceCache.delete(id)
    return call(`/piezas/${id}`, { method: 'PUT', body: { nombre } }, () => mock.update(id, { nombre }))
  },
  // Who may see and use one of your pieces (cambios.md §14). The server answers 409 with the reason when it cannot
  // change (e.g. a public project uses it).
  setPieceVisibility: (id, publica) => {
    pieceCache.delete(id)
    return call(`/piezas/${id}`, { method: 'PUT', body: { publica } }, () => mock.update(id, { publica }))
  },

  // Connections (cambios.md §14) -----------------------------------------------------------------------------
  // Home page: { populares, ayuda } (most popular public projects, open help requests).
  community: () => call('/canciones/comunidad', undefined, () => mock.community()),
  // Projects you collaborate on.
  shared: () => (session?.token ? call('/canciones/compartidas', undefined, () => []) : Promise.resolve([])),
  // Author only: { permite_fork?, permite_propuestas?, pide_ayuda? (text, or null to remove) } -> the project.
  setProjectSettings: (id, ajustes) => call(`/canciones/${id}/ajustes`, { method: 'PATCH', body: ajustes }, needsServer),
  collaborators: (id) => call(`/canciones/${id}/colaboradores`, undefined, needsServer),
  createInvite: (id) => call(`/canciones/${id}/invitacion`, { method: 'POST' }, needsServer),
  deleteInvite: (id) => call(`/canciones/${id}/invitacion`, { method: 'DELETE' }, needsServer),
  removeCollaborator: (id, nombre) => call(`/canciones/${id}/colaboradores/${enc(nombre)}`, { method: 'DELETE' }, needsServer),
  invite: (token) => call(`/invitaciones/${enc(token)}`, undefined, needsServer),
  acceptInvite: (token) => call(`/invitaciones/${enc(token)}/aceptar`, { method: 'POST' }, needsServer),
  proposals: (id) => call(`/canciones/${id}/propuestas`, undefined, () => null),
  // { titulo, mensaje, desde_id } (your fork) or { titulo, mensaje, cancion } (the edited project) -> { propuesta, copia }
  propose: (id, body) => call(`/canciones/${id}/propuestas`, { method: 'POST', body }, needsServer),
  closeProposal: (id, pid, estado) => call(`/canciones/${id}/propuestas/${pid}`, { method: 'PATCH', body: { estado } }, needsServer),
  // objetivo: 'cancion' | 'pieza'
  comments: (objetivo, id) => call(`/comentarios?objetivo=${objetivo}&id=${enc(id)}`, undefined, needsServer),
  addComment: (objetivo, id, texto) => call('/comentarios', { method: 'POST', body: { objetivo, id, texto } }, needsServer),
  deleteComment: (cid) => call(`/comentarios/${cid}`, { method: 'DELETE' }, needsServer),
  // Messages, like email.
  conversations: () => call('/mensajes', undefined, needsServer),
  unread: () =>
    session?.token
      ? call('/mensajes/sin-leer', undefined, () => ({ sin_leer: 0 }))
          .then((r) => r.sin_leer ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),
  thread: (nombre) => call(`/mensajes/con/${enc(nombre)}`, undefined, needsServer),
  sendMessage: ({ para, asunto, texto, cancion_id }) => call('/mensajes', { method: 'POST', body: { para, asunto, texto, cancion_id } }, needsServer),
  messageSettings: () => call('/mensajes/ajustes', undefined, needsServer),
  setMessageSettings: (mensajes_de) => call('/mensajes/ajustes', { method: 'PUT', body: { mensajes_de } }, needsServer),
  block: (nombre, on) => call(`/mensajes/bloqueos/${enc(nombre)}`, { method: on ? 'PUT' : 'DELETE' }, needsServer),

  // Changed piece first, original second: `nuevas` are notes only in `id`.
  diff: (id, original) => call(`/piezas/${id}/diff/${original}`, undefined, () => mock.diff(id, original)),
  // extra (optional): { historial: [{ de: 'usuario' | 'stemy', texto }], tarareo: { notas } } (a humming transcribed in
  // hum.js). With a humming the answer also has `tarareo`: { tonalidad, notas, coincidencias: [{ id, similitud... }] }.
  copilot: (mensaje, cancion, extra = {}) =>
    call('/copiloto', { method: 'POST', body: { mensaje, cancion, ...extra } }, () => mock.copilot({ mensaje, cancion, ...extra })),

  // Reuse counters (popularity): { piezas: { id: { canciones, forks, total } }, canciones: { id: { forks, total } } }
  usage: ({ piezas = [], canciones = [] }) =>
    call(`/usos?piezas=${piezas.map(enc).join(',')}&canciones=${canciones.map(enc).join(',')}`, undefined, () => mock.usage({ piezas, canciones })),
  // Where a piece is reused: { total, canciones: { total, lista }, forks: { total, lista } }
  pieceUsage: (id) => call(`/piezas/${enc(id)}/usos`, undefined, () => mock.pieceUsage(id)),
}
