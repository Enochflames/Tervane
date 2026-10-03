// Protocol constants. PROTOCOL-SPEC §2 and §10.1. Mirrored exactly in TervaneCore.sol (CLAUDE.md §3.8).

export const ASSET_USD = 0
export const ASSET_ETH = 1
export type Asset = typeof ASSET_USD | typeof ASSET_ETH

export const BPS = 10_000n
export const YEAR = 31_536_000n
export const MAX_RATE_BPS = 10_000
export const LIQ_PENALTY_BPS = 1_000n
export const LIQ_FEE_BPS = 500n
export const VALUE_SCALE = 10n ** 20n
export const MAX_INBOX_PER_EPOCH = 200n
export const MAX_PAYOUTS_PER_EPOCH = 32
export const BLOB_LEN = 350
export const PAYLOAD_LEN = 288

export const KIND_DEPOSIT = 1
export const KIND_INTENT = 2
export const KIND_WITHDRAW = 3

export const ACTION_LEND = 1
export const ACTION_BORROW = 2
export const ACTION_CANCEL = 3
export const ACTION_REPAY = 4

export const SIDE_LEND = 1
export const SIDE_BORROW = 2

export const PAYLOAD_VERSION = 1
export const REPORT_VERSION = 1

/** Tenor 2 exists only when demoMode is on (§2). */
export const TENORS: readonly { id: number; seconds: bigint; label: string; demoOnly: boolean }[] = [
  { id: 0, seconds: 604_800n, label: '7d', demoOnly: false },
  { id: 1, seconds: 2_592_000n, label: '30d', demoOnly: false },
  { id: 2, seconds: 600n, label: 'DEMO-10m', demoOnly: true },
]

export function tenorSeconds(tenorId: number, demoMode: boolean): bigint | undefined {
  const t = TENORS[tenorId]
  if (!t || (t.demoOnly && !demoMode)) return undefined
  return t.seconds
}

export const TIERS: readonly { id: number; name: string; openRatioBps: bigint; liqRatioBps: bigint; minRepaid: bigint }[] = [
  { id: 0, name: 'Bronze', openRatioBps: 20_000n, liqRatioBps: 16_000n, minRepaid: 0n },
  { id: 1, name: 'Silver', openRatioBps: 18_000n, liqRatioBps: 14_500n, minRepaid: 1_000_000_000n },
  { id: 2, name: 'Gold', openRatioBps: 15_000n, liqRatioBps: 12_500n, minRepaid: 5_000_000_000n },
  { id: 3, name: 'Platinum', openRatioBps: 13_000n, liqRatioBps: 11_500n, minRepaid: 20_000_000_000n },
]
export const MAX_TIER = TIERS.length - 1

export function tierParams(tier: number) {
  const t = TIERS[tier]
  if (!t) throw new RangeError(`unknown tier ${tier}`)
  return t
}

/** Max outstanding principal (active loans + open borrow orders), §10.1. */
export function tierCap(tier: number, repaidVolume: bigint): bigint {
  switch (tier) {
    case 0: return 2_000_000_000n
    case 1: return repaidVolume > 2_000_000_000n ? repaidVolume : 2_000_000_000n
    case 2: return (repaidVolume * 3n) / 2n
    case 3: return repaidVolume * 2n
    default: throw new RangeError(`unknown tier ${tier}`)
  }
}

/** Highest tier whose minRepaid ≤ repaidVolume (§10.3). */
export function tierForVolume(repaidVolume: bigint): number {
  let t = 0
  for (const x of TIERS) if (repaidVolume >= x.minRepaid) t = x.id
  return t
}
