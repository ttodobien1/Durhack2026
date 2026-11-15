// Unread messages of the signed-in user, for the badge next to Messages (site bar and project toolbar).
// Refreshes every minute and whenever a page fires the "stemma:unread" event (the Messages page, after reading).
import { useEffect, useState } from 'react'
import { api } from './api.js'

export const refreshUnread = () => window.dispatchEvent(new Event('stemma:unread'))

export function useUnread(user) {
  const [count, setCount] = useState(0)
  const name = user?.name
  useEffect(() => {
    if (!name) return
    let live = true
    const load = () => api.unread().then((n) => live && setCount(n))
    load()
    const timer = setInterval(load, 60_000)
    window.addEventListener('stemma:unread', load)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('stemma:unread', load)
    }
  }, [name])
  return name ? count : 0
}
