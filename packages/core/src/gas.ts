// Per-epoch write gas limit (D-22). Monad charges the full limit, so size it from the report instead of
// always paying for the worst case. Constants come from CONTRACTS.md §5 measurements (settler config).
import type { SettlementReport } from './types'

export interface WriteGasParams {
  /** Fixed cost: intrinsic 21k + forwarder overhead + _processReport with nothing to do. */
  base: bigint
  perPayout: bigint
  perClear: bigint
  /** Calldata bytes besides the report itself (forwarder metadata + signatures). */
  overheadBytes: bigint
  perByte: bigint
  /** Headroom in bps over the estimate (12_000 = +20%). */
  headroomBps: bigint
  max: bigint
}

export function writeGasLimit(r: SettlementReport, reportBytes: number, p: WriteGasParams): bigint {
  const est = p.base + p.perPayout * BigInt(r.payouts.length) + p.perClear * BigInt(r.clears.length)
    + p.perByte * (p.overheadBytes + BigInt(reportBytes))
  const withHeadroom = (est * p.headroomBps + 9_999n) / 10_000n
  return withHeadroom > p.max ? p.max : withHeadroom
}
