// H1 simulate with --broadcast; prints the epoch stats line (liq=1 after the crash).
import { demoCtx, finish } from './ctx'
import { settle } from './steps'
const ctx = await demoCtx()
const r = await settle(ctx, `cron-${Date.now()}`, { trigger: 1 })
ctx.checks.ok('cron', 'heartbeat settled', r.ok)
await finish(ctx)
