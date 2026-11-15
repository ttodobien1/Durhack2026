// "Leave without saving?" guard. The project page turns it on while it has unsaved changes (useLeaveGuard); then
// every way out asks first: closing or reloading the tab (the browser's own "Leave site?" box), Back / Forward and
// links (main.jsx checks each hash change) and the page's own buttons (confirmLeave).
import { useEffect } from 'react'

const MESSAGE = 'Your project has not been saved. Are you sure you want to leave?'
let active = false

/** true when it is fine to leave: nothing unsaved, or the user said so (then the guard stays off for this page). */
export function confirmLeave() {
  if (!active) return true
  if (!window.confirm(MESSAGE)) return false
  active = false
  return true
}

/** onClick for links that leave the page: keeps you on it when you choose to stay. */
export const leaveLink = (e) => {
  if (!confirmLeave()) e.preventDefault()
}

/** Turns the guard on while `unsaved` is true. */
export function useLeaveGuard(unsaved) {
  useEffect(() => {
    if (!unsaved) return
    active = true
    const onUnload = (e) => {
      if (!active) return
      e.preventDefault()
      e.returnValue = '' // older browsers need it; the text shown is always the browser's own
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      active = false
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [unsaved])
}
