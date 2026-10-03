import { describe, expect, test } from 'bun:test'
import { hexToBytes, keccak256, toHex } from 'viem'
import {
  ACTION_BORROW, ACTION_CANCEL, ACTION_REPAY, ASSET_ETH, ASSET_USD, MAX_PAYOUTS_PER_EPOCH, TervaneError, applyDiff,
  decodeEpochDiff, decodeReport, encodeEpochDiff, encodeReport, encodeState, merkleRoot, runEpoch, stateFromJson,
  stateToJson,
} from '../src'
import { A, Harness, TREASURY, eciesCipher, lend, payload } from './harness'

const ADA = A(0xada), BOLA = A(0xb01a), CHIDI = A(0xc41d1), DAYO = A(0xda40)
const USD = (n: number) => BigInt(n) * 1_000_000n
const T0 = 1_760_000_000n
const P2500 = 2500n * 10n ** 8n
const P1800 = 1800n * 10n ** 8n

function demoBook(h = new Harness(eciesCipher())) {
  h.deposit(ADA, ASSET_USD, USD(600))
  h.deposit(BOLA, ASSET_USD, USD(600))
  h.deposit(CHIDI, ASSET_USD, USD(1000))
  h.deposit(DAYO, ASSET_ETH, 85n * 10n ** 16n)
  h.intent(ADA, lend(1n, 2, 413, USD(600)))
  h.intent(BOLA, lend(1n, 2, 527, USD(600)))
  h.intent(CHIDI, lend(1n, 2, 611, USD(1000)))
  h.intent(DAYO, payload({ action: ACTION_BORROW, nonce: 1n, tenorId: 2, rateBps: 552, amount: USD(1000), collateral: 85n * 10n ** 16n }))
  return h
}

describe('demo book (DEMO-SCRIPT §2)', () => {
  test('epoch 1 clears at 527 with the expected split', () => {
    const h = demoBook()
    const out = h.settle({ price: P2500, asOf: T0 })
    expect(out.report.clears).toEqual([{ tenorId: 2, rateBps: 527, volume: USD(1000) }])
    const loan = out.state.loans.get(1n)!
    expect(loan.principal).toBe(USD(1000))
    expect(loan.rateBps).toBe(527)
    expect(loan.owed).toBe(1_000_001_003n)
    expect(loan.maturity).toBe(T0 + 600n)
    expect(loan.lenders).toEqual([{ lender: ADA, amount: USD(600) }, { lender: BOLA, amount: USD(400) }])
    // Open after epoch: Bola 200 (order 6), Chidi 1000 (order 7). Ada's order (5) and Dayo's (8) are gone.
    expect([...out.state.orders.keys()].sort()).toEqual([6n, 7n])
    expect(out.state.orders.get(6n)!.remaining).toBe(USD(200))
    expect(out.state.orders.get(7n)!.remaining).toBe(USD(1000))
    const dayo = out.state.accounts.get(DAYO)!
    expect(dayo.usdFree).toBe(USD(1000))
    expect(dayo.ethLocked).toBe(85n * 10n ** 16n)
    expect(out.report.epoch).toBe(1n)
    expect(out.report.inboxTo).toBe(8n)
    expect(out.report.payouts).toEqual([])
    expect(out.stats.fills).toBe(1)
  })

  test('crash to $1,800 liquidates with the expected seizure and split', () => {
    const h = demoBook()
    h.settle({ price: P2500, asOf: T0 })
    const out = h.settle({ price: P1800, asOf: T0 + 30n, priceRoundId: 2n })
    expect(out.state.loans.size).toBe(0)
    expect(out.stats.liquidations).toBe(1)
    const eth = (a: string) => out.state.accounts.get(a as never)!.ethFree
    expect(eth(TREASURY)).toBe(30_555_586_202_777_777n)
    expect(eth(ADA)).toBe(348_333_682_711_666_668n)
    expect(eth(BOLA)).toBe(232_222_455_141_111_111n)
    expect(eth(DAYO)).toBe(238_888_275_944_444_444n)
    const dayo = out.state.accounts.get(DAYO)!
    expect(dayo.ethLocked).toBe(0n)
    expect(dayo.usdFree).toBe(USD(1000))
    expect(dayo.tier).toBe(0)
  })

  test('no losing bid rate appears in any output (I6)', () => {
    const h = demoBook()
    const outs = [h.settle({ price: P2500, asOf: T0 }), h.settle({ price: P2500, asOf: T0 + 30n })]
    const scalars = (v: unknown, acc: string[] = []): string[] => {
      if (v && typeof v === 'object') for (const x of Object.values(v)) scalars(x, acc)
      else acc.push(String(v))
      return acc
    }
    for (const out of outs) {
      const values = scalars([JSON.parse(encodeEpochDiff(out.diff)), JSON.parse(encodeState(out.state)), out.stats])
      const hex = encodeReport(out.report).slice(2)
      const words = Array.from({ length: hex.length / 64 }, (_, i) => BigInt(`0x${hex.slice(i * 64, i * 64 + 64)}`))
      for (const r of [413, 611, 552]) {
        expect(values).not.toContain(String(r))
        expect(words).not.toContain(BigInt(r))
      }
      expect(words.includes(527n)).toBe(out.report.clears.length > 0) // the clearing rate is the only rate that leaves
    }
  })
})

describe('epoch transition', () => {
  test('repay pays lenders pro rata, unlocks collateral, grows repaid volume', () => {
    const h = demoBook()
    h.settle({ price: P2500, asOf: T0 })
    h.deposit(DAYO, ASSET_USD, 1003n) // cover interest
    h.intent(DAYO, payload({ action: ACTION_REPAY, nonce: 2n, refId: 1n }))
    const out = h.settle({ price: P2500, asOf: T0 + 60n })
    expect(out.stats.repays).toBe(1)
    const s = out.state
    expect(s.loans.size).toBe(0)
    // owed 1,000,001,003 split 600:400 → Ada 600,000,601.8 → floor + dust
    expect(s.accounts.get(ADA)!.usdFree).toBe(600_000_602n)
    expect(s.accounts.get(BOLA)!.usdFree).toBe(400_000_401n)
    const dayo = s.accounts.get(DAYO)!
    expect(dayo.ethFree).toBe(85n * 10n ** 16n)
    expect(dayo.repaidVolume).toBe(USD(1000))
    expect(dayo.tier).toBe(1) // Silver at 1,000 tUSD repaid
    expect(dayo.usdFree).toBe(0n)
  })

  test('maturity + grace triggers liquidation even when healthy', () => {
    const h = demoBook()
    h.settle({ price: P2500, asOf: T0 })
    expect(h.settle({ price: P2500, asOf: T0 + 660n }).stats.liquidations).toBe(0)
    expect(h.settle({ price: P2500, asOf: T0 + 661n }).stats.liquidations).toBe(1)
  })

  test('withdrawal pays min(requested, free) and caps payouts per epoch', () => {
    const h = new Harness()
    h.deposit(ADA, ASSET_USD, USD(10))
    h.withdraw(ADA, ASSET_USD, USD(25))
    h.withdraw(BOLA, ASSET_ETH, 5n)
    let out = h.settle({ price: P2500, asOf: T0 })
    expect(out.report.payouts).toEqual([
      { to: ADA, asset: ASSET_USD, requested: USD(25), paid: USD(10) },
      { to: BOLA, asset: ASSET_ETH, requested: 5n, paid: 0n },
    ])
    expect(out.state.accounts.has(BOLA)).toBe(false)

    for (let i = 0; i < MAX_PAYOUTS_PER_EPOCH + 3; i++) h.withdraw(ADA, ASSET_USD, 1n)
    out = h.settle({ price: P2500, asOf: T0 + 30n })
    expect(out.report.payouts.length).toBe(MAX_PAYOUTS_PER_EPOCH)
    expect(out.report.inboxTo).toBe(3n + BigInt(MAX_PAYOUTS_PER_EPOCH))
    expect(out.report.inboxAccTo).toBe(h.accs[Number(out.report.inboxTo)]!)
    out = h.settle({ price: P2500, asOf: T0 + 60n })
    expect(out.report.payouts.length).toBe(3)
  })

  test('garbage, wrong-sender, replayed and stale-nonce intents are consumed and ignored', () => {
    const h = new Harness(eciesCipher())
    h.deposit(ADA, ASSET_USD, USD(100))
    h.rawIntent(ADA, hexToBytes(keccak256(toHex('junk'))))               // wrong length
    h.rawIntent(ADA, new Uint8Array(350).fill(1))                          // right length, bad tag
    h.intent(ADA, lend(1n, 0, 500, USD(10)), BOLA)                         // encrypted for another sender
    h.intent(ADA, lend(1n, 0, 500, USD(10)))                               // valid
    h.intent(ADA, lend(1n, 0, 500, USD(10)))                               // stale nonce
    h.intent(ADA, lend(2n, 0, 500, USD(1000)))                             // insufficient balance
    h.intent(ADA, lend(3n, 2, 500, USD(1)))                                // demo tenor, demoMode off
    h.intent(ADA, lend(4n, 0, 0, USD(1)))                                  // zero rate
    h.intent(ADA, lend(5n, 0, 10_001, USD(1)))                             // above cap
    h.intent(ADA, payload({ action: 9, nonce: 6n }))                       // unknown action
    const out = h.settle({ price: P2500, asOf: T0, demoMode: false })
    expect(out.stats.rejected).toEqual({ E_DECRYPT: 3, E_NONCE: 1, E_BALANCE: 1, E_TENOR: 1, E_RATE: 2, E_BAD_ACTION: 1 })
    expect(out.state.orders.size).toBe(1)
    const ada = out.state.accounts.get(ADA)!
    expect(ada.nonce).toBe(5n)
    expect(ada.usdReserved).toBe(USD(10))
    expect(out.report.inboxTo).toBe(11n)
  })

  test('cancel releases reserves; only the owner may cancel', () => {
    const h = new Harness()
    h.deposit(ADA, ASSET_USD, USD(100))
    const id = h.intent(ADA, lend(1n, 0, 500, USD(40)))
    h.settle({ price: P2500, asOf: T0 })
    h.intent(BOLA, payload({ action: ACTION_CANCEL, nonce: 1n, refId: id }))
    h.intent(ADA, payload({ action: ACTION_CANCEL, nonce: 2n, refId: id }))
    const out = h.settle({ price: P2500, asOf: T0 + 30n })
    expect(out.stats.rejected).toEqual({ E_NOT_OWNER: 1 })
    expect(out.state.orders.size).toBe(0)
    expect(out.state.accounts.get(ADA)!.usdFree).toBe(USD(100))
    expect(out.diff.deleteOrders).toEqual([id])
  })

  test('orders expire after expiresAtEpoch; already-expired intents are rejected', () => {
    const h = new Harness()
    h.deposit(ADA, ASSET_USD, USD(100))
    h.intent(ADA, lend(1n, 0, 500, USD(40), 2n))
    h.settle({ price: P2500, asOf: T0 })                 // epoch 1
    h.settle({ price: P2500, asOf: T0 + 30n })           // epoch 2: still open
    expect(h.state.orders.size).toBe(1)
    h.intent(ADA, lend(2n, 0, 500, USD(1), 2n))
    const out = h.settle({ price: P2500, asOf: T0 + 60n }) // epoch 3: expires
    expect(out.stats.expired).toBe(1)
    expect(out.stats.rejected).toEqual({ E_EXPIRED: 1 })
    expect(out.state.accounts.get(ADA)!.usdFree).toBe(USD(100))
  })

  test('borrow checks: cap, open ratio, balance; auction skips borrows that lost eligibility', () => {
    const h = new Harness()
    h.deposit(DAYO, ASSET_ETH, 10n * 10n ** 18n)
    h.intent(DAYO, payload({ action: ACTION_BORROW, nonce: 1n, rateBps: 900, amount: USD(2001), collateral: 4n * 10n ** 18n }))
    h.intent(DAYO, payload({ action: ACTION_BORROW, nonce: 2n, rateBps: 900, amount: USD(1000), collateral: 10n ** 17n }))
    h.intent(DAYO, payload({ action: ACTION_BORROW, nonce: 3n, rateBps: 900, amount: USD(100), collateral: 11n * 10n ** 18n }))
    h.intent(DAYO, payload({ action: ACTION_BORROW, nonce: 4n, rateBps: 900, amount: USD(1000), collateral: 8n * 10n ** 17n }))
    let out = h.settle({ price: P2500, asOf: T0 })
    expect(out.stats.rejected).toEqual({ E_CAP: 1, E_RATIO: 1, E_BALANCE: 1 })
    expect(out.state.orders.size).toBe(1)
    // Price falls: order no longer meets 2.0x, so it stays open unfilled even with liquidity.
    h.deposit(ADA, ASSET_USD, USD(5000))
    h.intent(ADA, lend(1n, 0, 100, USD(5000)))
    out = h.settle({ price: 2000n * 10n ** 8n, asOf: T0 + 30n })
    expect(out.report.clears).toEqual([])
    out = h.settle({ price: P2500, asOf: T0 + 60n })
    expect(out.report.clears).toEqual([{ tenorId: 0, rateBps: 100, volume: USD(1000) }])
  })

  test('applyDiff reproduces the enclave root; codecs round-trip', () => {
    const h = demoBook()
    let server = h.state
    for (const [p, t] of [[P2500, T0], [P1800, T0 + 30n]] as const) {
      const out = h.settle({ price: p, asOf: t })
      const diff = decodeEpochDiff(encodeEpochDiff(out.diff))
      expect(diff).toEqual(out.diff)
      server = applyDiff(server, diff)
      expect(merkleRoot(server)).toBe(out.report.newRoot)
      expect(stateFromJson(JSON.parse(encodeState(server)))).toEqual(server)
      expect(decodeReport(encodeReport(out.report))).toEqual(out.report)
    }
    expect(stateToJson(server)).toEqual(stateToJson(h.state))
  })

  test('tampered server data aborts the epoch', () => {
    const h = demoBook()
    h.settle({ price: P2500, asOf: T0 })
    const base = () => ({
      prev: h.state,
      onchain: { stateRoot: h.stateRoot, cursor: h.cursor, accCursor: h.accs[8]!, accTo: h.accs[8]! },
      inboxTo: 8n, messages: [], openOrderBlobs: h.blobsForOpenOrders(h.state), decrypt: h.cipher.decrypt,
      price: P2500, priceRoundId: 1n, asOf: T0 + 30n, params: { grace: 60n }, treasury: TREASURY, demoMode: true,
    })
    const code = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return (e as TervaneError).code } }
    expect(code(() => runEpoch(base()))).toBe('ok')

    const forged = structuredClone(h.state)
    forged.accounts.get(ADA)!.usdFree += 1n
    expect(code(() => runEpoch({ ...base(), prev: forged }))).toBe('E_ROOT_MISMATCH')

    const blobs = h.blobsForOpenOrders(h.state)
    blobs.set(6n, h.messages[6]!.blob)
    expect(code(() => runEpoch({ ...base(), openOrderBlobs: blobs }))).toBe('E_BLOB_MISMATCH')

    h.deposit(ADA, ASSET_USD, 1n)
    h.deposit(BOLA, ASSET_USD, 2n)
    const msgs = h.messages.slice(8, 10)
    const w = { ...base(), inboxTo: 10n, onchain: { ...base().onchain, accTo: h.accs[10]! } }
    expect(code(() => runEpoch({ ...w, messages: msgs }))).toBe('ok')
    expect(code(() => runEpoch({ ...w, messages: [msgs[0]!] }))).toBe('E_INBOX_MISMATCH')            // withheld
    expect(code(() => runEpoch({ ...w, messages: [msgs[1]!, msgs[0]!] }))).toBe('E_INBOX_MISMATCH')  // reordered
    expect(code(() => runEpoch({ ...w, messages: [msgs[0]!, { ...msgs[1]!, amount: 3n }] }))).toBe('E_INBOX_MISMATCH')
    expect(code(() => runEpoch({ ...w, messages: msgs, price: 0n }))).toBe('E_PRICE')
  })
})
