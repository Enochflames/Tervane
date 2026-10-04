// Faucet → approve → deposit → encrypt + submitIntent for the four wallets (DEMO-SCRIPT §2 inbox order).
import { demoCtx, finish } from './ctx'
import { fund, seed } from './steps'
const ctx = await demoCtx()
await fund(ctx)
await seed(ctx)
await finish(ctx)
