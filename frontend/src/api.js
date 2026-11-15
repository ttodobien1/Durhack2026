// API client for CLAUDE.md §4.3. Falls back to the in-memory mock when the backend is unreachable,
// so the UI keeps working before role B's server is up.
import { mock } from './mock.js'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
export const ME = 'you' // shortcut: no accounts (out of scope); every fork is authored by "you".
let usingMock = false
export const isMock = () => usingMock

async function call(path, options, fallback) {
  if (!usingMock) {
    let res
    try {
      res = await fetch(BASE + path, {
        ...options,
        headers: { 'Content-Type': 'application/json' },
        body: options?.body && JSON.stringify(options.body),
      })
    } catch {
      usingMock = true // network error: backend not running
    }
    if (res) {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      return data
    }
  }
  return fallback()
}

export const api = {
  // Songs: extra routes from the backend (cambios.md §3), not in the §4.3 table.
  // Public projects, or every project by `autor` including private ones (no accounts: private means unlisted).
  projects: (autor) => call(autor ? `/canciones?autor=${encodeURIComponent(autor)}` : '/canciones', undefined, () => mock.projects(autor)),
  project: (id) => call(`/canciones/${id}`, undefined, () => mock.project(id)),
  saveProject: ({ id, ...song }) =>
    id && id !== 'c-new'
      ? call(`/canciones/${id}`, { method: 'PUT', body: song }, () => mock.saveProject({ id, ...song }))
      : call('/canciones', { method: 'POST', body: song }, () => mock.saveProject(song)),
  search: (filters) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
    return call(`/piezas?${qs}`, undefined, () => mock.search(filters))
  },
  // New original piece (the upload page): POST /piezas, which already exists in the backend.
  createPiece: (pieza) => call('/piezas', { method: 'POST', body: pieza }, () => mock.create(pieza)),
  getPiece: (id) => call(`/piezas/${id}`, undefined, () => mock.get(id)),
  fork: (id, autor) => call(`/piezas/${id}/fork`, { method: 'POST', body: { autor } }, () => mock.fork(id, { autor })),
  saveNotes: (id, notas, compases) => call(`/piezas/${id}`, { method: 'PUT', body: { notas, compases } }, () => mock.update(id, { notas, compases })),
  // Changed piece first, original second: `nuevas` are notes only in `id`.
  diff: (id, original) => call(`/piezas/${id}/diff/${original}`, undefined, () => mock.diff(id, original)),
  copilot: (mensaje, cancion) =>
    call('/copiloto', { method: 'POST', body: { mensaje, cancion } }, () => mock.copilot({ mensaje, cancion })),
}
