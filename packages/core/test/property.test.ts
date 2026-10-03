import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  ACTION_BORROW, ACTION_CANCEL, ACTION_REPAY, ASSET_ETH, ASSET_USD, assertInvariants, encodeEpochDiff, encodeReport,
  runAuction, totals, type EpochOutput,
} from '../src'
import { A, Harness, lend, payload } from './harness'

const RUNS = Number(process.env.PROPERTY_RUNS ?? 10_000)
const TIMEOUT = 30 * 60_000
const USERS = [A(1), A(2), A(3), A(4)]
const PRICES = [1500n, 2000n, 2500n, 3000n].map((p) => p * 10n ** 8n)

type Cmd =
  | { t: 'dep'; u: number; asset: number; amt: bigint }
  | { t: 'wd'; u: number; asset: number; amt: bigint }
  | { t: 'lend'; u: number; tenor: number; rate: number; amt: bigint; exp: number; stale: boolean; fund: boolean }
  | { t: 'borrow'; u: number; tenor: number; rate: number; amt: bigint; ratioBps: bigint; fund: boolean }
  | { t: 'cancel'; u: number; ref: number }
  | { t: 'repay'; u: number; ref: number; asBorrower: boolean; fund: boolean }
  | { t: 'junk'; u: number }
  | { t: 'settle'; price: number; dt: number }

const u = fc.nat({ max: USERS.length - 1 })
const usd = fc.oneof(
  { weight: 6, arbitrary: fc.bigInt({ min: 1n, max: 1500n }).map((x) => x * 1_000_000n) },
  { weight: 1, arbitrary: fc.bigInt({ min: 0n, max: 3000n }).map((x) => x * 1_000_000n + 1n) },
  { weight: 1, arbitrary: fc.bigInt({ min: 0n, max: 2_000n }) },
)
const eth = fc.oneof(fc.bigInt({ min: 0n, max: 300n }).map((x) => x * 10n ** 16n), fc.bigInt({ min: 0n, max: 10n ** 6n }))
const rate = fc.oneof({ weight: 12, arbitrary: fc.integer({ min: 300, max: 700 }) }, { weight: 1, arbitrary: fc.constantFrom(0, 1, 10_000, 10_001) })
const tenor = fc.oneof({ weight: 10, arbitrary: fc.constantFrom(0, 2) }, { weight: 1, arbitrary: fc.constantFrom(1, 3) })
const funded = fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) })
const ratio = fc.bigInt({ min: 15_000n, max: 40_000n }) // collateral value / principal at $2,500, in bps

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ t: fc.constant('dep' as const), u, asset: fc.constantFrom(ASSET_USD, ASSET_ETH), amt: fc.oneof(usd, eth) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('wd' as const), u, asset: fc.constantFrom(ASSET_USD, ASSET_ETH, 7), amt: fc.oneof(usd, eth) }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('lend' as const), u, tenor, rate, amt: usd, exp: fc.integer({ min: 0, max: 4 }), stale: fc.boolean(), fund: funded }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('borrow' as const), u, tenor, rate, amt: usd, ratioBps: ratio, fund: funded }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('cancel' as const), u, ref: fc.nat({ max: 60 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('repay' as const), u, ref: fc.nat({ max: 8 }), asBorrower: funded, fund: funded }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('junk' as const), u }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('settle' as const), price: fc.nat({ max: PRICES.length - 1 }), dt: fc.constantFrom(30, 300, 700) }) },
)
const program = fc.array(cmd, { minLength: 1, maxLength: 60, size: 'large' })

interface Run { outs: EpochOutput[]; h: Harness; deposited: { usd: bigint; eth: bigint } }

/** Plays a program; checks I1–I3 independently after every epoch. */
function play(cmds: Cmd[], shuffle?: (n: number) => number): Run {
  const h = new Harness()
  const nonce = USERS.map(() => 0n)
  const deposited = { usd: 0n, eth: 0n }, paid = { usd: 0n, eth: 0n }
  let asOf = 1_760_000_000n
  const next = (i: number, stale: boolean) => (stale && nonce[i]! > 0n ? nonce[i]! : (nonce[i] = nonce[i]! + 1n))
  const settle = (price: bigint) => {
    const out = h.settle({ price, asOf, shuffle })
    for (const p of out.report.payouts) {
      if (p.asset === ASSET_USD) paid.usd += p.paid
      if (p.asset === ASSET_ETH) paid.eth += p.paid
      expect(p.paid <= p.requested).toBe(true)
    }
    assertInvariants(out.state) // I2, I3, I6
    const t = totals(out.state)   // I1
    expect(t.usd).toBe(deposited.usd - paid.usd)
    expect(t.eth).toBe(deposited.eth - paid.eth)
    return out
  }
  const outs: EpochOutput[] = []
  for (const c of [...cmds, { t: 'settle', price: 2, dt: 30 } as const]) {
    const who = USERS[c.t === 'settle' ? 0 : c.u]!
    switch (c.t) {
      case 'dep':
        h.deposit(who, c.asset, c.amt)
        if (c.asset === ASSET_USD) deposited.usd += c.amt; else deposited.eth += c.amt
        break
      case 'wd': h.withdraw(who, c.asset, c.amt); break
      case 'lend':
        if (c.fund) { h.deposit(who, ASSET_USD, c.amt); deposited.usd += c.amt }
        h.intent(who, lend(next(c.u, c.stale), c.tenor, c.rate, c.amt, BigInt(c.exp)))
        break
      case 'borrow': {
        // collateral worth ratioBps of principal at $2,500 (amt 6dp → wei 18dp)
        const coll = (c.amt * 10n ** 12n * c.ratioBps) / (10_000n * 2500n)
        if (c.fund) { h.deposit(who, ASSET_ETH, coll); deposited.eth += coll }
        h.intent(who, payload({ action: ACTION_BORROW, nonce: next(c.u, false), tenorId: c.tenor, rateBps: c.rate, amount: c.amt, collateral: coll }))
        break
      }
      case 'cancel': h.intent(who, payload({ action: ACTION_CANCEL, nonce: next(c.u, false), refId: BigInt(c.ref % (h.messages.length + 1)) })); break
      case 'repay': {
        // Mostly target a real open loan from its borrower; otherwise a random ref/sender (exercises rejections).
        const loans = [...h.state.loans.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
        const loan = loans.length ? loans[c.ref % loans.length]! : undefined
        const ui = loan && c.asBorrower ? USERS.indexOf(loan.borrower) : c.u
        if (loan && c.fund && ui >= 0) { h.deposit(USERS[ui]!, ASSET_USD, loan.owed - loan.principal); deposited.usd += loan.owed - loan.principal }
        h.intent(USERS[ui]!, payload({ action: ACTION_REPAY, nonce: next(ui, false), refId: loan?.id ?? BigInt(c.ref) }))
        break
      }
      case 'junk': h.rawIntent(who, new Uint8Array(350).fill(c.u + 1)); break
      case 'settle':
        asOf += BigInt(c.dt)
        outs.push(settle(PRICES[c.price]!))
        break
    }
  }
  return { outs, h, deposited }
}

describe('property tests (§13)', () => {
  test(`I1–I3 hold over random message streams (${RUNS} cases)`, () => {
    let fills = 0, liqs = 0, repays = 0
    const diag: Record<string, number> = {}
    fc.assert(fc.property(program, (cmds) => {
      const { outs } = play(cmds)
      for (const o of outs) {
        fills += o.stats.fills; liqs += o.stats.liquidations; repays += o.stats.repays
        if (process.env.PROPERTY_DIAG) for (const [k, v] of Object.entries(o.stats.rejected)) diag[k] = (diag[k] ?? 0) + v!
        if (process.env.PROPERTY_DIAG) diag.intents = (diag.intents ?? 0) + o.stats.intents
      }
    }), { numRuns: RUNS })
    if (process.env.PROPERTY_DIAG) console.log(JSON.stringify({ fills, liqs, repays, ...diag }))
    // The generator must actually exercise matching, liquidation and repayment.
    expect(fills).toBeGreaterThan(RUNS / 20)
    expect(liqs).toBeGreaterThan(0)
    expect(repays).toBeGreaterThan(0)
  }, TIMEOUT)

  test(`I4 clearing rate bounds every slice and every filled borrow (${RUNS} cases)`, () => {
    const lendArb = fc.array(fc.record({ minRate: fc.integer({ min: 1, max: 50 }), remaining: fc.bigInt({ min: 1n, max: 100n }) }), { maxLength: 12 })
    const borrowArb = fc.array(fc.record({ maxRate: fc.integer({ min: 1, max: 50 }), remaining: fc.bigInt({ min: 1n, max: 150n }), ok: fc.boolean() }), { maxLength: 12 })
    fc.assert(fc.property(lendArb, borrowArb, (ls, bs) => {
      const lends = ls.map((l, i) => ({ id: BigInt(i + 1), owner: A(i + 1), ...l }))
      const borrows = bs.map((b, i) => ({ id: BigInt(100 + i), owner: A(100 + i), maxRate: b.maxRate, remaining: b.remaining }))
      const okIds = new Set(bs.flatMap((b, i) => (b.ok ? [BigInt(100 + i)] : [])))
      const { fills, rStar } = runAuction(lends, borrows, (b) => okIds.has(b.id))
      if (fills.length === 0) return rStar === undefined
      const used = new Map<bigint, bigint>()
      for (const f of fills) {
        const b = borrows.find((x) => x.id === f.borrowId)!
        expect(okIds.has(b.id)).toBe(true)
        expect(rStar! <= b.maxRate).toBe(true)
        expect(f.slices.reduce((s, x) => s + x.amount, 0n)).toBe(b.remaining)
        for (const s of f.slices) {
          expect(s.minRate <= rStar!).toBe(true)
          used.set(s.lendId, (used.get(s.lendId) ?? 0n) + s.amount)
        }
      }
      for (const [id, amt] of used) expect(amt <= lends.find((l) => l.id === id)!.remaining).toBe(true)
      return true
    }), { numRuns: RUNS })
  }, TIMEOUT)

  test(`I8 determinism: same inputs, shuffled map order → identical bytes (${RUNS} cases)`, () => {
    fc.assert(fc.property(program, fc.integer(), (cmds, seed) => {
      let x = seed >>> 0 || 1
      const rnd = (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n }
      const a = play(cmds).outs
      const b = play(cmds, rnd).outs
      expect(b.length).toBe(a.length)
      a.forEach((o, i) => {
        expect(encodeReport(b[i]!.report)).toBe(encodeReport(o.report))
        expect(encodeEpochDiff(b[i]!.diff)).toBe(encodeEpochDiff(o.diff))
      })
    }), { numRuns: RUNS })
  }, TIMEOUT)
})
