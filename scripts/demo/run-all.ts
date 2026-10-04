// Gate 5, one command: fresh deploy → settler config → scenarios 1–8 → leak audit.
//   set -a; . settler/.env; set +a; bun scripts/demo/run-all.ts
import { join } from 'node:path'
import { homedir } from 'node:os'

const root = join(import.meta.dir, '..', '..')
const env = { ...process.env, PATH: `${join(homedir(), '.bun/bin')}:${join(homedir(), '.cre/bin')}:${join(homedir(), '.foundry/bin')}:${process.env.PATH}` }
const run = async (label: string, cmd: string[], cwd: string, extraEnv: Record<string, string> = {}, quiet = false) => {
  console.log(`\n=== ${label}`)
  const p = Bun.spawn(cmd, { cwd, env: { ...env, ...extraEnv }, stdout: quiet ? 'pipe' : 'inherit', stderr: 'inherit' })
  const out = quiet ? await new Response(p.stdout).text() : ''
  if ((await p.exited) !== 0) { console.log(out); console.log(`${label} FAILED`); process.exit(1) }
  return out
}

if (!process.env.CRE_ETH_PRIVATE_KEY || !process.env.TERVANE_ENCLAVE_SK) throw new Error('load settler/.env first')
const deployerPk = `0x${process.env.CRE_ETH_PRIVATE_KEY.replace(/^0x/, '')}`
const out = await run('fresh deploy (forge script)', ['forge', 'script', 'script/Deploy.s.sol:Deploy', '--rpc-url', 'monad_testnet',
  '--gas-estimate-multiplier', '115', '--broadcast', '--slow'], join(root, 'contracts'), { DEPLOYER_PK: deployerPk }, true)
console.log(out.split('\n').filter((l) => /TervaneCore|tUSD|tETH|feed|ONCHAIN/.test(l)).join('\n'))
await run('settler config', ['bun', 'scripts/gen-settler-config.ts'], root)
const scen = Bun.spawn(['bun', 'scripts/demo/scenarios.ts'], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' })
const scenOk = (await scen.exited) === 0
const audit = Bun.spawn(['bun', 'scripts/audit-leaks.ts'], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' })
const auditOk = (await audit.exited) === 0
console.log(`\nGATE 5: scenarios ${scenOk ? 'PASS' : 'FAIL'}, leak audit ${auditOk ? 'CLEAN' : 'FAIL'}`)
process.exit(scenOk && auditOk ? 0 : 1)
