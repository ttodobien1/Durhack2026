// One colour per author, shared by the History window (Credits) and the piano roll's "Who wrote this?".
// Each author's colour comes from their name, so the same author looks the same everywhere; within one view two
// authors never share a colour (the second takes the next free one). You are always orange.
import { isMine } from './profile.js'

export const PALETTE = ['#72a6d2', '#a98bd6', '#6cbca1', '#d2766e', '#e0c35a', '#5fc4d8', '#d68bb8', '#9fbf5a']

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0

/** Map author -> CSS colour for the authors of one view. */
export function colorMap(autores) {
  const map = new Map()
  const taken = new Set()
  for (const a of autores) {
    if (map.has(a)) continue
    if (isMine(a)) {
      map.set(a, 'var(--orange)')
      continue
    }
    let k = hash(a) % PALETTE.length
    for (let tries = 0; tries < PALETTE.length && taken.has(k); tries++) k = (k + 1) % PALETTE.length
    taken.add(k)
    map.set(a, PALETTE[k])
  }
  return map
}
