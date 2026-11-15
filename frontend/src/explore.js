// "Explore" links (hero button, site menu). On the landing page they scroll to the projects without putting
// #explore in the URL, because a reload would then jump there again. From another page they navigate to the
// landing with #explore; the landing scrolls there once and cleans the URL (Landing.jsx).
export function exploreClick(e) {
  const section = document.getElementById('explore')
  if (!section) return // not on the landing: let the link navigate
  e.preventDefault()
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Brings the projects into view and keeps them there for a moment while the page is still loading (it grows as
 * projects and thumbnails arrive), unless the visitor scrolls or presses a key first.
 */
export function settleOnExplore(ms = 1500) {
  let stopped = false
  const stop = () => (stopped = true)
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown']
  events.forEach((type) => window.addEventListener(type, stop, { once: true, passive: true }))
  const start = performance.now()
  const tick = () => {
    if (!stopped) document.getElementById('explore')?.scrollIntoView({ block: 'start' })
    if (!stopped && performance.now() - start < ms) requestAnimationFrame(tick)
    else events.forEach((type) => window.removeEventListener(type, stop))
  }
  requestAnimationFrame(tick)
}
