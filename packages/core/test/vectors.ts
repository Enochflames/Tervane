// Golden vector builder (PROTOCOL-SPEC §15). Deterministic: fixed test-only keys and IVs, no randomness.
// `bun run vectors` writes these to test/vectors/*.json; vectors.test.ts fails if the files drift.
// Foundry consumes them in Phase 2 (vm.readFile + vm.parseJson). All integers are decimal strings.

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes, keccak256, toHex } from 'viem'
import {
  ACTION_BORROW, ACTION_CANCEL, ACTION_LEND, ACTION_REPAY, KIND_DEPOSIT, KIND_INTENT, KIND_WITHDRAW, ZERO32, accStep,
  accountInner, addr, buildAad, buildLevels, decryptIntent, deriveKey, encodePayload, encodeReport, encryptIntent,
  isLiquidatable, lendersHash, liquidationAmounts, loanInner, metaInner, msgHash, openRatioOk, orderInner, owedFor,
  leafFromInner, proofFromLevels, runAuction, split, genesisState, merkleRoot, stateLeaves, accountLeaf, loanLeaf,
  stateToJson, assertInvariants, type Account, type Hex, type IntentPayload, type LedgerState, type Loan, type Order,
  type SettlementReport,
} from '../src'

const label = (s: string) => hexToBytes(keccak256(toHex(s)))
const NOTE = 'TEST VECTOR ONLY: keys here are public fixtures, never production secrets.'

// Named fixture addresses
export const ADA = addr('0x000000000000000000000000000000000000ada0')
export const BOLA = addr('0x000000000000000000000000000000000000b01a')
export const CHIDI = addr('0x00000000000000000000000000000000000c41d1')
export const DAYO = addr('0x000000000000000000000000000000000000da40')
export const TREASURY = addr('0x0000000000000000000000000000000000007e45')
export const CORE = addr('0x00000000000000000000000000000000000c0e00')
const CHAIN_ID = 10143n

const USD = (n: number) => BigInt(n) * 1_000_000n
const P = (usd: number) => BigInt(usd) * 10n ** 8n

// ── inbox.json ──────────────────────────────────────────────
function inbox() {
  const msgs = [
    { index: 1n, kind: KIND_DEPOSIT, sender: ADA, asset: 0, amount: USD(600), blobHash: ZERO32 },
    { index: 2n, kind: KIND_DEPOSIT, sender: DAYO, asset: 1, amount: 85n * 10n ** 16n, blobHash: ZERO32 },
    { index: 3n, kind: KIND_INTENT, sender: ADA, asset: 0, amount: 0n, blobHash: keccak256(toHex('blob-3')) },
    { index: 4n, kind: KIND_WITHDRAW, sender: ADA, asset: 0, amount: USD(25), blobHash: ZERO32 },
    { index: 5n, kind: KIND_INTENT, sender: DAYO, asset: 0, amount: 0n, blobHash: keccak256(toHex('blob-5')) },
  ]
  let acc: Hex = ZERO32
  return {
    acc0: ZERO32,
    messages: msgs.map((m) => {
      const h = msgHash(m)
      acc = accStep(acc, h)
      return { ...m, msgHash: h, acc }
    }),
  }
}

// ── payload.json ────────────────────────────────────────────
const PAYLOADS: (IntentPayload & { name: string })[] = [
  { name: 'lend', version: 1, action: ACTION_LEND, tenorId: 2, rateBps: 413, nonce: 1n, refId: 0n, expiresAtEpoch: 0n, amount: USD(600), collateral: 0n },
  { name: 'borrow', version: 1, action: ACTION_BORROW, tenorId: 2, rateBps: 552, nonce: 1n, refId: 0n, expiresAtEpoch: 9n, amount: USD(1000), collateral: 85n * 10n ** 16n },
  { name: 'cancel', version: 1, action: ACTION_CANCEL, tenorId: 0, rateBps: 0, nonce: 2n, refId: 6n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n },
  { name: 'repay', version: 1, action: ACTION_REPAY, tenorId: 0, rateBps: 0, nonce: 3n, refId: 1n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n },
]
const payloads = () => ({ payloads: PAYLOADS.map((p) => ({ ...p, encoded: encodePayload(p) })) })

// ── ecies.json ──────────────────────────────────────────────
function ecies() {
  const enclaveSk = label('tervane/vector/enclave-sk')
  const ephSk = label('tervane/vector/eph-sk')
  const iv = hexToBytes('0x000102030405060708090a0b')
  const enclavePk = secp256k1.getPublicKey(enclaveSk, true)
  const ephPk = secp256k1.getPublicKey(ephSk, true)
  const sender = BOLA
  const payload = hexToBytes(encodePayload(PAYLOADS[0]!))
  const ctx = { chainId: CHAIN_ID, core: CORE, sender }
  const blob = encryptIntent(enclavePk, payload, ctx, { ephSk, iv })
  const key = deriveKey(secp256k1.getSharedSecret(ephSk, enclavePk, true), ephPk)
  const tamperedSender = CHIDI
  if (!decryptIntent(enclaveSk, blob, ctx)) throw new Error('vector does not decrypt')
  if (decryptIntent(enclaveSk, blob, { ...ctx, sender: tamperedSender })) throw new Error('tampered vector decrypts')
  return {
    note: NOTE,
    enclaveSk: bytesToHex(enclaveSk), enclavePubKey: bytesToHex(enclavePk), ephSk: bytesToHex(ephSk), ephPubKey: bytesToHex(ephPk),
    iv: bytesToHex(iv), chainId: CHAIN_ID, core: CORE, sender, payload: bytesToHex(payload),
    aad: bytesToHex(buildAad(ctx)), key: bytesToHex(key), blob: bytesToHex(blob), blobHash: keccak256(blob),
    tampered: { sender: tamperedSender, aad: bytesToHex(buildAad({ ...ctx, sender: tamperedSender })), decrypts: false },
  }
}

// ── leaves.json ─────────────────────────────────────────────
const LENDERS3 = [
  { lender: ADA, amount: USD(600) },
  { lender: BOLA, amount: USD(250) },
  { lender: CHIDI, amount: USD(150) },
]
const META = { epoch: 7n, cursor: 42n, nextLoanId: 3n }
const ACCOUNT: Account = {
  addr: DAYO, usdFree: USD(1000), usdReserved: 1n, ethFree: 238_888_275_944_444_444n, ethReserved: 2n, ethLocked: 85n * 10n ** 16n,
  tier: 1, repaidVolume: USD(1000), nonce: 4n,
}
const ORDER: Order = {
  id: 6n, owner: BOLA, side: 1, tenorId: 2, remaining: USD(200), collateral: 0n, expiresAtEpoch: 0n,
  blobHash: keccak256(toHex('order-6-blob')),
}
const LOAN: Loan = {
  id: 1n, borrower: DAYO, tenorId: 2, principal: USD(1000), rateBps: 527, owed: 1_000_001_003n, collateral: 85n * 10n ** 16n,
  tierAtOpen: 0, openedAt: 1_760_000_000n, maturity: 1_760_000_600n, lenders: LENDERS3,
}
function leaves() {
  const one = (inner: Hex) => ({ inner, innerHash: keccak256(inner), leaf: leafFromInner(inner) })
  return {
    meta: { value: META, ...one(metaInner(META)) },
    account: { value: ACCOUNT, ...one(accountInner(ACCOUNT)) },
    order: { value: ORDER, ...one(orderInner(ORDER)) },
    loan: { value: LOAN, ...one(loanInner(LOAN)) },
    lenders3: { value: LENDERS3, lendersHash: lendersHash(LENDERS3) },
  }
}

// ── tree.json ───────────────────────────────────────────────
function tree() {
  return {
    trees: [1, 2, 3, 7, 8].map((n) => {
      const ls = Array.from({ length: n }, (_, i) => keccak256(toHex(`tervane/vector/leaf/${i}`)))
      const levels = buildLevels(ls)
      return {
        n, leaves: ls, sortedLeaves: levels[0]!, root: levels[levels.length - 1]![0]!,
        proofs: ls.map((leaf) => ({ leaf, proof: proofFromLevels(levels, leaf) })),
      }
    }),
  }
}

// ── auction.json ────────────────────────────────────────────
interface BookLend { id: bigint; owner: Hex; minRate: number; remaining: bigint }
interface BookBorrow { id: bigint; owner: Hex; maxRate: number; remaining: bigint; collateral: bigint; tier: number }
interface Book { name: string; price: bigint; tenors: { tenorId: number; lends: BookLend[]; borrows: BookBorrow[] }[] }

const L = (id: number, owner: Hex, minRate: number, remaining: bigint): BookLend => ({ id: BigInt(id), owner, minRate, remaining })
const B = (id: number, owner: Hex, maxRate: number, remaining: bigint, collateral: bigint, tier = 0): BookBorrow =>
  ({ id: BigInt(id), owner, maxRate, remaining, collateral, tier })
const ETH = (x: number) => BigInt(Math.round(x * 100)) * 10n ** 16n

const BOOKS: Book[] = [
  { name: 'demo', price: P(2500), tenors: [{ tenorId: 2,
    lends: [L(5, ADA, 413, USD(600)), L(6, BOLA, 527, USD(600)), L(7, CHIDI, 611, USD(1000))],
    borrows: [B(8, DAYO, 552, USD(1000), ETH(0.85))] }] },
  { name: 'no-cross', price: P(2500), tenors: [{ tenorId: 0,
    lends: [L(1, ADA, 600, USD(500))], borrows: [B(2, DAYO, 599, USD(500), ETH(1))] }] },
  { name: 'exact-cross', price: P(2500), tenors: [{ tenorId: 0,
    lends: [L(1, ADA, 600, USD(500))], borrows: [B(2, DAYO, 600, USD(500), ETH(1))] }] },
  { name: 'whole-or-nothing-skip', price: P(2500), tenors: [{ tenorId: 0,
    lends: [L(1, ADA, 300, USD(100))],
    borrows: [B(2, DAYO, 900, USD(150), ETH(1)), B(3, CHIDI, 400, USD(80), ETH(1))] }] },
  { name: 'ties', price: P(2500), tenors: [{ tenorId: 0,
    lends: [L(4, CHIDI, 300, USD(50)), L(2, ADA, 300, USD(50))],
    borrows: [B(9, DAYO, 500, USD(50), ETH(1)), B(7, BOLA, 500, USD(50), ETH(1))] }] },
  { name: 'multi-tenor', price: P(2500), tenors: [
    { tenorId: 0, lends: [L(1, ADA, 350, USD(300)), L(3, BOLA, 450, USD(300))], borrows: [B(5, DAYO, 500, USD(400), ETH(1))] },
    { tenorId: 1, lends: [L(2, CHIDI, 700, USD(200))], borrows: [B(4, BOLA, 800, USD(200), ETH(1))] },
  ] },
  { name: 'open-ratio-failure', price: P(2500), tenors: [{ tenorId: 0,
    lends: [L(1, ADA, 300, USD(2000))],
    borrows: [B(2, DAYO, 900, USD(1000), ETH(0.79)), B(3, CHIDI, 500, USD(1000), ETH(0.8))] }] },
]

function auction() {
  return {
    books: BOOKS.map((b) => ({
      ...b,
      results: b.tenors.map((t) => {
        const byId = new Map(t.borrows.map((x) => [x.id, x]))
        const r = runAuction(t.lends, t.borrows, (x) => {
          const o = byId.get(x.id)!
          return openRatioOk(o.collateral, o.remaining, o.tier, b.price)
        })
        const tenorSecs = [604_800n, 2_592_000n, 600n][t.tenorId]!
        return {
          tenorId: t.tenorId, cleared: r.rStar !== undefined, rStar: r.rStar ?? 0,
          volume: r.fills.reduce((s, f) => s + f.principal, 0n),
          fills: r.fills.map((f) => ({
            ...f, owed: r.rStar === undefined ? 0n : owedFor(f.principal, BigInt(r.rStar), tenorSecs),
          })),
        }
      }),
    })),
  }
}

// ── liquidation.json ────────────────────────────────────────
const DEMO_LOAN = { ...LOAN, lenders: [{ lender: ADA, amount: USD(600) }, { lender: BOLA, amount: USD(400) }] }
function liquidation() {
  const cases = [
    { name: 'healthy', loan: DEMO_LOAN, price: P(2500), asOf: 1_760_000_030n, grace: 60n },
    { name: 'unhealthy', loan: DEMO_LOAN, price: P(1800), asOf: 1_760_000_030n, grace: 60n },
    { name: 'past-maturity', loan: DEMO_LOAN, price: P(2500), asOf: 1_760_000_661n, grace: 60n },
    { name: 'underwater', loan: DEMO_LOAN, price: P(1000), asOf: 1_760_000_030n, grace: 60n },
  ]
  return {
    treasury: TREASURY,
    cases: cases.map((c) => {
      const liquidatable = isLiquidatable(c.loan, c.price, c.asOf, c.grace)
      const amounts = liquidationAmounts(c.loan.owed, c.loan.collateral, c.price)
      const shares = split(amounts.pot, c.loan.lenders.map((x) => ({ addr: x.lender, weight: x.amount })))
      return {
        ...c, liquidatable, ...amounts,
        lenderPayouts: c.loan.lenders.map((x, i) => ({ lender: x.lender, amount: shares[i]! })),
      }
    }),
    splits: [
      { total: 10n, shares: [{ addr: BOLA, weight: 1n }, { addr: ADA, weight: 2n }] },
      { total: 10n, shares: [{ addr: CHIDI, weight: 1n }, { addr: ADA, weight: 1n }, { addr: BOLA, weight: 1n }] },
      { total: 1_000_001_003n, shares: [{ addr: ADA, weight: USD(600) }, { addr: BOLA, weight: USD(400) }] },
    ].map((x) => ({ ...x, amounts: split(x.total, x.shares) })),
  }
}

// ── report.json ─────────────────────────────────────────────
function report() {
  const r: SettlementReport = {
    epoch: 2n, prevRoot: keccak256(toHex('tervane/vector/prev-root')), newRoot: keccak256(toHex('tervane/vector/new-root')),
    inboxTo: 11n, inboxAccTo: keccak256(toHex('tervane/vector/acc-11')), asOf: 1_760_000_030n, priceRoundId: 2n, priceUsed: P(1800),
    clears: [{ tenorId: 0, rateBps: 350, volume: USD(400) }, { tenorId: 2, rateBps: 527, volume: USD(1000) }],
    payouts: [
      { to: ADA, asset: 0, requested: USD(25), paid: USD(10) },
      { to: DAYO, asset: 1, requested: 238_888_275_944_444_444n, paid: 238_888_275_944_444_444n },
    ],
  }
  return { reportVersion: 1, report: r, encoded: encodeReport(r) }
}

// ── genesis.json ────────────────────────────────────────────
function genesis() {
  const s = genesisState()
  return { meta: s.meta, root: merkleRoot(s) }
}

// ── escape.json ─────────────────────────────────────────────
/** The demo ledger after epoch 1 (DEMO-SCRIPT §2) with fixed blob hashes, plus root and per-leaf proofs. */
function escape() {
  const acct = (addr: Hex, x: Partial<Account>): Account => ({
    addr, usdFree: 0n, usdReserved: 0n, ethFree: 0n, ethReserved: 0n, ethLocked: 0n, tier: 0, repaidVolume: 0n, nonce: 1n, ...x,
  })
  const s: LedgerState = {
    meta: { epoch: 1n, cursor: 8n, nextLoanId: 2n },
    accounts: new Map([
      [ADA, acct(ADA, {})],
      [BOLA, acct(BOLA, { usdReserved: USD(200) })],
      [CHIDI, acct(CHIDI, { usdReserved: USD(1000) })],
      [DAYO, acct(DAYO, { usdFree: USD(1000), ethLocked: 85n * 10n ** 16n })],
    ]),
    orders: new Map([
      [6n, { id: 6n, owner: BOLA, side: 1, tenorId: 2, remaining: USD(200), collateral: 0n, expiresAtEpoch: 0n, blobHash: keccak256(toHex('escape/order-6')) }],
      [7n, { id: 7n, owner: CHIDI, side: 1, tenorId: 2, remaining: USD(1000), collateral: 0n, expiresAtEpoch: 0n, blobHash: keccak256(toHex('escape/order-7')) }],
    ]),
    loans: new Map([[1n, { ...DEMO_LOAN }]]),
  }
  assertInvariants(s)
  const levels = buildLevels(stateLeaves(s))
  const deposits = [
    { sender: ADA, asset: 0, amount: USD(600) }, { sender: BOLA, asset: 0, amount: USD(600) },
    { sender: CHIDI, asset: 0, amount: USD(1000) }, { sender: DAYO, asset: 1, amount: 85n * 10n ** 16n },
  ]
  return {
    note: 'Ledger matching the demo after epoch 1. Foundry funds TervaneCore with `deposits`, settles epoch 1 to `root`, then exercises the escape hatch.',
    deposits, root: merkleRoot(s), state: stateToJson(s),
    accounts: [...s.accounts.values()].map((a) => ({ account: a, leaf: accountLeaf(a), proof: proofFromLevels(levels, accountLeaf(a)) })),
    loans: [...s.loans.values()].map((l) => ({
      loan: { ...l, lenders: undefined, lendersHash: lendersHash(l.lenders) }, lenders: l.lenders,
      leaf: loanLeaf(l), proof: proofFromLevels(levels, loanLeaf(l)),
    })),
  }
}

export const VECTORS = { inbox, payload: payloads, ecies, leaves, tree, auction, liquidation, report, genesis, escape } as const

/** JSON with bigints as decimal strings, stable 2-space formatting. */
export function toJson(v: unknown): string {
  return `${JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString(10) : x), 2)}\n`
}
