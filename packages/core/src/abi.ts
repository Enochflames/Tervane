// ABI encodings. PROTOCOL-SPEC §4 (inbox), §5.1 (payload), §7.2 (leaves), §11 (report).
// Every function here has a golden vector consumed by Foundry (§15).

import { concat, decodeAbiParameters, encodeAbiParameters, keccak256, size, type AbiParameter } from 'viem'
import { PAYLOAD_LEN, REPORT_VERSION } from './params'
import type { Account, Address, Hex, InboxMessage, IntentPayload, LenderShare, Loan, Meta, Order, SettlementReport } from './types'

export const ZERO32: Hex = `0x${'00'.repeat(32)}`

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
/** Canonical lowercase address; throws on malformed input. */
export function addr(a: string): Address {
  if (!ADDR_RE.test(a)) throw new TypeError('malformed address')
  return a.toLowerCase() as Address
}

const p = (type: string, name?: string): AbiParameter => ({ type, name })

// ── §4 inbox ────────────────────────────────────────────────

const MSG_PARAMS = [p('uint64'), p('uint8'), p('address'), p('uint8'), p('uint256'), p('bytes32')]

export function msgHash(m: Pick<InboxMessage, 'index' | 'kind' | 'sender' | 'asset' | 'amount' | 'blobHash'>): Hex {
  return keccak256(encodeAbiParameters(MSG_PARAMS, [m.index, m.kind, m.sender, m.asset, m.amount, m.blobHash]))
}

export function accStep(prevAcc: Hex, mHash: Hex): Hex {
  return keccak256(concat([prevAcc, mHash]))
}

// ── §5.1 payload ────────────────────────────────────────────

const PAYLOAD_PARAMS = [
  p('uint8', 'version'), p('uint8', 'action'), p('uint8', 'tenorId'), p('uint32', 'rateBps'),
  p('uint64', 'nonce'), p('uint64', 'refId'), p('uint64', 'expiresAtEpoch'),
  p('uint256', 'amount'), p('uint256', 'collateral'),
]

export function encodePayload(x: IntentPayload): Hex {
  return encodeAbiParameters(PAYLOAD_PARAMS, [
    x.version, x.action, x.tenorId, x.rateBps, x.nonce, x.refId, x.expiresAtEpoch, x.amount, x.collateral,
  ])
}

/** Returns null for anything that is not a well-formed 288-byte payload (out-of-range words included). */
export function decodePayload(data: Hex): IntentPayload | null {
  if (size(data) !== PAYLOAD_LEN) return null
  try {
    const [version, action, tenorId, rateBps, nonce, refId, expiresAtEpoch, amount, collateral] =
      decodeAbiParameters(PAYLOAD_PARAMS, data) as [number, number, number, number, bigint, bigint, bigint, bigint, bigint]
    return { version, action, tenorId, rateBps, nonce, refId, expiresAtEpoch, amount, collateral }
  } catch {
    return null
  }
}

// ── §7.2 leaves ─────────────────────────────────────────────

export function metaInner(m: Meta): Hex {
  return encodeAbiParameters([p('uint8'), p('uint64'), p('uint64'), p('uint64')], [0, m.epoch, m.cursor, m.nextLoanId])
}

export function accountInner(a: Account): Hex {
  return encodeAbiParameters(
    [p('uint8'), p('address'), p('uint256'), p('uint256'), p('uint256'), p('uint256'), p('uint256'), p('uint8'), p('uint256'), p('uint64')],
    [1, a.addr, a.usdFree, a.usdReserved, a.ethFree, a.ethReserved, a.ethLocked, a.tier, a.repaidVolume, a.nonce],
  )
}

export function orderInner(o: Order): Hex {
  return encodeAbiParameters(
    [p('uint8'), p('uint64'), p('address'), p('uint8'), p('uint8'), p('uint256'), p('uint256'), p('uint64'), p('bytes32')],
    [2, o.id, o.owner, o.side, o.tenorId, o.remaining, o.collateral, o.expiresAtEpoch, o.blobHash],
  )
}

const LENDERS_PARAM: AbiParameter = {
  type: 'tuple[]',
  components: [p('address', 'lender'), p('uint256', 'amount')],
}

export function lendersHash(lenders: readonly LenderShare[]): Hex {
  return keccak256(encodeAbiParameters([LENDERS_PARAM], [lenders.map((s) => ({ lender: s.lender, amount: s.amount }))]))
}

export function loanInner(l: Loan): Hex {
  return encodeAbiParameters(
    [p('uint8'), p('uint64'), p('address'), p('uint8'), p('uint256'), p('uint32'), p('uint256'), p('uint256'), p('uint8'), p('uint64'), p('uint64'), p('bytes32')],
    [3, l.id, l.borrower, l.tenorId, l.principal, l.rateBps, l.owed, l.collateral, l.tierAtOpen, l.openedAt, l.maturity, lendersHash(l.lenders)],
  )
}

/** OpenZeppelin double-hash leaf: keccak(bytes.concat(keccak(inner))). */
export function leafFromInner(inner: Hex): Hex {
  return keccak256(keccak256(inner))
}

// ── §11 report ──────────────────────────────────────────────

const REPORT_PARAMS: readonly AbiParameter[] = [
  p('uint8', 'reportVersion'),
  {
    type: 'tuple',
    name: 'report',
    components: [
      p('uint64', 'epoch'), p('bytes32', 'prevRoot'), p('bytes32', 'newRoot'), p('uint64', 'inboxTo'),
      p('bytes32', 'inboxAccTo'), p('uint64', 'asOf'), p('uint80', 'priceRoundId'), p('int256', 'priceUsed'),
      { type: 'tuple[]', name: 'clears', components: [p('uint8', 'tenorId'), p('uint32', 'rateBps'), p('uint256', 'volume')] },
      {
        type: 'tuple[]', name: 'payouts',
        components: [p('address', 'to'), p('uint8', 'asset'), p('uint256', 'requested'), p('uint256', 'paid')],
      },
    ],
  },
]

export function encodeReport(r: SettlementReport): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [REPORT_VERSION, r])
}

export function decodeReport(data: Hex): SettlementReport {
  const [version, r] = decodeAbiParameters(REPORT_PARAMS, data) as [number, SettlementReport]
  if (version !== REPORT_VERSION) throw new TypeError('unknown report version')
  return {
    ...r,
    prevRoot: r.prevRoot.toLowerCase() as Hex,
    newRoot: r.newRoot.toLowerCase() as Hex,
    inboxAccTo: r.inboxAccTo.toLowerCase() as Hex,
    clears: r.clears.map((c) => ({ tenorId: c.tenorId, rateBps: c.rateBps, volume: c.volume })),
    payouts: r.payouts.map((x) => ({ to: addr(x.to), asset: x.asset, requested: x.requested, paid: x.paid })),
  }
}
