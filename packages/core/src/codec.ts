// JSON wire codecs (PROTOCOL-SPEC §7.4, CRE-WORKFLOW §5): every bigint is a decimal string.
// Decoders validate shape strictly and throw E_DECODE; they never echo input values in errors.

import { addr } from './abi'
import { TervaneError } from './errors'
import type { Account, EpochDiff, Hex, InboxMessage, LedgerState, LenderShare, Loan, Meta, Order } from './types'

type J = Record<string, unknown>
const bad = (what: string): never => { throw new TervaneError('E_DECODE', what) }
const obj = (v: unknown, w: string): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : bad(w))
const arr = (v: unknown, w: string): unknown[] => (Array.isArray(v) ? v : bad(w))
const big = (v: unknown, w: string): bigint => (typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : bad(w))
const int = (v: unknown, w: string): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : bad(w))
const hex = (v: unknown, w: string, bytes?: number): Hex =>
  typeof v === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(v) && (bytes === undefined || v.length === 2 + bytes * 2)
    ? (v.toLowerCase() as Hex) : bad(w)
const address = (v: unknown, w: string) => { try { return addr(String(v)) } catch { return bad(w) } }
const str = (x: bigint) => x.toString(10)

// ── encoders ────────────────────────────────────────────────

export const metaToJson = (m: Meta) => ({ epoch: str(m.epoch), cursor: str(m.cursor), nextLoanId: str(m.nextLoanId) })
export const accountToJson = (a: Account) => ({
  addr: a.addr, usdFree: str(a.usdFree), usdReserved: str(a.usdReserved), ethFree: str(a.ethFree),
  ethReserved: str(a.ethReserved), ethLocked: str(a.ethLocked), tier: a.tier, repaidVolume: str(a.repaidVolume), nonce: str(a.nonce),
})
export const orderToJson = (o: Order) => ({
  id: str(o.id), owner: o.owner, side: o.side, tenorId: o.tenorId, remaining: str(o.remaining),
  collateral: str(o.collateral), expiresAtEpoch: str(o.expiresAtEpoch), blobHash: o.blobHash,
})
export const loanToJson = (l: Loan) => ({
  id: str(l.id), borrower: l.borrower, tenorId: l.tenorId, principal: str(l.principal), rateBps: l.rateBps,
  owed: str(l.owed), collateral: str(l.collateral), tierAtOpen: l.tierAtOpen, openedAt: str(l.openedAt),
  maturity: str(l.maturity), lenders: l.lenders.map((x) => ({ lender: x.lender, amount: str(x.amount) })),
})

const byAddr = (a: Account, b: Account) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1)
const byId = (a: { id: bigint }, b: { id: bigint }) => (a.id < b.id ? -1 : 1)

/** Canonical JSON object for a ledger state (sorted), suitable for the server and fixtures. */
export function stateToJson(s: LedgerState) {
  return {
    meta: metaToJson(s.meta),
    accounts: [...s.accounts.values()].sort(byAddr).map(accountToJson),
    orders: [...s.orders.values()].sort(byId).map(orderToJson),
    loans: [...s.loans.values()].sort(byId).map(loanToJson),
  }
}

export function diffToJson(d: EpochDiff) {
  return {
    epoch: str(d.epoch), prevRoot: d.prevRoot, newRoot: d.newRoot, meta: metaToJson(d.meta),
    upsertAccounts: d.upsertAccounts.map(accountToJson), upsertOrders: d.upsertOrders.map(orderToJson),
    upsertLoans: d.upsertLoans.map(loanToJson), deleteOrders: d.deleteOrders.map(str), deleteLoans: d.deleteLoans.map(str),
  }
}

export const encodeEpochDiff = (d: EpochDiff): string => JSON.stringify(diffToJson(d))
export const encodeState = (s: LedgerState): string => JSON.stringify(stateToJson(s))

export function messageToJson(m: InboxMessage) {
  return { index: str(m.index), kind: m.kind, sender: m.sender, asset: m.asset, amount: str(m.amount), blobHash: m.blobHash, blob: m.blob }
}

// ── decoders ────────────────────────────────────────────────

export function metaFromJson(v: unknown): Meta {
  const o = obj(v, 'meta')
  return { epoch: big(o.epoch, 'meta.epoch'), cursor: big(o.cursor, 'meta.cursor'), nextLoanId: big(o.nextLoanId, 'meta.nextLoanId') }
}

export function accountFromJson(v: unknown): Account {
  const o = obj(v, 'account')
  return {
    addr: address(o.addr, 'account.addr'), usdFree: big(o.usdFree, 'account.usdFree'), usdReserved: big(o.usdReserved, 'account.usdReserved'),
    ethFree: big(o.ethFree, 'account.ethFree'), ethReserved: big(o.ethReserved, 'account.ethReserved'),
    ethLocked: big(o.ethLocked, 'account.ethLocked'), tier: int(o.tier, 'account.tier'),
    repaidVolume: big(o.repaidVolume, 'account.repaidVolume'), nonce: big(o.nonce, 'account.nonce'),
  }
}

export function orderFromJson(v: unknown): Order {
  const o = obj(v, 'order')
  return {
    id: big(o.id, 'order.id'), owner: address(o.owner, 'order.owner'), side: int(o.side, 'order.side'),
    tenorId: int(o.tenorId, 'order.tenorId'), remaining: big(o.remaining, 'order.remaining'),
    collateral: big(o.collateral, 'order.collateral'), expiresAtEpoch: big(o.expiresAtEpoch, 'order.expiresAtEpoch'),
    blobHash: hex(o.blobHash, 'order.blobHash', 32),
  }
}

export function loanFromJson(v: unknown): Loan {
  const o = obj(v, 'loan')
  return {
    id: big(o.id, 'loan.id'), borrower: address(o.borrower, 'loan.borrower'), tenorId: int(o.tenorId, 'loan.tenorId'),
    principal: big(o.principal, 'loan.principal'), rateBps: int(o.rateBps, 'loan.rateBps'), owed: big(o.owed, 'loan.owed'),
    collateral: big(o.collateral, 'loan.collateral'), tierAtOpen: int(o.tierAtOpen, 'loan.tierAtOpen'),
    openedAt: big(o.openedAt, 'loan.openedAt'), maturity: big(o.maturity, 'loan.maturity'),
    lenders: arr(o.lenders, 'loan.lenders').map((x): LenderShare => {
      const s = obj(x, 'lender')
      return { lender: address(s.lender, 'lender.lender'), amount: big(s.amount, 'lender.amount') }
    }),
  }
}

export function stateFromJson(v: unknown): LedgerState {
  const o = obj(v, 'state')
  const s: LedgerState = { meta: metaFromJson(o.meta), accounts: new Map(), orders: new Map(), loans: new Map() }
  for (const a of arr(o.accounts, 'accounts').map(accountFromJson)) {
    if (s.accounts.has(a.addr)) bad('duplicate account')
    s.accounts.set(a.addr, a)
  }
  for (const x of arr(o.orders, 'orders').map(orderFromJson)) {
    if (s.orders.has(x.id)) bad('duplicate order')
    s.orders.set(x.id, x)
  }
  for (const l of arr(o.loans, 'loans').map(loanFromJson)) {
    if (s.loans.has(l.id)) bad('duplicate loan')
    s.loans.set(l.id, l)
  }
  return s
}

export function diffFromJson(v: unknown): EpochDiff {
  const o = obj(v, 'diff')
  return {
    epoch: big(o.epoch, 'diff.epoch'), prevRoot: hex(o.prevRoot, 'diff.prevRoot', 32), newRoot: hex(o.newRoot, 'diff.newRoot', 32),
    meta: metaFromJson(o.meta), upsertAccounts: arr(o.upsertAccounts, 'upsertAccounts').map(accountFromJson),
    upsertOrders: arr(o.upsertOrders, 'upsertOrders').map(orderFromJson), upsertLoans: arr(o.upsertLoans, 'upsertLoans').map(loanFromJson),
    deleteOrders: arr(o.deleteOrders, 'deleteOrders').map((x) => big(x, 'deleteOrders')),
    deleteLoans: arr(o.deleteLoans, 'deleteLoans').map((x) => big(x, 'deleteLoans')),
  }
}

export function messageFromJson(v: unknown): InboxMessage {
  const o = obj(v, 'message')
  return {
    index: big(o.index, 'msg.index'), kind: int(o.kind, 'msg.kind'), sender: address(o.sender, 'msg.sender'),
    asset: int(o.asset, 'msg.asset'), amount: big(o.amount, 'msg.amount'), blobHash: hex(o.blobHash, 'msg.blobHash', 32),
    blob: hex(o.blob, 'msg.blob'),
  }
}

export interface EpochInputJson {
  prev: LedgerState
  inboxTo: bigint
  messages: InboxMessage[]
  openOrderBlobs: Map<bigint, Hex>
}

/** Decodes the server's `GET /internal/epoch-input` body (CRE-WORKFLOW §5). */
export function decodeEpochInput(text: string): EpochInputJson {
  let v: unknown
  try { v = JSON.parse(text) } catch { return bad('json') }
  const o = obj(v, 'epoch-input')
  const blobs = obj(o.openOrderBlobs, 'openOrderBlobs')
  const openOrderBlobs = new Map<bigint, Hex>()
  for (const [k, b] of Object.entries(blobs)) openOrderBlobs.set(big(k, 'blob id'), hex(b, 'blob'))
  return {
    prev: stateFromJson(o.prev), inboxTo: big(o.inboxTo, 'inboxTo'),
    messages: arr(o.messages, 'messages').map(messageFromJson), openOrderBlobs,
  }
}

export const decodeEpochDiff = (text: string): EpochDiff => {
  let v: unknown
  try { v = JSON.parse(text) } catch { return bad('json') }
  return diffFromJson(v)
}
