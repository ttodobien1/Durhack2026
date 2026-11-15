// Signed-in user (a real account on the backend, see api.js), public profiles and contribution counts.
// Profiles are stored on the backend (/auth/yo, /usuarios/:nombre); this browser keeps a copy so pages and
// avatars render instantly and the app still works offline (mock mode).
import { useEffect, useState } from 'react'
import { api, currentUser, ME, onSession } from './api.js'

const profileKey = (name) => `lineage-profile:${name}`
const activityKey = (name) => `lineage-activity:${name}`

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback // storage blocked or corrupt
  }
}

export const loadUser = currentUser

/** [user, setUser]: setUser(null) logs out; logging in goes through AuthDialog (api.login / api.register). */
export function useUser() {
  const [user, set] = useState(currentUser)
  useEffect(() => onSession(set), [])
  const setUser = (u) => (u ? set(u) : api.logout())
  return [user, setUser]
}

export const ACCENTS = { green: 'var(--note)', orange: 'var(--orange)', blue: 'var(--t-acordes)', purple: 'var(--t-bajo)', teal: 'var(--t-melodia)', red: 'var(--t-ritmo)' }
export const emptyProfile = { displayName: '', bio: '', location: '', website: '', readme: '', accent: 'green', avatar: null, pinned: [] }
export const loadProfile = (name) => ({ ...emptyProfile, ...read(profileKey(name), {}) })

/** Keeps a copy of a profile in this browser. Throws when storage is full (a large avatar). */
export const cacheProfile = (name, profile) => localStorage.setItem(profileKey(name), JSON.stringify(profile))

/**
 * Saves the signed-in user's profile on the backend, then in this browser. Rejects with the server's
 * message, or when browser storage is full, so the caller can keep the form and show the error.
 */
export async function saveProfile(name, profile) {
  await api.saveProfile(profile)
  cacheProfile(name, profile)
}

/**
 * A user's profile from the backend (the source of truth), or null when there is none to show: no account, offline,
 * or an empty server profile (then the browser copy, e.g. written before accounts existed, is kept). The browser
 * copy is refreshed best-effort; a full storage never hides the server's version.
 */
export async function fetchProfile(name) {
  const remote = await api.getUser(name)
  if (!remote?.perfil || !Object.keys(remote.perfil).length) return null
  try {
    cacheProfile(name, remote.perfil)
  } catch {
    /* storage full: callers use the returned profile directly */
  }
  return { ...emptyProfile, ...remote.perfil }
}

/** Made by the person using the app: ME is their username, or "you" (unsaved work) when signed out. */
export const isMine = (autor) => autor === ME || (autor != null && autor === loadUser()?.name)

/** Pieces and projects made while signed out are authored "you" (api.js ME): they belong to whoever is signed in. */
export const authorsFor = (name) => (name === ME ? [...new Set([name, 'you'])] : [name])

const day = (d) => d.toLocaleDateString('en-CA') // local YYYY-MM-DD

/** Count one contribution (a fork, a saved piece or a saved project) today for the signed-in user. */
export function recordContribution() {
  const name = ME
  const log = read(activityKey(name), {})
  log[day(new Date())] = (log[day(new Date())] ?? 0) + 1
  try {
    localStorage.setItem(activityKey(name), JSON.stringify(log))
  } catch {
    /* storage blocked: the graph just misses it */
  }
}

/**
 * Contributions per day for the 53 weeks ending this week: { 'YYYY-MM-DD': n }.
 * shortcut: pieces have no dates in the contract, so the history is seeded from the username and scaled by
 * how many pieces they made; real contributions from this browser are added on top. Use real dates once the
 * backend stores them.
 */
export function contributions(name, pieceCount, today = new Date()) {
  let seed = [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const busy = pieceCount ? Math.min(0.55, 0.06 + pieceCount / 120) : 0
  const log = read(activityKey(name), {})
  const out = {}
  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - 52 * 7) // the Sunday 52 weeks before this week's
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const seeded = rand() < busy * (weekend ? 0.5 : 1) ? 1 + Math.floor(rand() ** 2 * 9) : 0
    out[day(d)] = seeded + (log[day(d)] ?? 0)
  }
  return out
}
