// Enclave-only API (SERVER.md §4). Bearer auth protects availability and data minimization, not integrity:
// the enclave verifies everything it receives against chain commitments.
import { createHash, timingSafeEqual } from 'node:crypto'
import { decodeEpochDiff, encodeEpochInput, messageFromJson, type Hex } from '@tervane/core'
import { bytesToHex } from 'viem'
import { Hono } from 'hono'
import type { Db, InboxRow } from '../db'
import { HttpError } from '../errors'
import type { StateStore } from '../state'

const MAX_RESPONSE = 250_000 // CRE HTTP response limit
const digest = (s: string) => createHash('sha256').update(s).digest()

export function bearerOk(header: string | undefined, key: string): boolean {
  const got = header?.startsWith('Bearer ') ? header.slice(7) : ''
  return timingSafeEqual(digest(got), digest(key))
}

const toMessage = (r: InboxRow) => messageFromJson({
  index: String(r.idx), kind: r.kind, sender: r.sender, asset: r.asset, amount: r.amount, blobHash: r.blob_hash,
  blob: r.blob ? bytesToHex(r.blob) : '0x',
})

export function internalRoutes(db: Db, store: StateStore, key: string, sync: () => Promise<void>) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (!bearerOk(c.req.header('authorization'), key)) throw new HttpError(401, 'E_AUTH', 'bad bearer')
    await next()
  })

  app.get('/epoch-input', async (c) => {
    await sync().catch(() => {}) // best effort: promote a pending state the chain already settled
    const cursor = BigInt(c.req.query('cursor') ?? 'x')
    const limit = BigInt(c.req.query('limit') ?? '200')
    const head = store.head()
    if (cursor !== head.state.meta.cursor) {
      throw new HttpError(409, 'E_CURSOR', 'cursor disagrees with the committed state', { serverCursor: String(head.state.meta.cursor), root: head.root })
    }
    const lastIdx = BigInt(db.lastInbox()?.idx ?? 0)
    let to = cursor + limit < lastIdx ? cursor + limit : lastIdx
    const blobs = new Map<bigint, Hex>()
    for (const id of head.state.orders.keys()) {
      const r = db.inboxAt(Number(id))
      if (!r?.blob) throw new HttpError(503, 'E_MISSING_BLOB', `blob for order ${id} not indexed`)
      blobs.set(id, bytesToHex(r.blob))
    }
    for (;;) {
      const msgs = db.inboxRange(Number(cursor) + 1, Number(to)).map(toMessage)
      const body = encodeEpochInput({ prev: head.state, inboxTo: to, messages: msgs, openOrderBlobs: blobs })
      if (body.length <= MAX_RESPONSE) return c.body(body, 200, { 'content-type': 'application/json' })
      if (to === cursor) throw new HttpError(413, 'E_TOO_LARGE', 'state + open-order blobs exceed 250 KB')
      to = cursor + (to - cursor) / 2n
    }
  })

  app.post('/epoch-output', async (c) => {
    let diff
    try { diff = decodeEpochDiff(await c.req.text()) } catch { throw new HttpError(400, 'E_DECODE', 'malformed EpochDiff') }
    const root = store.putPending(diff)
    return c.json({ root, status: 'pending' })
  })

  return app
}
