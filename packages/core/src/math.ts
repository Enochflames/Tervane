// Fixed-point helpers and protocol math. PROTOCOL-SPEC §1, §9, §10. Mirrored in TervaneMath.sol.
// Owed amounts round up, paid/credited amounts round down (§1).

import { BPS, LIQ_FEE_BPS, LIQ_PENALTY_BPS, VALUE_SCALE, YEAR, tierParams } from './params'
import type { Address } from './types'

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n || a < 0n) throw new RangeError('ceilDiv domain')
  return a === 0n ? 0n : (a - 1n) / b + 1n
}

export function floorDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n || a < 0n) throw new RangeError('floorDiv domain')
  return a / b
}

export const min = (a: bigint, b: bigint) => (a < b ? a : b)

export interface Weighted { addr: Address; weight: bigint }

/**
 * §1 split rule: every share floors, the remainder goes to the largest weight,
 * ties broken by the lowest address. Returns amounts aligned with `shares`.
 */
export function split(total: bigint, shares: readonly Weighted[]): bigint[] {
  if (shares.length === 0) throw new RangeError('split: no shares')
  let sum = 0n
  for (const s of shares) {
    if (s.weight < 0n) throw new RangeError('split: negative weight')
    sum += s.weight
  }
  if (sum === 0n) throw new RangeError('split: zero total weight')
  const out = shares.map((s) => (total * s.weight) / sum)
  let dust = total
  for (const x of out) dust -= x
  let best = 0
  for (let i = 1; i < shares.length; i++) {
    const a = shares[i]!, b = shares[best]!
    if (a.weight > b.weight || (a.weight === b.weight && BigInt(a.addr) < BigInt(b.addr))) best = i
  }
  out[best]! += dust
  return out
}

/** Interest for the full tenor, rounded up (§9). */
export function interest(principal: bigint, rateBps: bigint, tenorSecs: bigint): bigint {
  return ceilDiv(principal * rateBps * tenorSecs, BPS * YEAR)
}

export function owedFor(principal: bigint, rateBps: bigint, tenorSecs: bigint): bigint {
  return principal + interest(principal, rateBps, tenorSecs)
}

/** Conservative USD (6 dp) value of tETH wei at an 8-dp price (§10.2). */
export function valueUsd(collWei: bigint, price: bigint): bigint {
  return floorDiv(collWei * price, VALUE_SCALE)
}

export function openRatioOk(collWei: bigint, principal: bigint, tier: number, price: bigint): boolean {
  return valueUsd(collWei, price) * BPS >= principal * tierParams(tier).openRatioBps
}

export function isLiquidatable(
  loan: { collateral: bigint; owed: bigint; tierAtOpen: number; maturity: bigint },
  price: bigint, asOf: bigint, grace: bigint,
): boolean {
  return (
    valueUsd(loan.collateral, price) * BPS < loan.owed * tierParams(loan.tierAtOpen).liqRatioBps ||
    asOf > loan.maturity + grace
  )
}

export interface LiquidationAmounts { seized: bigint; fee: bigint; pot: bigint; returned: bigint }

/** §10.4: seize at most owed × 1.10 worth of collateral; 5% fee; rest of seized to lenders. */
export function liquidationAmounts(owed: bigint, collateral: bigint, price: bigint): LiquidationAmounts {
  if (price <= 0n) throw new RangeError('price must be > 0')
  const seizeCap = ceilDiv(owed * (BPS + LIQ_PENALTY_BPS) * VALUE_SCALE, BPS * price)
  const seized = min(collateral, seizeCap)
  const fee = (seized * LIQ_FEE_BPS) / BPS
  return { seized, fee, pot: seized - fee, returned: collateral - seized }
}
