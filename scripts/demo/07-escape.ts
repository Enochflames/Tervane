// Waits out ESCAPE_DELAY, activateEscape, Chidi exitAccount with a server-supplied proof.
import { demoCtx, finish } from './ctx'
import { scenario8 } from './steps'
const ctx = await demoCtx()
await scenario8(ctx)
await finish(ctx)
