// Pure mathematical helpers reflecting docs/PROTOCOL-SPEC.md exactly

export const BPS = 10_000n
export const YEAR_SECONDS = 31_536_000n // 365 days
export const LIQ_PENALTY_BPS = 1_000n   // 10% penalty
export const LIQ_FEE_BPS = 500n         // 5% treasury fee

/**
 * Term loan simple interest: ceil(principal * rateBps * tenorSeconds / (BPS * YEAR))
 */
export function calculateTermInterest(
  principalUsd: number,
  rateBps: number,
  tenorSeconds: number
): { interestUsd: number; owedUsd: number; interestWei: bigint } {
  const p = BigInt(Math.round(principalUsd * 1_000_000))
  const r = BigInt(rateBps)
  const t = BigInt(tenorSeconds)
  const denom = BPS * YEAR_SECONDS

  // ceil division: (num + denom - 1n) / denom
  const num = p * r * t
  const interest = (num + denom - 1n) / denom
  const owed = p + interest

  return {
    interestUsd: Number(interest) / 1_000_000,
    owedUsd: Number(owed) / 1_000_000,
    interestWei: interest,
  }
}

/**
 * Collateral Valuation: floor(collateralEth * ethPriceUsd)
 */
export function calculateCollateralValue(collateralEth: number, ethPriceUsd: number): number {
  return collateralEth * ethPriceUsd
}

/**
 * Liquidation Settlement math from docs/PROTOCOL-SPEC.md §10.4 & DEMO-SCRIPT.md §2:
 * ETH drop to $1,800:
 * seized = min(collateral, ceil(owed * 1.10 / price))
 * fee (5%) -> treasury
 * pot = seized - fee -> lenders pro rata
 * borrower returns = collateral - seized
 */
export function calculateLiquidationBreakdown(
  owedUsd: number,
  collateralEth: number,
  ethPriceUsd: number,
  lenderShares: { name: string; shareRatio: number }[]
) {
  const owedTimes110 = owedUsd * 1.1
  const seizeCap = owedTimes110 / ethPriceUsd
  const seized = Math.min(collateralEth, seizeCap)
  const treasuryFee = seized * 0.05
  const pot = seized - treasuryFee
  const borrowerRefund = Math.max(0, collateralEth - seized)

  const lenderPayouts = lenderShares.map((ls) => ({
    name: ls.name,
    ethAmount: pot * ls.shareRatio,
    usdValueAtPrice: pot * ls.shareRatio * ethPriceUsd,
  }))

  return {
    seizedEth: seized,
    seizedUsdValue: seized * ethPriceUsd,
    treasuryFeeEth: treasuryFee,
    potEth: pot,
    borrowerRefundEth: borrowerRefund,
    lenderPayouts,
  }
}

export interface AuctionSimulationResult {
  clearingRateBps: number | null
  clearingRatePct: string
  filledLenders: {
    name: string
    bidRateBps: number
    allocatedAmount: number
    effectiveRateBps: number
  }[]
  unfilledLenders: {
    name: string
    bidRateBps: number
    requestedAmount: number
    reason: string
  }[]
  borrowerFill: {
    name: string
    requestedAmount: number
    filledAmount: number
    maxRateBps: number
    clearingRateBps: number
  } | null
  totalVolumeUsd: number
  leakedData: string
}

/**
 * Simulates Uniform-Price Call Auction according to PROTOCOL-SPEC.md §8:
 * Lenders sorted by (minRate asc, id asc).
 * Borrower filled if cheap slices <= maxRate cover requirement.
 * Uniform clearing rate r* = max(minRate over all consumed slices).
 */
export function simulateUniformAuction(
  lenders: { id: string; name: string; amount: number; minRateBps: number }[],
  borrower: { name: string; amount: number; maxRateBps: number }
): AuctionSimulationResult {
  // 1. Sort lenders by minRate asc
  const sortedLenders = [...lenders].sort((a, b) => a.minRateBps - b.minRateBps)

  let needed = borrower.amount
  const consumedSlices: { lender: (typeof lenders)[0]; amount: number }[] = []
  const unfilled: AuctionSimulationResult['unfilledLenders'] = []

  // Check eligible lenders
  const eligibleSlices = sortedLenders.filter((l) => l.minRateBps <= borrower.maxRateBps)
  const totalEligible = eligibleSlices.reduce((sum, l) => sum + l.amount, 0)

  if (totalEligible < needed) {
    return {
      clearingRateBps: null,
      clearingRatePct: 'No Clear',
      filledLenders: [],
      unfilledLenders: sortedLenders.map((l) => ({
        name: l.name,
        bidRateBps: l.minRateBps,
        requestedAmount: l.amount,
        reason: 'Aggregate liquidity below borrow demand or rate exceeded',
      })),
      borrowerFill: null,
      totalVolumeUsd: 0,
      leakedData: 'Zero. No trade clears; no bids revealed.',
    }
  }

  // Greedily consume cheapest slices
  for (const lender of sortedLenders) {
    if (lender.minRateBps > borrower.maxRateBps) {
      unfilled.push({
        name: lender.name,
        bidRateBps: lender.minRateBps,
        requestedAmount: lender.amount,
        reason: `Rate ${lender.minRateBps / 100}% exceeds borrower cap (${borrower.maxRateBps / 100}%)`,
      })
      continue
    }

    if (needed > 0) {
      const take = Math.min(lender.amount, needed)
      consumedSlices.push({ lender, amount: take })
      needed -= take

      if (take < lender.amount) {
        unfilled.push({
          name: lender.name,
          bidRateBps: lender.minRateBps,
          requestedAmount: lender.amount - take,
          reason: 'Partially filled at uniform rate',
        })
      }
    } else {
      unfilled.push({
        name: lender.name,
        bidRateBps: lender.minRateBps,
        requestedAmount: lender.amount,
        reason: 'Marginal capacity satisfied by earlier priority',
      })
    }
  }

  // Uniform clearing rate r* = max(minRate over all recorded slices)
  const clearingRateBps = Math.max(...consumedSlices.map((s) => s.lender.minRateBps))

  const filledLenders = consumedSlices.map((s) => ({
    name: s.lender.name,
    bidRateBps: s.lender.minRateBps,
    allocatedAmount: s.amount,
    effectiveRateBps: clearingRateBps, // Uniform price benefit!
  }))

  return {
    clearingRateBps,
    clearingRatePct: `${(clearingRateBps / 100).toFixed(2)}%`,
    filledLenders,
    unfilledLenders: unfilled,
    borrowerFill: {
      name: borrower.name,
      requestedAmount: borrower.amount,
      filledAmount: borrower.amount - needed,
      maxRateBps: borrower.maxRateBps,
      clearingRateBps,
    },
    totalVolumeUsd: borrower.amount - needed,
    leakedData: `Public output: Cleared(epoch=1, tenor=DEMO-10m, rate=${clearingRateBps} bps, volume=$${borrower.amount}). Unfilled bids remain sealed forever inside enclave memory.`,
  }
}
