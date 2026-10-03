// Fetches an account proof and calls verifyAccount → true; prints only tier + repaid volume.
import { demoCtx } from './ctx'
import { creditProof } from './steps'
const ctx = await demoCtx()
for (const who of ['bola', 'ada'] as const) await creditProof(ctx, who)
