// Hono app (SERVER.md §1): request ids, typed errors, CORS for the web origin, no body logging.
import type { Address, Hex } from '@tervane/core'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ChainSource } from './chain'
import type { Db } from './db'
import { HttpError } from './errors'
import type { Indexer } from './indexer'
import { internalRoutes } from './routes/internal'
import { publicRoutes } from './routes/public'
import type { StateStore } from './state'

export interface AppDeps {
  db: Db; store: StateStore; src: ChainSource; indexer?: Indexer; chainId: number; core: Address; internalKey: string
  webOrigin: string; now?: () => bigint; log?: (m: string) => void
}

/** Promote a pending state as soon as the chain's stateRoot equals it (same effect as EpochSettled, earlier). */
export function chainSync(src: ChainSource, store: StateStore) {
  return async () => {
    const st = await src.settlementState()
    if (st.stateRoot.toLowerCase() !== store.head().root) store.commit(st.stateRoot.toLowerCase() as Hex)
  }
}

export function createApp(d: AppDeps) {
  const log = d.log ?? console.log
  const now = d.now ?? (() => BigInt(Math.floor(Date.now() / 1000)))
  const app = new Hono<{ Variables: { rid: string } }>()

  app.use('*', async (c, next) => {
    const rid = crypto.randomUUID().slice(0, 8)
    c.set('rid', rid)
    const t = performance.now()
    await next()
    log(`${rid} ${c.req.method} ${c.req.path} -> ${c.res.status} ${Math.round(performance.now() - t)}ms`)
  })
  app.use('/v1/*', cors({ origin: d.webOrigin, allowMethods: ['GET', 'POST'] }))

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ code: err.code, message: err.message, ...err.extra }, err.status)
    log(`${c.get('rid')} E_INTERNAL ${(err as Error).message.split('\n')[0]}`)
    return c.json({ code: 'E_INTERNAL', message: 'internal error' }, 500)
  })
  app.notFound((c) => c.json({ code: 'E_NOT_FOUND', message: 'not found' }, 404))

  app.get('/ping', (c) => c.text('pong'))
  app.route('/internal', internalRoutes(d.db, d.store, d.internalKey, chainSync(d.src, d.store)))
  app.route('/v1', publicRoutes({ db: d.db, store: d.store, src: d.src, indexer: d.indexer, chainId: d.chainId, core: d.core, now }))
  return app
}
