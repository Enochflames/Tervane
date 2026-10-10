// Public API (SERVER.md §5): market data, EIP-712-authenticated account views and proofs, health.
import type { Address } from '@tervane/core'
import { Hono } from 'hono'
import { authenticate } from '../auth'
import type { ChainSource } from '../chain'
import type { Db } from '../db'
import type { Indexer } from '../indexer'
import { accountView, proofBundle } from '../proofs'
import type { StateStore } from '../state'

export interface PublicDeps {
  db: Db; store: StateStore; src: ChainSource; indexer?: Indexer; chainId: number; core: Address; now: () => bigint
}

export function publicRoutes(d: PublicDeps) {
  const app = new Hono()
  let pkCache: { at: number; pk: string } | undefined

  app.get('/market', async (c) => {
    const st = await d.src.settlementState()
    if (!pkCache || Date.now() - pkCache.at > 10_000) pkCache = { at: Date.now(), pk: await d.src.enclavePubKey() }
    return c.json({
      epoch: String(st.lastEpoch), lastSettleAt: String(st.lastSettleAt), escaped: st.escaped,
      // Convenience only: clients must read enclavePubKey from the chain themselves (CLAUDE.md §3.5).
      enclavePubKey: pkCache.pk,
      clears: d.db.latestClears().map((x) => ({ tenorId: x.tenor_id, rateBps: x.rate_bps, volume: x.volume, epoch: x.epoch })),
    })
  })

  app.post('/account', async (c) => {
    const account = await authenticate(await c.req.json().catch(() => null), d.chainId, d.core, d.now())
    const head = d.store.head()
    const price = d.db.lastEpoch()?.price
    return c.json(accountView(head.state, head.root, account, price ? BigInt(price) : undefined, d.db.closedLoansFor(account.toLowerCase())))
  })

  app.post('/proof', async (c) => {
    const account = await authenticate(await c.req.json().catch(() => null), d.chainId, d.core, d.now())
    const head = d.store.head()
    return c.json(proofBundle(head.state, head.root, account))
  })

  app.get('/health', (c) => {
    const s = d.indexer?.status
    const head = d.store.head()
    return c.json({
      lastCommittedEpoch: head.epoch, root: head.root, pending: d.db.pendingCount(),
      indexer: s ? { lagBlocks: String(s.finalized > s.lastBlock ? s.finalized - s.lastBlock : 0n), lastBlock: String(s.lastBlock), lastInboxIdx: s.lastIdx, accOk: s.accOk, error: s.error ?? null } : null,
    })
  })

  return app
}
