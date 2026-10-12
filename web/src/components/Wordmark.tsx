import { useId } from 'react'

/** Tervane wordmark: "T." — the T with a wax seal as its full stop. Theme-aware: ink tile in light mode, paper in dark. */
export function Wordmark({ size = 22 }: { size?: number }) {
  const seal = useId()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
        <defs>
          <radialGradient id={seal} cx="0.36" cy="0.3" r="0.78">
            <stop offset="0" stopColor="#ec6a32" />
            <stop offset="0.55" stopColor="#c2410c" />
            <stop offset="1" stopColor="#8f2f0d" />
          </radialGradient>
        </defs>
        <rect width="512" height="512" rx="120" fill="var(--ink)" />
        <g transform="translate(-14 -10)">
          <rect x="124" y="132" width="264" height="52" rx="26" fill="var(--paper)" />
          <rect x="230" y="132" width="52" height="250" rx="26" fill="var(--paper)" />
          <circle cx="370" cy="356" r="46" fill={`url(#${seal})`} />
        </g>
      </svg>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: size * 1.05, letterSpacing: '-0.02em', lineHeight: 1 }}>Tervane</span>
    </span>
  )
}
