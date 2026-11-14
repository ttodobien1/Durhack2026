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
  projects: () => call('/canciones', undefined, () => mock.projects()),
  project: (id) => call(`/canciones/${id}`, undefined, () => mock.project(id)),
  saveProject: ({ id, ...song }) =>
    id && id !== 'c-new'
      ? call(`/canciones/${id}`, { method: 'PUT', body: song }, () => mock.saveProject({ id, ...song }))
      : call('/canciones', { method: 'POST', body: song }, () => mock.saveProject(song)),
  search: (filters) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
    return call(`/piezas?${qs}`, undefined, () => mock.search(filters))
  },
  getPiece: (id) => call(`/piezas/${id}`, undefined, () => mock.get(id)),
  fork: (id, autor) => call(`/piezas/${id}/fork`, { method: 'POST', body: { autor } }, () => mock.fork(id, { autor })),
  saveNotes: (id, notas, compases) => call(`/piezas/${id}`, { method: 'PUT', body: { notas, compases } }, () => mock.update(id, { notas, compases })),
  // Changed piece first, original second: `nuevas` are notes only in `id`.
  diff: (id, original) => call(`/piezas/${id}/diff/${original}`, undefined, () => mock.diff(id, original)),
  copilot: (mensaje, cancion) =>
    call('/copiloto', { method: 'POST', body: { mensaje, cancion } }, () => mock.copilot({ mensaje, cancion })),
}
