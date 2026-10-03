import { describe, expect, test } from 'bun:test'
import {
  ACTION_BORROW, ACTION_LEND, KIND_DEPOSIT, KIND_INTENT, PAYLOAD_VERSION, ZERO32, accStep, addr, decodeEpochInput,
  encodeEpochDiff, encodePayload, encryptIntent, enclavePublicKey, genesisState, makeDecryptor, merkleRoot, msgHash,
  runEpoch, verifyProof, lendersHash, type Address, type Hex, type IntentPayload,
} from '@tervane/core'
import { bytesToHex, hexToBytes, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createApp } from '../src/app'
import { VIEW_TYPES, viewDomain } from '../src/auth'
import type { ChainSource, IndexedLog, SettlementView } from '../src/chain'
import { Db } from '../src/db'
import { Indexer } from '../src/indexer'
import { StateStore } from '../src/state'

const CORE = addr('0x00000000000000000000000000000000000c0e00')
const TREASURY = addr('0x0000000000000000000000000000000000007e45')
const KEY = 'k'.repeat(48)
const SK = hexToBytes(keccak256(toHex('tervane/server-test/enclave'))) // test-only
const T0 = 1_760_000_000n
const P = 2500n * 10n ** 8n
const GENESIS = merkleRoot(genesisState())

// Wallets with test-only keys (signers for EIP-712 views)
const wallet = (n: string) => privateKeyToAccount(keccak256(toHex(`tervane/server-test/${n}`)))
const ada = wallet('ada'), bola = wallet('bola'), chidi = wallet('chidi'), dayo = wallet('dayo')
const A = (w: { address: string }) => addr(w.address)

/** Fake TervaneCore event stream + views. */
class FakeChain implements ChainSource {
  block = 100n
  events: IndexedLog[] = []
  accs: Hex[] = [ZERO32]
  st: SettlementView = { stateRoot: GENESIS, lastEpoch: 0n, cursor: 0n, inboxCount: 0n, lastSettleAt: 0n, escaped: false }
  failAbove?: bigint
  blobs: Hex[] = []
  msgs: { index: bigint; kind: number; sender: Address; asset: number; amount: bigint; blobHash: Hex; blob: Hex }[] = []

  private emit(eventName: string, args: Record<string, unknown>) {
    this.block += 1n
    this.events.push({ eventName, args, blockNumber: this.block, logIndex: 0, transactionHash: keccak256(toHex(`tx${this.events.length}`)) })
  }
  inbox(kind: number, sender: Address, asset: number, amount: bigint, blob: Hex = '0x') {
    const index = BigInt(this.msgs.length + 1)
    const m = { index, kind, sender, asset, amount, blobHash: kind === KIND_INTENT ? keccak256(blob) : ZERO32, blob }
    this.msgs.push(m)
    this.accs.push(accStep(this.accs[this.accs.length - 1]!, msgHash(m)))
    this.st.inboxCount = index
    this.emit('InboxMessage', { index, kind, sender, asset, amount, blob })
  }
  intent(sender: Address, p: IntentPayload) {
    const blob = bytesToHex(encryptIntent(enclavePublicKey(SK), hexToBytes(encodePayload(p)), { chainId: 10143n, core: CORE, sender }))
    this.inbox(KIND_INTENT, sender, 0, 0n, blob)
  }
  settle(epoch: bigint, newRoot: Hex, inboxTo: bigint, clears: { tenorId: number; rateBps: number; volume: bigint }[] = []) {
    this.st = { ...this.st, stateRoot: newRoot, lastEpoch: epoch, cursor: inboxTo }
    this.emit('EpochSettled', { epoch, newRoot, inboxTo, asOf: T0, priceUsed: P })
    const tx = this.events[this.events.length - 1]!.transactionHash
    for (const c of clears) this.events.push({ eventName: 'Cleared', args: { epoch, ...c }, blockNumber: this.block, logIndex: 1, transactionHash: tx })
  }
  async finalizedBlock() { return this.block }
  async logs(from: bigint, to: bigint) {
    if (this.failAbove !== undefined && to - from + 1n > this.failAbove) throw new Error('range too large')
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to)
  }
  async inboxAcc(i: bigint) { return this.accs[Number(i)]! }
  async settlementState() { return this.st }
  async enclavePubKey() { return bytesToHex(enclavePublicKey(SK)) }
}

function setup() {
  const chain = new FakeChain()
  const db = new Db(':memory:')
  const logs: string[] = []
  const log = (m: string) => logs.push(m)
  const store = new StateStore(db, GENESIS, log)
  const indexer = new Indexer(db, store, chain, 101, 100, log)
  let now = T0
  const app = createApp({ db, store, src: chain, indexer, chainId: 10143, core: CORE, internalKey: KEY, webOrigin: 'http://localhost:5173', now: () => now, log })
  const req = (path: string, init: RequestInit = {}) => app.request(path, init)
  const auth = { authorization: `Bearer ${KEY}` }
  const sync = async () => { while (await indexer.step()) { /* drain */ } }

  /** The enclave: GET input → runEpoch → POST diff. Returns the report (chain settles separately). */
  async function enclaveEpoch() {
    const res = await req(`/internal/epoch-input?cursor=${chain.st.cursor}&limit=200`, { headers: auth })
    expect(res.status).toBe(200)
    const input = decodeEpochInput(await res.text())
    const out = runEpoch({
      prev: input.prev, inboxTo: input.inboxTo, messages: input.messages, openOrderBlobs: input.openOrderBlobs,
      onchain: { stateRoot: chain.st.stateRoot, cursor: chain.st.cursor, accCursor: chain.accs[Number(chain.st.cursor)]!, accTo: chain.accs[Number(input.inboxTo)]! },
      decrypt: makeDecryptor(SK, 10143n, CORE), price: P, priceRoundId: 1n, asOf: now, params: { grace: 60n }, treasury: TREASURY, demoMode: true,
    })
    const post = await req('/internal/epoch-output', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: encodeEpochDiff(out.diff) })
    expect(post.status).toBe(200)
    return out
  }
  const sign = async (w: ReturnType<typeof wallet>, issuedAt = now) => ({
    account: w.address, issuedAt: issuedAt.toString(),
    signature: await w.signTypedData({ domain: viewDomain(10143, CORE), types: VIEW_TYPES, primaryType: 'ViewAccount', message: { account: w.address, issuedAt } }),
  })
  const post = (path: string, body: unknown) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { chain, db, store, indexer, app, req, auth, sync, enclaveEpoch, sign, post, logs, setNow: (t: bigint) => { now = t } }
}

const p = (x: Partial<IntentPayload> & { action: number; nonce: bigint }): IntentPayload =>
  ({ version: PAYLOAD_VERSION, tenorId: 2, rateBps: 0, refId: 0n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n, ...x })

function demoBook(chain: FakeChain) {
  chain.inbox(KIND_DEPOSIT, A(ada), 0, 600_000_000n); chain.inbox(KIND_DEPOSIT, A(bola), 0, 600_000_000n)
  chain.inbox(KIND_DEPOSIT, A(chidi), 0, 1_000_000_000n); chain.inbox(KIND_DEPOSIT, A(dayo), 1, 85n * 10n ** 16n)
  chain.intent(A(ada), p({ action: ACTION_LEND, nonce: 1n, rateBps: 413, amount: 600_000_000n }))
  chain.intent(A(bola), p({ action: ACTION_LEND, nonce: 1n, rateBps: 527, amount: 600_000_000n }))
  chain.intent(A(chidi), p({ action: ACTION_LEND, nonce: 1n, rateBps: 611, amount: 1_000_000_000n }))
  chain.intent(A(dayo), p({ action: ACTION_BORROW, nonce: 1n, rateBps: 552, amount: 1_000_000_000n, collateral: 85n * 10n ** 16n }))
}

describe('internal API', () => {
  test('bearer auth', async () => {
    const t = setup()
    expect((await t.req('/ping')).status).toBe(200)
    expect((await t.req('/internal/epoch-input?cursor=0')).status).toBe(401)
    expect((await t.req('/internal/epoch-input?cursor=0', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
    expect((await t.req('/internal/epoch-input?cursor=0', { headers: t.auth })).status).toBe(200)
  })

  test('full loop: index → epoch-input → enclave → epoch-output → EpochSettled → committed; server root == chain root', async () => {
    const t = setup()
    demoBook(t.chain)
    await t.sync()
    expect(t.indexer.status.lastIdx).toBe(8)
    const out = await t.enclaveEpoch()
    expect(t.db.pendingCount()).toBe(1)
    t.chain.settle(1n, out.report.newRoot, out.report.inboxTo, out.report.clears)
    await t.sync()
    expect(t.store.head().root).toBe(out.report.newRoot)
    expect(merkleRoot(t.store.head().state)).toBe(t.chain.st.stateRoot)
    expect(t.db.lastEpoch()!.epoch).toBe(1)
    // epoch 2: heartbeat; open orders' blobs served from the index
    t.setNow(T0 + 30n)
    const out2 = await t.enclaveEpoch()
    t.chain.settle(2n, out2.report.newRoot, out2.report.inboxTo)
    await t.sync()
    expect(merkleRoot(t.store.head().state)).toBe(t.chain.st.stateRoot)
    expect(await t.indexer.checkAcc()).toBe(true)
  })

  test('409 on cursor mismatch; 409 unknown prev; 422 tampered diff; repeat POST idempotent', async () => {
    const t = setup()
    t.chain.inbox(KIND_DEPOSIT, A(ada), 0, 5n)
    await t.sync()
    expect((await t.req('/internal/epoch-input?cursor=3', { headers: t.auth })).status).toBe(409)
    const out = await t.enclaveEpoch()
    const body = encodeEpochDiff(out.diff)
    const postDiff = (b: string) => t.req('/internal/epoch-output', { method: 'POST', headers: t.auth, body: b })
    expect((await postDiff(body)).status).toBe(200) // idempotent repeat
    expect((await postDiff(body.replace('"usdFree":"5"', '"usdFree":"6"'))).status).toBe(422)
    expect((await postDiff(body.replace(out.diff.prevRoot, keccak256('0x01')))).status).toBe(409)
    expect((await postDiff('{nope')).status).toBe(400)
    expect(t.logs.some((l) => l.startsWith('E_DIFF_ROOT'))).toBe(true)
  })

  test('chain-root sync promotes a pending state before EpochSettled is indexed', async () => {
    const t = setup()
    t.chain.inbox(KIND_DEPOSIT, A(ada), 0, 5n)
    await t.sync()
    const out = await t.enclaveEpoch()
    t.chain.st = { ...t.chain.st, stateRoot: out.report.newRoot, lastEpoch: 1n, cursor: 1n } // settled, not yet indexed
    expect((await t.req('/internal/epoch-input?cursor=1&limit=200', { headers: t.auth })).status).toBe(200)
    expect(t.store.head().root).toBe(out.report.newRoot)
  })

  test('EpochSettled for an unknown root logs E_MISSING_PENDING; siblings get orphaned', async () => {
    const t = setup()
    t.chain.settle(1n, keccak256('0x99'), 0n)
    await t.sync()
    expect(t.logs.some((l) => l.startsWith('E_MISSING_PENDING'))).toBe(true)
  })
})

describe('indexer', () => {
  test('gap stops progress instead of skipping', async () => {
    const t = setup()
    t.chain.inbox(KIND_DEPOSIT, A(ada), 0, 1n)
    t.chain.events.push({ eventName: 'InboxMessage', args: { index: 3n, kind: 1, sender: A(ada), asset: 0, amount: 1n, blob: '0x' }, blockNumber: t.chain.block + 1n, logIndex: 0, transactionHash: keccak256('0x03') })
    t.chain.block += 1n
    await expect(t.indexer.step()).rejects.toThrow('E_INBOX_GAP')
    expect(t.db.lastInbox()?.idx ?? 0).toBe(0) // the whole range rolled back
  })

  test('adapts the log range to provider limits', async () => {
    const t = setup()
    t.chain.block = 400n
    t.chain.failAbove = 30n
    for (let i = 0; i < 4; i++) await t.indexer.step().catch(() => {})
    expect(await t.indexer.step()).toBe(true) // range shrank below the limit
  })

  test('accumulator cross-check catches divergence', async () => {
    const t = setup()
    t.chain.inbox(KIND_DEPOSIT, A(ada), 0, 1n)
    await t.sync()
    expect(await t.indexer.checkAcc()).toBe(true)
    t.chain.accs[1] = keccak256('0xbad')
    expect(await t.indexer.checkAcc()).toBe(false)
    expect(t.logs.some((l) => l.startsWith('E_ACC_MISMATCH'))).toBe(true)
  })
})

describe('public API', () => {
  async function settledDemo() {
    const t = setup()
    demoBook(t.chain)
    await t.sync()
    const out = await t.enclaveEpoch()
    t.chain.settle(1n, out.report.newRoot, out.report.inboxTo, out.report.clears)
    await t.sync()
    return t
  }

  test('/v1/account: EIP-712 auth; shows orders without rates and loans with the clearing rate', async () => {
    const t = await settledDemo()
    const r = await t.post('/v1/account', await t.sign(bola))
    expect(r.status).toBe(200)
    const v = await r.json() as { openOrders: Record<string, unknown>[]; loans: { role: string; clearingRateBps: number; share: string }[] }
    expect(v.openOrders.length).toBe(1)
    expect(Object.keys(v.openOrders[0]!).some((k) => /rate/i.test(k))).toBe(false)
    expect(v.loans).toHaveLength(1)
    expect(v.loans[0]).toMatchObject({ role: 'lender', clearingRateBps: 527, share: '400000000' })
    expect(JSON.stringify(v)).not.toContain('"413"')

    expect((await t.post('/v1/account', await t.sign(bola, T0 - 301n))).status).toBe(401)        // expired
    const forged = { ...(await t.sign(ada)), account: bola.address }                             // signer ≠ account
    expect((await t.post('/v1/account', forged)).status).toBe(401)
    expect((await t.post('/v1/account', { account: 'x' })).status).toBe(400)
  })

  test('/v1/proof: account and loan proofs verify against the committed root', async () => {
    const t = await settledDemo()
    const r = await t.post('/v1/proof', await t.sign(dayo))
    const b = await r.json() as { root: Hex; account: { leaf: Hex; proof: Hex[] }; loans: { leaf: Hex; proof: Hex[]; value: { lendersHash: Hex }; lenders: { lender: Address; amount: string }[] }[] }
    expect(b.root).toBe(t.chain.st.stateRoot)
    expect(verifyProof(b.account.proof, b.root, b.account.leaf)).toBe(true)
    expect(b.loans).toHaveLength(1)
    expect(verifyProof(b.loans[0]!.proof, b.root, b.loans[0]!.leaf)).toBe(true)
    expect(lendersHash(b.loans[0]!.lenders.map((x) => ({ lender: x.lender, amount: BigInt(x.amount) })))).toBe(b.loans[0]!.value.lendersHash)
    const stranger = wallet('stranger')
    expect((await t.post('/v1/proof', await t.sign(stranger))).status).toBe(404)
  })

  test('/v1/market, /v1/health, CORS', async () => {
    const t = await settledDemo()
    const m = await (await t.req('/v1/market')).json() as { clears: { tenorId: number; rateBps: number }[]; enclavePubKey: string }
    expect(m.clears).toEqual([{ tenorId: 2, rateBps: 527, volume: '1000000000', epoch: 1 }] as never)
    expect(m.enclavePubKey).toBe(bytesToHex(enclavePublicKey(SK)))
    const h = await (await t.req('/v1/health')).json() as { lastCommittedEpoch: number; pending: number }
    expect(h).toMatchObject({ lastCommittedEpoch: 1, pending: 0 })
    const pre = await t.req('/v1/market', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } })
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  test('no bid rate anywhere in the database (only the clearing rate)', async () => {
    const t = await settledDemo()
    const tables = ['inbox', 'states', 'epochs', 'clears', 'cursor']
    const values: string[] = []
    for (const tb of tables) for (const row of t.db.sql.query(`SELECT * FROM ${tb}`).all() as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(row)) {
        if (v instanceof Uint8Array) continue // ciphertext
        if (k === 'snapshot') JSON.stringify(JSON.parse(String(v)), (_k, x) => { if (typeof x !== 'object') values.push(String(x)); return x })
        else values.push(String(v))
      }
    }
    for (const r of ['413', '611', '552']) expect(values).not.toContain(r)
    expect(values).toContain('527') // clears.rate_bps and the loan's clearing rate
  })
})
