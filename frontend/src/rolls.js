// Notes for MiniRoll (components/MiniRoll.jsx), colored by what a diff says about them.
import { diffNotes } from './diff.js'

/** Notes of a diff as MiniRoll notes: same (grey), new (green), deleted (red), moved (yellow, dashed where it was). */
export function diffRoll({ nuevas, borradas, movidas, iguales }) {
  return [
    ...iguales.map((n) => ({ ...n, cls: 'same' })),
    ...borradas.map((n) => ({ ...n, cls: 'del' })),
    ...movidas.map((m) => ({ ...m.antes, cls: 'from' })),
    ...movidas.map((m) => ({ ...m.despues, cls: 'mov' })),
    ...nuevas.map((n) => ({ ...n, cls: 'new' })),
  ]
}

/** MiniRoll notes for `notas` compared with `before` (null: plain notes). */
export const compareRoll = (before, notas) => (before ? diffRoll(diffNotes(before, notas)) : notas)
