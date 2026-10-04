// H0 simulate on DAYO_TX with --broadcast; asserts Cleared(1, 2, 527, 1000e6) onchain.
import { demoCtx, finish } from './ctx'
import { scenario1 } from './steps'
const ctx = await demoCtx()
await scenario1(ctx)
await finish(ctx)
