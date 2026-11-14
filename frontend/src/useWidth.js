import { useCallback, useRef, useState } from 'react'

/** [callbackRef, width] of an element, kept current with ResizeObserver. */
export function useWidth() {
  const [width, setWidth] = useState(0)
  const ro = useRef(null)
  const ref = useCallback((el) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.current.observe(el)
  }, [])
  return [ref, width]
}
