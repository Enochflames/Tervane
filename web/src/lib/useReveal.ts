import { useEffect, useRef } from 'react'

/** Marks [data-reveal] descendants as shown once they enter the viewport (decorative, runs once). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!('IntersectionObserver' in window)) { items.forEach((i) => (i.dataset.shown = 'true')); return }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = 'true'; io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 })
    // Anything already in view at load shows immediately, so the first paint is never blank.
    const vh = window.innerHeight
    for (const i of items) {
      const r = i.getBoundingClientRect()
      if (r.top < vh && r.bottom > 0) i.dataset.shown = 'true'
      else io.observe(i)
    }
    return () => io.disconnect()
  }, [])
  return ref
}
