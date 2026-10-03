// settleEpoch against a fake chain + fake server (BUILD-PLAN Phase 3). The fake chain applies the §11 report
// checks that matter here; the fake server applies diffs with applyDiff like the real one will.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  ACTION_BORROW, ACTION_LEND, KIND_DEPOSIT, KIND_INTENT, PAYLOAD_VERSION, TervaneError, ZERO32, accStep, addr, applyDiff,
  coreAbi, decodeEpochDiff, decodeReport, encodeEpochInput, encodePayload, encryptIntent, enclavePublicKey, erc20Abi,
  feedAbi, genesisState, merkleRoot, msgHash, runEpoch, type Address, type Hex, type InboxMessage, type IntentPayload,
  type LedgerState,
} from '@tervane/core'
import { bytesToHex, decodeFunctionData, encodeFunctionResult, hexToBytes, keccak256, toHex } from 'viem'
import type { Config } from './config'
import { settleEpoch, type SettlerIO, type WriteResult } from './settle'

const CORE = addr('0x00000000000000000000000000000000000c0e00')
const FEED = addr('0x00000000000000000000000000000000000fee00')
const USD = addr('0x0000000000000000000000000000000000005d00')
const ETH = addr('0x000000000000000000000000000000000000e700')
const TREASURY = addr('0x0000000000000000000000000000000000007e45')
const SK = keccak256(toHex('tervane/settler-test/enclave')) // test-only key
const API_KEY = 'test-api-key-not-a-secret-0123456789'
const T0 = 1_760_000_000n

const cfg = (over: Partial<Config> = {}): Config => ({
  chainName: 'monad-testnet', chainId: '10143', coreAddress: CORE, priceFeedAddress: FEED, usdTokenAddress: USD,
  ethTokenAddress: ETH, treasuryAddress: TREASURY, serverUrl: 'http://localhost:8787', cronSchedule: '*/30 * * * * *',
  maxInboxPerEpoch: 200,
  writeGas: { base: '176000', perPayout: '50000', perClear: '4000', overheadBytes: '1100', perByte: '16', headroomBps: '13000', max: '2500000' },
  demoMode: true, debugLogs: true, ...over,
})

/** Fake world: TervaneCore + feed + tokens + the Tervane server. */
class World implements SettlerIO {
  // chain
  stateRoot: Hex = merkleRoot(genesisState())
  lastEpoch = 0n
  cursor = 0n
  lastAsOf = 0n
  escaped = false
  msgs: InboxMessage[] = []
  accs: Hex[] = [ZERO32]
  price = 2500n * 10n ** 8n
  round = 1n
  priceAt = T0
  balances = { usd: 0n, eth: 0n }
  now = T0
  // server
  serverState: LedgerState = genesisState()
  pending: LedgerState | undefined
  getStatus = 200
  postStatus = 200
  tamper?: (s: LedgerState) => LedgerState
  receiverReverts = false
  // observation
  calls: string[] = []
  logs: string[] = []
  gasLimits: bigint[] = []

  push(m: Omit<InboxMessage, 'index'>) {
    const msg = { ...m, index: BigInt(this.msgs.length + 1) }
    this.msgs.push(msg)
    this.accs.push(accStep(this.accs[this.accs.length - 1]!, msgHash(msg)))
    if (m.kind === KIND_DEPOSIT) m.asset === 0 ? (this.balances.usd += m.amount) : (this.balances.eth += m.amount)
  }
  deposit(sender: Address, asset: number, amount: bigint) {
    this.push({ kind: KIND_DEPOSIT, sender, asset, amount, blobHash: ZERO32, blob: '0x' })
  }
  intent(sender: Address, p: IntentPayload) {
    const blob = bytesToHex(encryptIntent(enclavePublicKey(hexToBytes(SK)), hexToBytes(encodePayload(p)), { chainId: 10143n, core: CORE, sender }))
    this.push({ kind: KIND_INTENT, sender, asset: 0, amount: 0n, blobHash: keccak256(blob), blob })
  }

  // ── SettlerIO ──
  secrets(ids: readonly string[]) {
    this.calls.push('secrets')
    return Object.fromEntries(ids.map((id) => [id, id === 'ENCLAVE_SK' ? SK : API_KEY]))
  }
  call(to: Address, data: Hex): Hex {
    this.calls.push('call')
    const abi = to === CORE ? coreAbi : to === FEED ? feedAbi : erc20Abi
    const { functionName, args } = decodeFunctionData({ abi, data }) as { functionName: string; args: readonly unknown[] }
    const enc = (result: unknown) => encodeFunctionResult({ abi, functionName, result } as never)
    switch (functionName) {
      case 'settlementState': return enc({ stateRoot: this.stateRoot, lastEpoch: this.lastEpoch, cursor: this.cursor, inboxCount: BigInt(this.msgs.length), lastSettleAt: 0n, escaped: this.escaped, lastAsOf: this.lastAsOf, lastPriceRoundId: this.round })
      case 'params': return enc({ grace: 60n, escapeDelay: 600n, maxSkew: 120n, maxPriceAge: 86_400n })
      case 'inboxAcc': return enc(this.accs[Number(args[0])]!)
      case 'latestRoundData': return enc([this.round, this.price, this.priceAt, this.priceAt, this.round])
      case 'balanceOf': return enc(to === USD ? this.balances.usd : this.balances.eth)
      default: throw new Error(`unexpected call ${functionName}`)
    }
  }
  httpGet(url: string, bearer: string) {
    this.calls.push('GET')
    if (bearer !== API_KEY) return { status: 401, body: '' }
    if (this.getStatus !== 200) return { status: this.getStatus, body: '' }
    const q = new URL(url).searchParams
    const cursor = BigInt(q.get('cursor')!), limit = BigInt(q.get('limit')!)
    const to = BigInt(Math.min(this.msgs.length, Number(cursor + limit)))
    const prev = this.tamper ? this.tamper(structuredClone(this.serverState)) : this.serverState
    const blobs = new Map<bigint, Hex>()
    for (const id of this.serverState.orders.keys()) blobs.set(id, this.msgs[Number(id) - 1]!.blob)
    return { status: 200, body: encodeEpochInput({ prev, inboxTo: to, messages: this.msgs.slice(Number(cursor), Number(to)), openOrderBlobs: blobs }) }
  }
  httpPost(_url: string, bearer: string, json: string) {
    this.calls.push('POST')
    if (bearer !== API_KEY || this.postStatus !== 200) return { status: this.postStatus === 200 ? 401 : this.postStatus, body: '' }
    this.pending = applyDiff(this.serverState, decodeEpochDiff(json)) // throws if the diff doesn't hash to newRoot
    return { status: 200, body: '{}' }
  }
  writeReport(receiver: Address, payload: Hex, gasLimit: bigint): WriteResult {
    this.calls.push('WRITE')
    this.gasLimits.push(gasLimit)
    const r = decodeReport(payload)
    const ok = receiver === CORE && !this.receiverReverts && r.epoch === this.lastEpoch + 1n && r.prevRoot === this.stateRoot
      && r.inboxAccTo === this.accs[Number(r.inboxTo)] && r.asOf >= this.lastAsOf && r.priceUsed === this.price
    if (!ok) return { ok: false, detail: 'SUCCESS/receiver-reverted' }
    Object.assign(this, { stateRoot: r.newRoot, lastEpoch: r.epoch, cursor: r.inboxTo, lastAsOf: r.asOf })
    for (const p of r.payouts) p.asset === 0 ? (this.balances.usd -= p.paid) : (this.balances.eth -= p.paid)
    this.serverState = this.pending!            // server promotes pending on EpochSettled
    return { ok: true, txHash: keccak256(payload), detail: 'SUCCESS' }
  }
  nowSeconds() { return this.now }
  log(msg: string) { this.logs.push(msg) }
}

/** The real handler drops logs when debugLogs is false; mirror main.ts makeIO. */
const withLogGate = (w: World, c: Config): SettlerIO => Object.assign(Object.create(w), { log: (m: string) => { if (c.debugLogs) w.log(m) } })

const ADA = addr('0x000000000000000000000000000000000000ada0'), BOLA = addr('0x000000000000000000000000000000000000b01a')
const CHIDI = addr('0x00000000000000000000000000000000000c41d1'), DAYO = addr('0x000000000000000000000000000000000000da40')
const p = (x: Partial<IntentPayload> & { action: number; nonce: bigint }): IntentPayload =>
  ({ version: PAYLOAD_VERSION, tenorId: 2, rateBps: 0, refId: 0n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n, ...x })
const code = (f: () => unknown) => { try { f(); return 'ok' } catch (e) { return (e as TervaneError).code ?? String(e) } }

describe('settleEpoch', () => {
  test('Gate 3 shape: genesis + one deposit → epoch 1 with the root packages/core computes', () => {
    const w = new World()
    w.deposit(ADA, 0, 600_000_000n)
    const tx = settleEpoch(w, cfg(), 'cron')
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/)
    expect(w.lastEpoch).toBe(1n)
    expect(w.cursor).toBe(1n)
    // independent computation over the same inputs
    const ref = runEpoch({
      prev: genesisState(), inboxTo: 1n, messages: w.msgs, openOrderBlobs: new Map(),
      onchain: { stateRoot: merkleRoot(genesisState()), cursor: 0n, accCursor: ZERO32, accTo: w.accs[1]! },
      decrypt: () => null, price: w.price, priceRoundId: 1n, asOf: T0, params: { grace: 60n }, treasury: TREASURY, demoMode: true,
    })
    expect(w.stateRoot).toBe(ref.report.newRoot)
    expect(merkleRoot(w.serverState)).toBe(w.stateRoot)
    // POST strictly before WRITE; one secrets call; 7 chain reads
    expect(w.calls.indexOf('POST')).toBeLessThan(w.calls.indexOf('WRITE'))
    expect(w.calls.filter((c) => c === 'secrets').length).toBe(1)
    expect(w.calls.filter((c) => c === 'call').length).toBe(7)
  })

  test('demo book clears at 527 through the full settler path; logs carry no bid rate or secret', () => {
    const w = new World()
    w.deposit(ADA, 0, 600_000_000n); w.deposit(BOLA, 0, 600_000_000n); w.deposit(CHIDI, 0, 1_000_000_000n); w.deposit(DAYO, 1, 85n * 10n ** 16n)
    w.intent(ADA, p({ action: ACTION_LEND, nonce: 1n, rateBps: 413, amount: 600_000_000n }))
    w.intent(BOLA, p({ action: ACTION_LEND, nonce: 1n, rateBps: 527, amount: 600_000_000n }))
    w.intent(CHIDI, p({ action: ACTION_LEND, nonce: 1n, rateBps: 611, amount: 1_000_000_000n }))
    w.intent(DAYO, p({ action: ACTION_BORROW, nonce: 1n, rateBps: 552, amount: 1_000_000_000n, collateral: 85n * 10n ** 16n }))
    settleEpoch(w, cfg(), 'log')
    expect(w.serverState.loans.get(1n)!.rateBps).toBe(527)
    w.now += 30n
    settleEpoch(w, cfg(), 'cron') // epoch 2 re-decrypts Bola's and Chidi's open orders
    expect(w.lastEpoch).toBe(2n)
    expect([...w.serverState.orders.keys()].sort()).toEqual([6n, 7n])
    const all = w.logs.join('\n')
    expect(w.logs.length).toBe(2)
    for (const s of ['413', '611', '552', SK.slice(2), API_KEY]) expect(all).not.toContain(s)
  })

  test('debugLogs=false produces no logs at all', () => {
    const w = new World()
    w.deposit(ADA, 0, 1n)
    const c = cfg({ debugLogs: false })
    settleEpoch(withLogGate(w, c), c, 'cron')
    expect(w.logs).toEqual([])
  })

  test('failures abort before any write', () => {
    let w = new World(); w.deposit(ADA, 0, 1n); w.getStatus = 503
    expect(code(() => settleEpoch(w, cfg(), 'cron'))).toBe('E_SERVER')
    expect(w.calls).not.toContain('POST'); expect(w.calls).not.toContain('WRITE')

    w = new World(); w.deposit(ADA, 0, 1n); w.postStatus = 500
    expect(code(() => settleEpoch(w, cfg(), 'cron'))).toBe('E_SERVER_POST')
    expect(w.calls).not.toContain('WRITE')

    w = new World(); w.deposit(ADA, 0, 5n)
    settleEpoch(w, cfg(), 'cron')
    w.tamper = (s) => { s.accounts.get(ADA)!.usdFree += 1n; return s } // server edits a balance
    w.deposit(BOLA, 0, 1n)
    expect(code(() => settleEpoch(w, cfg(), 'cron'))).toBe('E_ROOT_MISMATCH')
    expect(w.calls.filter((c) => c === 'POST').length).toBe(1) // only the first epoch's

    w = new World(); w.deposit(ADA, 0, 1n); w.priceAt = T0 - 86_401n
    expect(code(() => settleEpoch(w, cfg(), 'cron'))).toBe('E_PRICE')

    w = new World(); w.deposit(ADA, 0, 1n); w.receiverReverts = true
    expect(code(() => settleEpoch(w, cfg(), 'cron'))).toBe('E_WRITE')
    expect(w.lastEpoch).toBe(0n)
  })

  test('escaped core: no HTTP, no write', () => {
    const w = new World(); w.escaped = true
    expect(settleEpoch(w, cfg(), 'cron')).toBe('escaped')
    expect(w.calls).not.toContain('GET'); expect(w.calls).not.toContain('WRITE')
  })

  test('D-22: gas limit tracks report contents and is capped', () => {
    const w = new World()
    w.deposit(ADA, 0, 1n)
    settleEpoch(w, cfg(), 'cron')
    const idle = w.gasLimits[0]!
    expect(idle).toBeLessThan(300_000n)
    const capped = new World(); capped.deposit(ADA, 0, 1n)
    settleEpoch(capped, cfg({ writeGas: { ...cfg().writeGas, max: '200000' } }), 'cron')
    expect(capped.gasLimits[0]).toBe(200_000n)
  })
})
