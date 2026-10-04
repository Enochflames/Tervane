import { useEffect, useState } from 'react'

/** Wall-clock seconds, ticking once per second (for "settled 12 s ago" and countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
