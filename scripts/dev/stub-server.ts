// Gate 3 stub of the Tervane server (Phase 4 replaces it): serves epoch inputs for a hand-crafted inbox and
// accepts epoch outputs. Pending states are promoted when the chain's stateRoot reaches them (ARCHITECTURE §4.3).
// Env: TERVANE_SERVER_API_KEY (never logged), MONAD_TESTNET_RPC. Inbox: scripts/dev/.data/inbox.json.
import { applyDiff, coreAbi, decodeEpochDiff, encodeEpochInput, genesisState, merkleRoot, messageFromJson, type Hex, type LedgerState } from '@tervane/core'
import { createPublicClient, http } from 'viem'
import { join } from 'node:path'

const KEY = process.env.TERVANE_SERVER_API_KEY ?? ''
if (KEY.length < 32) throw new Error('TERVANE_SERVER_API_KEY missing')
const root = join(import.meta.dir, '..', '..')
const dep = await Bun.file(join(root, 'deployments/monad-testnet.json')).json()
const client = createPublicClient({ transport: http(process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz') })
const inboxFile = join(import.meta.dir, '.data/inbox.json')

let committed: LedgerState = genesisState()
const pending = new Map<Hex, LedgerState>()

async function promote() {
  const st = await client.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'settlementState' })
  const p = pending.get(st.stateRoot.toLowerCase() as Hex)
  if (p) { committed = p; pending.clear(); console.log(`promoted epoch ${p.meta.epoch} root ${st.stateRoot}`) }
}

Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/ping') return new Response('pong')
    if (req.headers.get('authorization') !== `Bearer ${KEY}`) { console.log(`${req.method} ${url.pathname} -> 401`); return new Response('unauthorized', { status: 401 }) }
    if (req.method === 'GET' && url.pathname === '/internal/epoch-input') {
      await promote()
      const cursor = BigInt(url.searchParams.get('cursor') ?? '0'), limit = BigInt(url.searchParams.get('limit') ?? '200')
      const all = ((await Bun.file(inboxFile).json()) as unknown[]).map(messageFromJson)
      const msgs = all.filter((m) => m.index > cursor && m.index <= cursor + limit)
      const blobs = new Map<bigint, Hex>()
      for (const id of committed.orders.keys()) blobs.set(id, all[Number(id) - 1]!.blob)
      const inboxTo = msgs.length ? msgs[msgs.length - 1]!.index : cursor
      console.log(`GET epoch-input cursor=${cursor} -> ${msgs.length} msgs, root ${merkleRoot(committed)}`)
      return new Response(encodeEpochInput({ prev: committed, inboxTo, messages: msgs, openOrderBlobs: blobs }), { headers: { 'content-type': 'application/json' } })
    }
    if (req.method === 'POST' && url.pathname === '/internal/epoch-output') {
      try {
        const diff = decodeEpochDiff(await req.text())
        const next = applyDiff(committed, diff) // recomputes and checks newRoot
        pending.set(diff.newRoot, next)
        console.log(`POST epoch-output epoch=${diff.epoch} newRoot=${diff.newRoot} (pending)`)
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      } catch (e) {
        console.log(`POST epoch-output rejected: ${(e as Error).message}`)
        return new Response('bad diff', { status: 422 })
      }
    }
    return new Response('not found', { status: 404 })
  },
})
console.log('stub server on :8787')
