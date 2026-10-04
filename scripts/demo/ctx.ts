// Context for the individual demo scripts (server already running on :8787, settler/.env loaded).
import { accountFromEnv } from '../lib/chain'
import { Checks, ServerProc, loadState, saveState, wallets } from './lib'
import type { Ctx } from './steps'

export async function demoCtx(): Promise<Ctx> {
  const state = await loadState()
  return { w: await wallets(), deployer: accountFromEnv(), state, checks: new Checks(), server: new ServerProc(state.serverDb ?? '') }
}
export async function finish(ctx: Ctx) {
  await saveState(ctx.state)
  process.exit(ctx.checks.passed ? 0 : 1)
}
