/** Tervane wordmark: a T-bar with a single wax-seal dot. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--ink)" />
        <path d="M9 10h14M16 10v13" stroke="var(--paper)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="23" cy="22" r="3" fill="var(--accent)" />
      </svg>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: size * 1.05, letterSpacing: '-0.02em', lineHeight: 1 }}>Tervane</span>
    </span>
  )
}
