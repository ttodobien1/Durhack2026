// Reuse counters of pieces (how many projects use them + how many forks), loaded in batches and cached for the visit.
// Projects already carry their own count (`forks`, from the backend's song lists).
import { useEffect, useState } from 'react'
import { api } from './api.js'

const cache = new Map() // piece id -> { canciones, forks, total }
const pending = new Map() // piece id -> Promise
const BATCH = 200 // the backend accepts up to 200 ids per call

async function fetchCounts(ids) {
  const out = {}
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await api.usage({ piezas: ids.slice(i, i + BATCH) })
    Object.assign(out, res?.piezas ?? {})
  }
  return out
}

/** Counters for `ids`, from the cache when possible: { [id]: { canciones, forks, total } }. */
export async function loadPieceReuse(ids) {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id) && !pending.has(id))
  if (missing.length) {
    const request = fetchCounts(missing).then(
      (counts) => missing.forEach((id) => cache.set(id, counts[id] ?? { canciones: 0, forks: 0, total: 0 })),
      () => {}, // offline or failed: show no counters rather than an error
    )
    missing.forEach((id) => pending.set(id, request))
    request.finally(() => missing.forEach((id) => pending.delete(id)))
  }
  await Promise.all([...new Set(ids)].map((id) => pending.get(id)).filter(Boolean))
  return Object.fromEntries(ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)]))
}

/** Forget a piece's counter (after forking it or using it, so the next look is fresh). */
export const forgetReuse = (id) => cache.delete(id)

/** React hook: the reuse counters of the pieces on screen. */
export function usePieceReuse(ids) {
  const key = ids.join(',')
  const [counts, setCounts] = useState({})
  useEffect(() => {
    if (!key) return
    let live = true
    loadPieceReuse(key.split(',')).then((c) => live && setCounts((s) => ({ ...s, ...c })))
    return () => {
      live = false
    }
  }, [key])
  return counts
}
