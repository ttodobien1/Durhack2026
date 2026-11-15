// Favorite pieces of the signed-in user (the star in the project Browser), shared by every component.
//
// One source of truth: `ids` (most recently starred first). A click changes it at once, so the star and the
// Favorites tab update in the same render; the server is then told, one request at a time per piece, and the
// last click wins. If a request fails the list is reloaded from the server, so it never shows a wrong state.
// The list is also reloaded on log in / log out, when the window gets focus back, and when another tab changes
// the offline copy, so a change made elsewhere shows up too.
import { useSyncExternalStore } from 'react'
import { api, currentUser, onSession } from './api.js'

let state = { user: null, ids: [], ready: false }
const subscribers = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  for (const fn of subscribers) fn()
}

const pending = new Map() // piece id -> { want: boolean, promise } while its request is in flight
let generation = 0 // bumped by every change, so a list requested before it is ignored when it arrives

async function load() {
  const user = currentUser()
  const mine = ++generation
  if (!user) return set({ user: null, ids: [], ready: true })
  if (state.user !== user.name) set({ user: user.name, ids: [], ready: false })
  try {
    const ids = await api.favorites()
    if (mine !== generation || currentUser()?.name !== user.name) return
    set({ ids, ready: true })
  } catch {
    if (mine === generation) set({ ready: true }) // offline: keep what is shown
  }
}

async function flush(id, job) {
  let sent
  try {
    do {
      sent = job.want
      await api.setFavorite(id, sent)
    } while (job.want !== sent) // clicked again while the request was running: send the latest choice
  } finally {
    pending.delete(id)
    generation++ // a list fetched while this was running may predate it
  }
}

/** Stars (on = true), un-stars (on = false) or toggles (on omitted) a piece. Rejects if the server refuses. */
export function setFavorite(id, on = !state.ids.includes(id)) {
  if (!currentUser()) return Promise.reject(new Error('Log in to keep favorite pieces.'))
  set({ ids: on ? [id, ...state.ids.filter((x) => x !== id)] : state.ids.filter((x) => x !== id) })
  generation++
  const job = pending.get(id)
  if (job) {
    job.want = on
    return job.promise
  }
  const next = { want: on }
  next.promise = flush(id, next).catch((e) => {
    load() // show what the server really has
    throw e
  })
  pending.set(id, next)
  return next.promise
}

let started = false
function start() {
  if (started) return
  started = true
  onSession(() => {
    pending.clear()
    load()
  })
  const refresh = () => !pending.size && currentUser() && load()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())
  window.addEventListener('storage', (e) => e.key?.startsWith('stemma-favorites:') && refresh())
  load()
}

function subscribe(fn) {
  start()
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/** { user, ids, ready }: re-renders whenever the favorites change. */
export const useFavorites = () => useSyncExternalStore(subscribe, () => state)
