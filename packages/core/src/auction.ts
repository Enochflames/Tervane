// Uniform-price sealed-bid call auction for one tenor. PROTOCOL-SPEC §8.
// Pure: rates are passed in and never leave this function except as the clearing rate r*.

import type { Address } from './types'

export interface LendBid { id: bigint; owner: Address; remaining: bigint; minRate: number }
export interface BorrowBid { id: bigint; owner: Address; remaining: bigint; maxRate: number }

export interface Slice { lendId: bigint; owner: Address; amount: bigint; minRate: number }
export interface Fill { borrowId: bigint; principal: bigint; slices: Slice[] }

export interface AuctionResult {
  /** Fills in processing order (maxRate desc, id asc). Empty when nothing crosses. */
  fills: Fill[]
  /** Highest consumed slice rate; undefined when there are no fills. */
  rStar: number | undefined
}

const byId = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * `eligible(b)` is the §10.2 open-ratio check at the epoch price; an ineligible borrow stays open.
 * Borrows fill whole-or-nothing from the cheapest remaining lend slices with minRate ≤ maxRate.
 */
export function runAuction(
  lends: readonly LendBid[],
  borrows: readonly BorrowBid[],
  eligible: (b: BorrowBid) => boolean = () => true,
): AuctionResult {
  const L = lends.map((l) => ({ ...l })).sort((a, b) => a.minRate - b.minRate || byId(a.id, b.id))
  const B = [...borrows].sort((a, b) => b.maxRate - a.maxRate || byId(a.id, b.id))
  const fills: Fill[] = []
  let rStar: number | undefined

  for (const b of B) {
    if (b.remaining <= 0n || !eligible(b)) continue
    let avail = 0n
    for (const l of L) if (l.minRate <= b.maxRate) avail += l.remaining
    if (avail < b.remaining) continue

    let need = b.remaining
    const slices: Slice[] = []
    for (const l of L) {
      if (need === 0n || l.minRate > b.maxRate) break
      if (l.remaining === 0n) continue
      const x = l.remaining < need ? l.remaining : need
      l.remaining -= x
      need -= x
      slices.push({ lendId: l.id, owner: l.owner, amount: x, minRate: l.minRate })
      if (rStar === undefined || l.minRate > rStar) rStar = l.minRate
    }
    fills.push({ borrowId: b.id, principal: b.remaining, slices })
  }
  return { fills, rStar }
}
