import { describe, expect, test } from 'bun:test'
import { bytesToHex, concat, encodeAbiParameters, hexToBytes, keccak256, size, toHex } from 'viem'
import {
  ACTION_BORROW, ACTION_REPAY, BLOB_LEN, ZERO32, accStep, buildLevels, ceilDiv, decodePayload, decodeReport,
  decryptIntent, enclavePublicKey, encodePayload, encodeReport, encryptIntent, getProof, hashPair, interest,
  liquidationAmounts, msgHash, openRatioOk, rootOf, runAuction, split, tierCap, tierForVolume, valueUsd, verifyProof,
  type Hex, type SettlementReport,
} from '../src'
import { A, CHAIN_ID, CORE, TEST_ENCLAVE_SK, payload } from './harness'

describe('math (§1, §9, §10)', () => {
  test('ceil/floor', () => {
    expect(ceilDiv(0n, 7n)).toBe(0n)
    expect(ceilDiv(7n, 7n)).toBe(1n)
    expect(ceilDiv(8n, 7n)).toBe(2n)
  })

  test('split: floors, dust to largest weight, ties to lowest address', () => {
    expect(split(10n, [{ addr: A(2), weight: 1n }, { addr: A(1), weight: 2n }])).toEqual([3n, 7n])
    expect(split(10n, [{ addr: A(2), weight: 1n }, { addr: A(1), weight: 1n }, { addr: A(3), weight: 1n }])).toEqual([3n, 4n, 3n])
    expect(split(0n, [{ addr: A(1), weight: 5n }])).toEqual([0n])
    expect(() => split(1n, [])).toThrow()
  })

  test('interest and value', () => {
    expect(interest(1_000_000_000n, 527n, 600n)).toBe(1003n)
    expect(interest(1n, 1n, 1n)).toBe(1n) // owed rounds up
    expect(valueUsd(85n * 10n ** 16n, 2500n * 10n ** 8n)).toBe(2_125_000_000n)
    expect(openRatioOk(85n * 10n ** 16n, 1_000_000_000n, 0, 2500n * 10n ** 8n)).toBe(true)
    expect(openRatioOk(8n * 10n ** 17n, 1_000_000_001n, 0, 2500n * 10n ** 8n)).toBe(false)
  })

  test('liquidation (demo crash)', () => {
    expect(liquidationAmounts(1_000_001_003n, 85n * 10n ** 16n, 1800n * 10n ** 8n)).toEqual({
      seized: 611_111_724_055_555_556n, fee: 30_555_586_202_777_777n, pot: 580_556_137_852_777_779n, returned: 238_888_275_944_444_444n,
    })
    // underwater: seize everything
    const u = liquidationAmounts(1_000_000_000n, 10n ** 17n, 2000n * 10n ** 8n)
    expect(u.seized).toBe(10n ** 17n)
    expect(u.returned).toBe(0n)
  })

  test('tiers', () => {
    expect(tierForVolume(0n)).toBe(0)
    expect(tierForVolume(999_999_999n)).toBe(0)
    expect(tierForVolume(1_000_000_000n)).toBe(1)
    expect(tierForVolume(20_000_000_000n)).toBe(3)
    expect(tierCap(0, 10n ** 12n)).toBe(2_000_000_000n)
    expect(tierCap(1, 3_000_000_000n)).toBe(3_000_000_000n)
    expect(tierCap(2, 6_000_000_000n)).toBe(9_000_000_000n)
    expect(tierCap(3, 20_000_000_000n)).toBe(40_000_000_000n)
  })
})

describe('abi (§4, §5, §11)', () => {
  test('payload is always 288 bytes and round-trips', () => {
    for (const p of [
      payload({ action: ACTION_BORROW, nonce: 7n, tenorId: 1, rateBps: 9999, amount: 2n ** 255n, collateral: 1n, expiresAtEpoch: 3n }),
      payload({ action: ACTION_REPAY, nonce: 2n ** 64n - 1n, refId: 12n }),
    ]) {
      const enc = encodePayload(p)
      expect(size(enc)).toBe(288)
      expect(decodePayload(enc)).toEqual(p)
    }
  })

  test('decodePayload rejects malformed input', () => {
    expect(decodePayload('0x00')).toBeNull()
    const enc = encodePayload(payload({ action: 1, nonce: 1n }))
    expect(decodePayload(`0x01${enc.slice(4)}` as Hex)).toBeNull() // uint8 word overflow
  })

  test('inbox hashing matches the spec formula', () => {
    const m = { index: 1n, kind: 2, sender: A(5), asset: 0, amount: 0n, blobHash: keccak256('0x1234') }
    const h = keccak256(encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'uint8' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }],
      [1n, 2, A(5), 0, 0n, m.blobHash],
    ))
    expect(msgHash(m)).toBe(h)
    expect(accStep(ZERO32, h)).toBe(keccak256(concat([ZERO32, h])))
  })

  test('report round-trips', () => {
    const r: SettlementReport = {
      epoch: 3n, prevRoot: keccak256('0x01'), newRoot: keccak256('0x02'), inboxTo: 9n, inboxAccTo: keccak256('0x03'),
      asOf: 1_760_000_000n, priceRoundId: 2n ** 80n - 1n, priceUsed: 2500n * 10n ** 8n,
      clears: [{ tenorId: 2, rateBps: 527, volume: 10n ** 9n }],
      payouts: [{ to: A(9), asset: 1, requested: 5n, paid: 4n }],
    }
    expect(decodeReport(encodeReport(r))).toEqual(r)
  })
})

describe('crypto (§6)', () => {
  const pk = enclavePublicKey(TEST_ENCLAVE_SK)
  const pt = hexToBytes(encodePayload(payload({ action: 1, nonce: 1n, rateBps: 777, amount: 5n })))
  const ctx = { chainId: CHAIN_ID, core: CORE, sender: A(1) }

  test('round trip, 350-byte blob', () => {
    const blob = encryptIntent(pk, pt, ctx)
    expect(blob.length).toBe(BLOB_LEN)
    expect(bytesToHex(decryptIntent(TEST_ENCLAVE_SK, blob, ctx)!)).toBe(bytesToHex(pt))
  })

  test('AAD binds sender, chain and core; tampering fails', () => {
    const blob = encryptIntent(pk, pt, ctx)
    expect(decryptIntent(TEST_ENCLAVE_SK, blob, { ...ctx, sender: A(2) })).toBeNull()
    expect(decryptIntent(TEST_ENCLAVE_SK, blob, { ...ctx, chainId: 1n })).toBeNull()
    expect(decryptIntent(TEST_ENCLAVE_SK, blob, { ...ctx, core: A(3) })).toBeNull()
    const t = blob.slice(); t[200]! ^= 1
    expect(decryptIntent(TEST_ENCLAVE_SK, t, ctx)).toBeNull()
    const v = blob.slice(); v[0] = 2
    expect(decryptIntent(TEST_ENCLAVE_SK, v, ctx)).toBeNull()
    expect(decryptIntent(TEST_ENCLAVE_SK, blob.slice(0, 349), ctx)).toBeNull()
    expect(decryptIntent(hexToBytes(keccak256(toHex('other'))), blob, ctx)).toBeNull()
  })

  test('fixed ephemeral key and iv are deterministic', () => {
    const opts = { ephSk: hexToBytes(keccak256(toHex('eph'))), iv: new Uint8Array(12).fill(7) }
    expect(bytesToHex(encryptIntent(pk, pt, ctx, opts))).toBe(bytesToHex(encryptIntent(pk, pt, ctx, opts)))
  })
})

describe('merkle (§7.3)', () => {
  const leaves = (n: number) => Array.from({ length: n }, (_, i) => keccak256(toHex(`leaf${i}`)))

  test('every proof verifies for 1..33 leaves; root is order-independent', () => {
    for (let n = 1; n <= 33; n++) {
      const ls = leaves(n)
      const root = rootOf(ls)
      expect(rootOf([...ls].reverse())).toBe(root)
      for (const l of ls) expect(verifyProof(getProof(ls, l), root, l)).toBe(true)
      expect(verifyProof(getProof(ls, ls[0]!), root, keccak256('0xdead'))).toBe(false)
    }
  })

  test('single leaf is its own root; odd node is carried', () => {
    const [a, b, c] = leaves(3).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)) as [Hex, Hex, Hex]
    expect(rootOf([a])).toBe(a)
    expect(rootOf([a, b, c])).toBe(hashPair(hashPair(a, b), c))
    expect(buildLevels([a, b, c])[1]).toEqual([hashPair(a, b), c])
    expect(getProof([a, b, c], c)).toEqual([hashPair(a, b)])
  })
})

describe('auction (§8)', () => {
  const L = (id: number, minRate: number, remaining: bigint) => ({ id: BigInt(id), owner: A(id), remaining, minRate })
  const B = (id: number, maxRate: number, remaining: bigint) => ({ id: BigInt(id), owner: A(id), remaining, maxRate })

  test('demo book', () => {
    const r = runAuction([L(5, 413, 600n), L(6, 527, 600n), L(7, 611, 1000n)], [B(8, 552, 1000n)])
    expect(r.rStar).toBe(527)
    expect(r.fills).toEqual([{
      borrowId: 8n, principal: 1000n,
      slices: [{ lendId: 5n, owner: A(5), amount: 600n, minRate: 413 }, { lendId: 6n, owner: A(6), amount: 400n, minRate: 527 }],
    }])
  })

  test('no cross; exact cross; whole-or-nothing skip lets a smaller borrow fill', () => {
    expect(runAuction([L(1, 600, 100n)], [B(2, 599, 100n)])).toEqual({ fills: [], rStar: undefined })
    expect(runAuction([L(1, 600, 100n)], [B(2, 600, 100n)]).rStar).toBe(600)
    const r = runAuction([L(1, 300, 100n)], [B(2, 900, 150n), B(3, 400, 80n)])
    expect(r.fills.map((f) => f.borrowId)).toEqual([3n])
    expect(r.rStar).toBe(300)
  })

  test('ties break by id (time priority); ineligible borrows stay open', () => {
    const r = runAuction([L(4, 300, 50n), L(2, 300, 50n)], [B(9, 500, 50n), B(7, 500, 50n)])
    expect(r.fills.map((f) => [f.borrowId, f.slices[0]!.lendId])).toEqual([[7n, 2n], [9n, 4n]])
    const s = runAuction([L(1, 300, 100n)], [B(2, 900, 100n)], () => false)
    expect(s.fills).toEqual([])
  })
})
