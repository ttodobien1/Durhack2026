// Signed-in user, public profiles and contribution counts, kept in this browser.
// shortcut: accounts are out of scope (CLAUDE.md §2), so nothing here reaches the backend; swap for real
// user routes if the team ever adds them to the contract.
import { useState } from 'react'
import { ME } from './api.js'

const USER_KEY = 'lineage-user'
const profileKey = (name) => `lineage-profile:${name}`
const activityKey = (name) => `lineage-activity:${name}`

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback // storage blocked or corrupt
  }
}

export const loadUser = () => read(USER_KEY, null)

/** [user, setUser]: setUser(null) signs out. */
export function useUser() {
  const [user, set] = useState(loadUser)
  const setUser = (u) => {
    try {
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u))
      else localStorage.removeItem(USER_KEY)
    } catch {
      /* storage blocked: signed in for this visit only */
    }
    set(u)
  }
  return [user, setUser]
}

export const ACCENTS = { green: 'var(--note)', orange: 'var(--orange)', blue: 'var(--t-acordes)', purple: 'var(--t-bajo)', teal: 'var(--t-melodia)', red: 'var(--t-ritmo)' }
export const emptyProfile = { displayName: '', bio: '', location: '', website: '', readme: '', accent: 'green', avatar: null, pinned: [] }
export const loadProfile = (name) => ({ ...emptyProfile, ...read(profileKey(name), {}) })
/** Throws when storage is full (a large avatar), so the caller can keep the form and show the error. */
export const saveProfile = (name, profile) => localStorage.setItem(profileKey(name), JSON.stringify(profile))

/** Pieces and projects made while signed out are authored "you" (api.js ME): they belong to whoever is signed in. */
export const authorsFor = (name) => (name === (loadUser()?.name ?? ME) ? [...new Set([name, ME])] : [name])

const day = (d) => d.toLocaleDateString('en-CA') // local YYYY-MM-DD

/** Count one contribution (a fork, a saved piece or a saved project) today for the signed-in user. */
export function recordContribution() {
  const name = loadUser()?.name ?? ME
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
