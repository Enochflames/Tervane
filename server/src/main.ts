// Server entry: env → DB → state store → indexer loop → HTTP.
import { addr, type Hex } from '@tervane/core'
import { createApp } from './app'
import { viemSource } from './chain'
import { Db } from './db'
import { loadDeployment, loadEnv } from './env'
import { Indexer } from './indexer'
import { StateStore } from './state'

const env = loadEnv()
const dep = await loadDeployment(env.DEPLOYMENT_FILE)
const db = new Db(env.DB_PATH)
const store = new StateStore(db, dep.genesisRoot as Hex)
const src = viemSource(env.MONAD_TESTNET_RPC, dep)
const indexer = new Indexer(db, store, src, dep.deployBlock, env.LOG_RANGE)
const app = createApp({ db, store, src, indexer, chainId: dep.chainId, core: addr(dep.tervaneCore), internalKey: env.INTERNAL_API_KEY, webOrigin: env.WEB_ORIGIN })

const stop = new AbortController()
indexer.run(env.POLL_MS, stop.signal)
const http = Bun.serve({ port: env.PORT, fetch: app.fetch })
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { stop.abort(); http.stop(); db.close(); process.exit(0) })
}
console.log(`tervane server :${env.PORT} core=${dep.tervaneCore} from block ${dep.deployBlock}`)
