// onReport(metadata, validLookingReport) from Ada's EOA → InvalidSender.
import { demoCtx, finish } from './ctx'
import { scenario7 } from './steps'
const ctx = await demoCtx()
await scenario7(ctx)
await finish(ctx)
