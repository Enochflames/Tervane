// Gate 5 scenarios 1–8 against the deployment in deployments/monad-testnet.json (fresh: epoch 0).
// Starts its own server on a fresh SQLite DB. Env: settler/.env loaded (CRE_ETH_PRIVATE_KEY, TERVANE_SERVER_API_KEY).
import { join } from 'node:path'
import { accountFromEnv, dep, settlement } from '../lib/chain'
import { Checks, OUT, ServerProc, loadState, saveState, table, wallets } from './lib'
import { creditProof, fund, scenario1, scenario2and5, scenario3and4, scenario6, scenario7, scenario8, seed, showAccounts, type Ctx } from './steps'

const st0 = await settlement()
if (st0.lastEpoch !== 0n || st0.inboxCount !== 0n) throw new Error('deployment is not fresh (epoch 0, empty inbox)')

const state = { ...(await loadState()), core: dep.tervaneCore, txs: {}, notes: {} }
const server = new ServerProc(join(import.meta.dir, '..', '..', 'server', 'data', `demo-${Date.now()}.db`))
state.serverDb = server.dbPath
await Bun.write(join(OUT, 'server.log'), '')
await server.start()
const ctx: Ctx = { w: await wallets(), deployer: accountFromEnv(), state, checks: new Checks(), server }

try {
  console.log(`core ${dep.tervaneCore}\n\n[setup] fund demo wallets`)
  await fund(ctx)
  console.log('\n[01] seed the demo book')
  await seed(ctx)
  await scenario1(ctx)
  await scenario2and5(ctx)
  await scenario3and4(ctx)
  await showAccounts(ctx)
  await scenario6(ctx)
  await scenario7(ctx)
  console.log('\n[08] credit proofs (selective disclosure)')
  ctx.checks.ok('extra', 'verifyAccount(Ada) and verifyAccount(Bola) true', (await creditProof(ctx, 'ada')) && (await creditProof(ctx, 'bola')))
  await scenario8(ctx)
} catch (e) {
  ctx.checks.ok('run', 'no unexpected error', false, (e as Error).message.split('\n')[0])
} finally {
  await saveState(state)
  await server.stop()
}

console.log('\n── Gate 5 summary ──')
const by = new Map<string, boolean>()
for (const r of ctx.checks.results) by.set(r.scenario, (by.get(r.scenario) ?? true) && r.ok)
table([...by].map(([scenario, ok]) => ({ scenario, result: ok ? 'PASS' : 'FAIL' })))
process.exit(ctx.checks.passed ? 0 : 1)
