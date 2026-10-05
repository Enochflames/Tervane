// Gate 7, one command: fresh deploy → settler config → gate7.ts → leak audit, then the web deployment is restored.
// Escape is permanent, so this never touches the deployment the web client uses.
//   set -a; . settler/.env; set +a; bun scripts/demo/run-gate7.ts
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const root = join(import.meta.dir, '..', '..')
const live = join(root, 'deployments/monad-testnet.json')
const backup = join(root, 'scripts/demo/.out/monad-testnet.web.json')
const env = { ...process.env, PATH: `${join(homedir(), '.bun/bin')}:${join(homedir(), '.cre/bin')}:${join(homedir(), '.foundry/bin')}:${process.env.PATH}` }
const run = async (label: string, cmd: string[], cwd: string, extraEnv: Record<string, string> = {}, quiet = false) => {
  console.log(`\n=== ${label}`)
  const p = Bun.spawn(cmd, { cwd, env: { ...env, ...extraEnv }, stdout: quiet ? 'pipe' : 'inherit', stderr: 'inherit' })
  const out = quiet ? await new Response(p.stdout).text() : ''
  return { ok: (await p.exited) === 0, out }
}

if (!process.env.CRE_ETH_PRIVATE_KEY || !process.env.TERVANE_ENCLAVE_SK) throw new Error('load settler/.env first')
const deployerPk = `0x${process.env.CRE_ETH_PRIVATE_KEY.replace(/^0x/, '')}`
// One run (deploy, settle, funding, escape txs) costs ~1.1 MON on Monad testnet, which charges the full gas limit.
const { accountFromEnv, pub } = await import('../lib/chain')
const mon = await pub.getBalance({ address: accountFromEnv().address })
if (mon < 1_500_000_000_000_000_000n) throw new Error(`deployer has ${Number(mon) / 1e18} MON; Gate 7 needs at least 1.5`)
copyFileSync(live, backup)
let gateOk = false, auditOk = false
try {
  const d = await run('fresh deploy (forge script)', ['forge', 'script', 'script/Deploy.s.sol:Deploy', '--rpc-url', 'monad_testnet',
    '--gas-estimate-multiplier', '115', '--broadcast', '--slow'], join(root, 'contracts'), { DEPLOYER_PK: deployerPk }, true)
  console.log(d.out.split('\n').filter((l) => /TervaneCore|tUSD|tETH|feed|ONCHAIN/.test(l)).join('\n'))
  if (!d.ok) throw new Error('deploy failed')
  if (!(await run('settler config', ['bun', 'scripts/gen-settler-config.ts'], root)).ok) throw new Error('settler config failed')
  gateOk = (await run('gate 7', ['bun', 'scripts/demo/gate7.ts'], root)).ok
  auditOk = (await run('leak audit', ['bun', 'scripts/audit-leaks.ts'], root)).ok
  copyFileSync(live, join(root, 'deployments/archive/monad-testnet-gate7.json'))
} finally {
  copyFileSync(backup, live)
  // The committed settler config points at the default :8787 server, whatever port this run used.
  await run('restore web deployment + settler config', ['bun', 'scripts/gen-settler-config.ts', '--server', 'http://localhost:8787'], root)
}
console.log(`\nGATE 7: escape ${gateOk ? 'PASS' : 'FAIL'}, leak audit ${auditOk ? 'CLEAN' : 'FAIL'}`)
process.exit(gateOk && auditOk ? 0 : 1)
