// Display formatting. Amounts stay bigint until this point; never Number() an amount for math.
export function units(x: bigint, decimals: number, dp = 2): string {
  const neg = x < 0n
  const v = neg ? -x : x
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  let frac = ''
  if (dp > 0) {
    const f = ((v % base) * 10n ** BigInt(dp)) / base
    frac = `.${f.toString().padStart(dp, '0')}`
  }
  return `${neg ? '−' : ''}${whole.toLocaleString('en-US')}${frac}`
}
export const usd = (x: bigint, dp = 2) => units(x, 6, dp)
export const eth = (x: bigint, dp = 4) => units(x, 18, dp)
export const pct = (bps: number | bigint) => `${(Number(bps) / 100).toFixed(2)}%`

/** Parses a user-typed decimal into base units; returns null for anything malformed. */
export function parseUnitsSafe(s: string, decimals: number): bigint | null {
  const t = s.trim().replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null
  const [w = '0', f = ''] = t.split('.')
  if (f.length > decimals) return null
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

/** "5.27" (percent) → 527 bps; null if invalid or outside (0, 100]. */
export function parseRateBps(s: string): number | null {
  const v = parseUnitsSafe(s, 2)
  if (v === null || v < 1n || v > 10_000n) return null
  return Number(v)
}

export const short = (h: string, a = 6, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`

export function ago(secs: number): string {
  if (secs < 0) return 'just now'
  if (secs < 60) return `${Math.floor(secs)} s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`
  return `${Math.floor(secs / 86400)} d ago`
}

export function until(secs: number): string {
  if (secs <= 0) return 'now'
  if (secs < 60) return `in ${Math.ceil(secs)} s`
  if (secs < 3600) return `in ${Math.ceil(secs / 60)} min`
  if (secs < 86400) return `in ${(secs / 3600).toFixed(1)} h`
  return `in ${(secs / 86400).toFixed(1)} d`
}
