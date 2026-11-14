import { useEffect, useState } from 'react'
import { currentBeat } from './audio.js'

/** Transport playhead in beats, polled every animation frame (React skips renders while it is unchanged). */
export function usePlayhead() {
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    let raf
    const tick = () => {
      setBeat(currentBeat())
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return beat
}
