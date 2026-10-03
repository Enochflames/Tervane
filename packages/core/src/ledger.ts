// Ledger state transition. PROTOCOL-SPEC §7, §12 (exact step order), §13 (invariants).
// Pure and deterministic: (prev, inbox, blobs, price, asOf, params) → (state, diff, report).
// Plaintext rates live only in local variables of runEpoch; nothing rate-bearing is returned.

import { bytesToHex, hexToBytes, keccak256 } from 'viem'
import { ZERO32, accStep, decodePayload, msgHash } from './abi'
import { runAuction, type BorrowBid, type LendBid } from './auction'
import type { Decryptor } from './crypto'
import { TervaneError, type IntentCode } from './errors'
import { isLiquidatable, liquidationAmounts, openRatioOk, owedFor, split } from './math'
import { accountLeaf, loanLeaf, merkleRoot, orderLeaf } from './merkle'
import {
  ACTION_BORROW, ACTION_CANCEL, ACTION_LEND, ACTION_REPAY, ASSET_ETH, ASSET_USD, KIND_DEPOSIT, KIND_INTENT,
  KIND_WITHDRAW, MAX_INBOX_PER_EPOCH, MAX_PAYOUTS_PER_EPOCH, MAX_RATE_BPS, PAYLOAD_VERSION, SIDE_BORROW,
  SIDE_LEND, TENORS, TIERS, tenorSeconds, tierCap, tierForVolume,
} from './params'
import type {
  Account, Address, Clear, EpochDiff, Hex, InboxMessage, LedgerState, LenderShare, Loan, Order, Payout,
  SettlementReport,
} from './types'

// ── state helpers ───────────────────────────────────────────

export function genesisState(): LedgerState {
  return { meta: { epoch: 0n, cursor: 0n, nextLoanId: 1n }, accounts: new Map(), orders: new Map(), loans: new Map() }
}

export function newAccount(addr: Address): Account {
  return { addr, usdFree: 0n, usdReserved: 0n, ethFree: 0n, ethReserved: 0n, ethLocked: 0n, tier: 0, repaidVolume: 0n, nonce: 0n }
}

export function cloneState(s: LedgerState): LedgerState {
  const accounts = new Map<Address, Account>()
  for (const [k, a] of s.accounts) accounts.set(k, { ...a })
  const orders = new Map<bigint, Order>()
  for (const [k, o] of s.orders) orders.set(k, { ...o })
  const loans = new Map<bigint, Loan>()
  for (const [k, l] of s.loans) loans.set(k, { ...l, lenders: l.lenders.map((x) => ({ ...x })) })
  return { meta: { ...s.meta }, accounts, orders, loans }
}

const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
const cmpAddr = (a: Address, b: Address) => cmpBig(BigInt(a), BigInt(b))
export const sortedAccounts = (s: LedgerState) => [...s.accounts.values()].sort((a, b) => cmpAddr(a.addr, b.addr))
export const sortedOrders = (s: LedgerState) => [...s.orders.values()].sort((a, b) => cmpBig(a.id, b.id))
export const sortedLoans = (s: LedgerState) => [...s.loans.values()].sort((a, b) => cmpBig(a.id, b.id))

export function totals(s: LedgerState): { usd: bigint; eth: bigint } {
  let usd = 0n, eth = 0n
  for (const a of s.accounts.values()) {
    usd += a.usdFree + a.usdReserved
    eth += a.ethFree + a.ethReserved + a.ethLocked
  }
  return { usd, eth }
}

function outstanding(s: LedgerState, owner: Address): bigint {
  let x = 0n
  for (const l of s.loans.values()) if (l.borrower === owner) x += l.principal
  for (const o of s.orders.values()) if (o.side === SIDE_BORROW && o.owner === owner) x += o.remaining
  return x
}

// ── §4 inbox verification ───────────────────────────────────

/**
 * Checks the server's window `cursor+1 .. to` against onchain accumulators.
 * Returns acc_i for every index in the window (index cursor+1+k at position k).
 */
export function verifyInbox(messages: readonly InboxMessage[], cursor: bigint, to: bigint, accCursor: Hex, accTo: Hex): Hex[] {
  const fail = (d: string): never => { throw new TervaneError('E_INBOX_MISMATCH', d) }
  if (to < cursor || to - cursor > MAX_INBOX_PER_EPOCH) fail('window')
  if (BigInt(messages.length) !== to - cursor) fail('count')
  const accs: Hex[] = []
  let acc = accCursor
  messages.forEach((m, k) => {
    if (m.index !== cursor + 1n + BigInt(k)) fail('gap')
    if (m.kind === KIND_INTENT) {
      if (keccak256(m.blob) !== m.blobHash.toLowerCase()) fail('blob hash')
    } else if (m.kind === KIND_DEPOSIT || m.kind === KIND_WITHDRAW) {
      if (m.blobHash.toLowerCase() !== ZERO32 || m.blob !== '0x') fail('non-intent blob')
    } else fail('kind')
    acc = accStep(acc, msgHash(m))
    accs.push(acc)
  })
  if (acc.toLowerCase() !== accTo.toLowerCase()) fail('acc')
  return accs
}

// ── §12 epoch transition ────────────────────────────────────

export interface EpochParams { grace: bigint }

export interface EpochInput {
  prev: LedgerState
  /** Values read from TervaneCore: stateRoot, cursor, inboxAcc[cursor], inboxAcc[inboxTo]. */
  onchain: { stateRoot: Hex; cursor: bigint; accCursor: Hex; accTo: Hex }
  /** Last index of the server-supplied window. */
  inboxTo: bigint
  messages: readonly InboxMessage[]
  /** Original blob of every open order in `prev`, keyed by order id. */
  openOrderBlobs: ReadonlyMap<bigint, Hex>
  decrypt: Decryptor
  price: bigint
  priceRoundId: bigint
  asOf: bigint
  params: EpochParams
  treasury: Address
  demoMode: boolean
  /** balanceOf(TervaneCore) per asset, for the I1 upper bound. Omit in pure tests. */
  onchainBalances?: { usd: bigint; eth: bigint }
}

/** Counts only — never amounts or rates. Safe to log in debug. */
export interface EpochStats {
  ingested: number
  deposits: number
  withdrawals: number
  intents: number
  rejected: Partial<Record<IntentCode, number>>
  expired: number
  /** Open orders released because their blob no longer decrypts (key rotation). */
  stranded: number
  fills: number
  clears: number
  repays: number
  liquidations: number
}

export interface EpochOutput { state: LedgerState; diff: EpochDiff; report: SettlementReport; stats: EpochStats }

export function runEpoch(input: EpochInput): EpochOutput {
  const { prev, onchain, price, asOf, demoMode, decrypt } = input
  const treasury = input.treasury.toLowerCase() as Address
  if (price <= 0n) throw new TervaneError('E_PRICE', 'non-positive price')

  // 0–1. Verify everything the server supplied against chain commitments.
  const prevRoot = merkleRoot(prev)
  if (prevRoot !== onchain.stateRoot.toLowerCase()) throw new TervaneError('E_ROOT_MISMATCH')
  if (prev.meta.cursor !== onchain.cursor) throw new TervaneError('E_ROOT_MISMATCH', 'cursor')
  const accs = verifyInbox(input.messages, onchain.cursor, input.inboxTo, onchain.accCursor, onchain.accTo)
  for (const o of prev.orders.values()) {
    const blob = input.openOrderBlobs.get(o.id)
    if (!blob || keccak256(blob) !== o.blobHash.toLowerCase()) throw new TervaneError('E_BLOB_MISMATCH', `order ${o.id}`)
  }

  const newEpoch = prev.meta.epoch + 1n
  const s = cloneState(prev)
  const before = totals(prev)
  const deposited = { usd: 0n, eth: 0n }
  const paidOut = { usd: 0n, eth: 0n }
  const payouts: Payout[] = []
  const clears: Clear[] = []
  const rates = new Map<bigint, number>() // order id → decrypted bid/max rate; never leaves this function
  const stats: EpochStats = {
    ingested: 0, deposits: 0, withdrawals: 0, intents: 0, rejected: {}, expired: 0, stranded: 0,
    fills: 0, clears: 0, repays: 0, liquidations: 0,
  }
  const reject = (c: IntentCode) => { stats.rejected[c] = (stats.rejected[c] ?? 0) + 1 }
  const account = (a: Address) => {
    let x = s.accounts.get(a)
    if (!x) s.accounts.set(a, (x = newAccount(a)))
    return x
  }
  const releaseOrder = (o: Order) => {
    const a = account(o.owner)
    if (o.side === SIDE_LEND) { a.usdReserved -= o.remaining; a.usdFree += o.remaining }
    else { a.ethReserved -= o.collateral; a.ethFree += o.collateral }
    s.orders.delete(o.id)
    rates.delete(o.id)
  }

  // 2. Expire orders; release orders whose blob no longer decrypts (enclave key rotated, D-20).
  //    Blob hashes were verified in step 1, so the server cannot strand an order on purpose.
  for (const o of sortedOrders(s)) {
    if (o.expiresAtEpoch !== 0n && o.expiresAtEpoch < newEpoch) { releaseOrder(o); stats.expired++; continue }
    const pt = decrypt(hexToBytes(input.openOrderBlobs.get(o.id)!), o.owner)
    const x = pt && decodePayload(bytesToHex(pt))
    if (!x) { releaseOrder(o); stats.stranded++; continue }
    rates.set(o.id, x.rateBps)
  }

  // 3. Ingest in index order.
  let inboxTo = onchain.cursor
  let inboxAccTo = onchain.accCursor
  for (let k = 0; k < input.messages.length; k++) {
    const m = input.messages[k]!
    const sender = m.sender.toLowerCase() as Address
    if (m.kind === KIND_WITHDRAW && payouts.length >= MAX_PAYOUTS_PER_EPOCH) break

    if (m.kind === KIND_DEPOSIT) {
      stats.deposits++
      if (m.asset === ASSET_USD) { account(sender).usdFree += m.amount; deposited.usd += m.amount }
      else if (m.asset === ASSET_ETH) { account(sender).ethFree += m.amount; deposited.eth += m.amount }
    } else if (m.kind === KIND_WITHDRAW) {
      stats.withdrawals++
      const a = s.accounts.get(sender)
      let paid = 0n
      if (a && m.asset === ASSET_USD) { paid = m.amount < a.usdFree ? m.amount : a.usdFree; a.usdFree -= paid; paidOut.usd += paid }
      else if (a && m.asset === ASSET_ETH) { paid = m.amount < a.ethFree ? m.amount : a.ethFree; a.ethFree -= paid; paidOut.eth += paid }
      payouts.push({ to: sender, asset: m.asset, requested: m.amount, paid })
    } else {
      stats.intents++
      const code = ingestIntent(m, sender)
      if (code) reject(code)
    }
    stats.ingested++
    inboxTo = m.index
    inboxAccTo = accs[k]!
  }

  function ingestIntent(m: InboxMessage, sender: Address): IntentCode | undefined {
    // §5.2 validation order.
    const pt = decrypt(hexToBytes(m.blob), sender)
    if (!pt) return 'E_DECRYPT'
    const x = decodePayload(bytesToHex(pt))
    if (!x || x.version !== PAYLOAD_VERSION || x.action < ACTION_LEND || x.action > ACTION_REPAY) return 'E_BAD_ACTION'
    if (x.nonce <= (s.accounts.get(sender)?.nonce ?? 0n)) return 'E_NONCE'
    const a = account(sender)
    a.nonce = x.nonce

    if (x.action === ACTION_LEND || x.action === ACTION_BORROW) {
      if (tenorSeconds(x.tenorId, demoMode) === undefined) return 'E_TENOR'
      if (x.rateBps < 1 || x.rateBps > MAX_RATE_BPS) return 'E_RATE'
      if (x.amount === 0n || (x.action === ACTION_BORROW && x.collateral === 0n)) return 'E_AMOUNT'
      if (x.expiresAtEpoch !== 0n && x.expiresAtEpoch < newEpoch) return 'E_EXPIRED'
      const order: Order = {
        id: m.index, owner: sender, side: x.action === ACTION_LEND ? SIDE_LEND : SIDE_BORROW, tenorId: x.tenorId,
        remaining: x.amount, collateral: 0n, expiresAtEpoch: x.expiresAtEpoch, blobHash: m.blobHash.toLowerCase() as Hex,
      }
      if (x.action === ACTION_LEND) {
        if (x.amount > a.usdFree) return 'E_BALANCE'
        a.usdFree -= x.amount
        a.usdReserved += x.amount
      } else {
        if (x.collateral > a.ethFree) return 'E_BALANCE'
        if (outstanding(s, sender) + x.amount > tierCap(a.tier, a.repaidVolume)) return 'E_CAP'
        if (!openRatioOk(x.collateral, x.amount, a.tier, price)) return 'E_RATIO'
        a.ethFree -= x.collateral
        a.ethReserved += x.collateral
        order.collateral = x.collateral
      }
      s.orders.set(order.id, order)
      rates.set(order.id, x.rateBps)
      return undefined
    }

    if (x.action === ACTION_CANCEL) {
      const o = s.orders.get(x.refId)
      if (!o) return 'E_NOT_FOUND'
      if (o.owner !== sender) return 'E_NOT_OWNER'
      releaseOrder(o)
      return undefined
    }

    // REPAY (§9, §10.3)
    const l = s.loans.get(x.refId)
    if (!l) return 'E_NOT_FOUND'
    if (l.borrower !== sender) return 'E_NOT_OWNER'
    if (a.usdFree < l.owed) return 'E_BALANCE'
    a.usdFree -= l.owed
    const shares = split(l.owed, l.lenders.map((x) => ({ addr: x.lender, weight: x.amount })))
    l.lenders.forEach((x, i) => { account(x.lender).usdFree += shares[i]! })
    a.ethLocked -= l.collateral
    a.ethFree += l.collateral
    a.repaidVolume += l.principal
    a.tier = Math.max(a.tier, tierForVolume(a.repaidVolume))
    s.loans.delete(l.id)
    stats.repays++
    return undefined
  }

  // 4. Auction per tenor ascending.
  const rateOf = (o: Order): number => {
    const r = rates.get(o.id)
    if (r === undefined) throw new TervaneError('E_INVARIANT', `no rate for order ${o.id}`)
    return r
  }

  for (const t of TENORS) {
    if (t.demoOnly && !demoMode) continue
    const open = sortedOrders(s).filter((o) => o.tenorId === t.id)
    const lendOrders = open.filter((o) => o.side === SIDE_LEND)
    const borrowOrders = open.filter((o) => o.side === SIDE_BORROW)
    if (lendOrders.length === 0 || borrowOrders.length === 0) continue

    const lends: LendBid[] = lendOrders.map((o) => ({ id: o.id, owner: o.owner, remaining: o.remaining, minRate: rateOf(o) }))
    const borrows: BorrowBid[] = borrowOrders.map((o) => ({ id: o.id, owner: o.owner, remaining: o.remaining, maxRate: rateOf(o) }))
    const { fills, rStar } = runAuction(lends, borrows, (b) => {
      const o = s.orders.get(b.id)!
      return openRatioOk(o.collateral, o.remaining, account(o.owner).tier, price)
    })
    if (fills.length === 0 || rStar === undefined) continue

    let volume = 0n
    for (const f of fills) {
      const bo = s.orders.get(f.borrowId)!
      const borrower = account(bo.owner)
      const merged = new Map<Address, bigint>()
      for (const sl of f.slices) {
        const lo = s.orders.get(sl.lendId)!
        account(lo.owner).usdReserved -= sl.amount
        lo.remaining -= sl.amount
        if (lo.remaining === 0n) { s.orders.delete(lo.id); rates.delete(lo.id) }
        merged.set(sl.owner, (merged.get(sl.owner) ?? 0n) + sl.amount)
      }
      const lenders: LenderShare[] = [...merged].map(([lender, amount]) => ({ lender, amount })).sort((a, b) => cmpAddr(a.lender, b.lender))
      const loan: Loan = {
        id: s.meta.nextLoanId, borrower: bo.owner, tenorId: t.id, principal: f.principal, rateBps: rStar,
        owed: owedFor(f.principal, BigInt(rStar), t.seconds), collateral: bo.collateral, tierAtOpen: borrower.tier,
        openedAt: asOf, maturity: asOf + t.seconds, lenders,
      }
      s.meta.nextLoanId += 1n
      s.loans.set(loan.id, loan)
      borrower.usdFree += f.principal
      borrower.ethReserved -= bo.collateral
      borrower.ethLocked += bo.collateral
      s.orders.delete(bo.id)
      rates.delete(bo.id)
      volume += f.principal
      stats.fills++
    }
    clears.push({ tenorId: t.id, rateBps: rStar, volume })
    stats.clears++
  }
  rates.clear()

  // 5. Liquidate (§10.4, §10.3).
  for (const l of sortedLoans(s)) {
    if (!isLiquidatable(l, price, asOf, input.params.grace)) continue
    const { fee, pot, returned } = liquidationAmounts(l.owed, l.collateral, price)
    const b = account(l.borrower)
    b.ethLocked -= l.collateral
    b.ethFree += returned
    if (fee > 0n) account(treasury).ethFree += fee
    const shares = split(pot, l.lenders.map((x) => ({ addr: x.lender, weight: x.amount })))
    l.lenders.forEach((x, i) => { account(x.lender).ethFree += shares[i]! })
    b.tier = Math.max(0, b.tier - 1)
    b.repaidVolume = TIERS[b.tier]!.minRepaid
    s.loans.delete(l.id)
    stats.liquidations++
  }

  // 6–7. Meta, root, diff, report.
  s.meta = { epoch: newEpoch, cursor: inboxTo, nextLoanId: s.meta.nextLoanId }
  const newRoot = merkleRoot(s)

  // 8. Invariants. Any failure aborts the epoch.
  assertInvariants(s, { before, deposited, paidOut, onchainBalances: input.onchainBalances })

  const diff = buildDiff(prev, s, prevRoot, newRoot)
  const report: SettlementReport = {
    epoch: newEpoch, prevRoot, newRoot, inboxTo, inboxAccTo: inboxAccTo.toLowerCase() as Hex, asOf,
    priceRoundId: input.priceRoundId, priceUsed: price, clears, payouts,
  }
  return { state: s, diff, report, stats }
}

// ── §13 invariants ──────────────────────────────────────────

export interface ConservationCtx {
  before: { usd: bigint; eth: bigint }
  deposited: { usd: bigint; eth: bigint }
  paidOut: { usd: bigint; eth: bigint }
  onchainBalances?: { usd: bigint; eth: bigint }
}

/** Throws E_INVARIANT on the first violated invariant (I1–I3, I6). */
export function assertInvariants(s: LedgerState, ctx?: ConservationCtx): void {
  const fail = (d: string): never => { throw new TervaneError('E_INVARIANT', d) }
  // I1 conservation
  const t = totals(s)
  if (ctx) {
    if (t.usd !== ctx.before.usd + ctx.deposited.usd - ctx.paidOut.usd) fail('I1 usd')
    if (t.eth !== ctx.before.eth + ctx.deposited.eth - ctx.paidOut.eth) fail('I1 eth')
    if (ctx.onchainBalances && (t.usd > ctx.onchainBalances.usd || t.eth > ctx.onchainBalances.eth)) fail('I1 balance')
  }
  // I2 reserves match orders/loans; no negative balances
  const lendRes = new Map<Address, bigint>(), borrowRes = new Map<Address, bigint>(), locked = new Map<Address, bigint>()
  const add = (m: Map<Address, bigint>, k: Address, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v)
  for (const o of s.orders.values()) {
    if (o.remaining <= 0n) fail(`I2 empty order ${o.id}`)
    if (!s.accounts.has(o.owner)) fail(`I2 orphan order ${o.id}`)
    if (o.side === SIDE_LEND) add(lendRes, o.owner, o.remaining)
    else if (o.side === SIDE_BORROW) add(borrowRes, o.owner, o.collateral)
    else fail('I2 side')
    // I6: an order must carry no rate field.
    for (const key of Object.keys(o)) if (/rate/i.test(key)) fail('I6 rate field on order')
  }
  for (const l of s.loans.values()) add(locked, l.borrower, l.collateral)
  for (const a of s.accounts.values()) {
    if (a.usdFree < 0n || a.usdReserved < 0n || a.ethFree < 0n || a.ethReserved < 0n || a.ethLocked < 0n) fail('I2 negative')
    if (a.usdReserved !== (lendRes.get(a.addr) ?? 0n)) fail('I2 usdReserved')
    if (a.ethReserved !== (borrowRes.get(a.addr) ?? 0n)) fail('I2 ethReserved')
    if (a.ethLocked !== (locked.get(a.addr) ?? 0n)) fail('I2 ethLocked')
  }
  // I3 loans
  for (const l of s.loans.values()) {
    let sum = 0n
    for (const x of l.lenders) sum += x.amount
    if (sum !== l.principal) fail(`I3 shares ${l.id}`)
    if (l.owed < l.principal) fail(`I3 owed ${l.id}`)
  }
}

// ── §7.4 diff ───────────────────────────────────────────────

export function buildDiff(prev: LedgerState, next: LedgerState, prevRoot: Hex, newRoot: Hex): EpochDiff {
  const upsertAccounts = sortedAccounts(next).filter((a) => {
    const p = prev.accounts.get(a.addr)
    return !p || accountLeaf(p) !== accountLeaf(a)
  })
  const upsertOrders = sortedOrders(next).filter((o) => {
    const p = prev.orders.get(o.id)
    return !p || orderLeaf(p) !== orderLeaf(o)
  })
  const upsertLoans = sortedLoans(next).filter((l) => {
    const p = prev.loans.get(l.id)
    return !p || loanLeaf(p) !== loanLeaf(l)
  })
  const deleteOrders = sortedOrders(prev).filter((o) => !next.orders.has(o.id)).map((o) => o.id)
  const deleteLoans = sortedLoans(prev).filter((l) => !next.loans.has(l.id)).map((l) => l.id)
  return { epoch: next.meta.epoch, prevRoot, newRoot, meta: { ...next.meta }, upsertAccounts, upsertOrders, upsertLoans, deleteOrders, deleteLoans }
}

/** Server side (§7.4): apply a diff to the state at prevRoot and require the result to hash to newRoot. */
export function applyDiff(prev: LedgerState, diff: EpochDiff): LedgerState {
  if (merkleRoot(prev) !== diff.prevRoot.toLowerCase()) throw new TervaneError('E_ROOT_MISMATCH', 'prevRoot')
  const s = cloneState(prev)
  s.meta = { ...diff.meta }
  for (const a of diff.upsertAccounts) s.accounts.set(a.addr, { ...a })
  for (const o of diff.upsertOrders) s.orders.set(o.id, { ...o })
  for (const l of diff.upsertLoans) s.loans.set(l.id, { ...l, lenders: l.lenders.map((x) => ({ ...x })) })
  for (const id of diff.deleteOrders) s.orders.delete(id)
  for (const id of diff.deleteLoans) s.loans.delete(id)
  if (merkleRoot(s) !== diff.newRoot.toLowerCase()) throw new TervaneError('E_ROOT_MISMATCH', 'newRoot')
  return s
}
