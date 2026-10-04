// Tampers the committed snapshot (Ada +1 tUSD), runs H1 (expects E_ROOT_MISMATCH, no tx), restores the DB.
// Runs its own server process on the demo DB: stop any other server on :8787 first.
import { demoCtx, finish } from './ctx'
import { scenario6 } from './steps'
const ctx = await demoCtx()
await ctx.server.start()
await scenario6(ctx)
await ctx.server.stop()
await finish(ctx)
