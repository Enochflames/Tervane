import { useLayoutEffect, useRef, useState } from 'react'
import './segmented.css'

interface Option<T extends string> { value: T; label: string }

/** Segmented control with a sliding indicator (transform only, 240 ms ease-out). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value]
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value])
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {box && <span className="seg-indicator" style={{ transform: `translateX(${box.x}px)`, width: box.w }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} ref={(el) => { refs.current[o.value] = el }} role="tab" aria-selected={o.value === value}
          className="seg-item" data-active={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
