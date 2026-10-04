// Gate 4 (BUILD-PLAN Phase 4): full loop without the web app, against the real server and Monad testnet.
//   deposit + submit intent → server indexes → simulate H0 with the intent tx → server promotes pending
//   → /v1/account shows the order → simulate H1 (heartbeat) → server root == chain root at every step.
// Env (from settler/.env): CRE_ETH_PRIVATE_KEY. Server must be running on SERVER_URL.
import { ACTION_LEND, PAYLOAD_VERSION } from '@tervane/core'
import { accountView, health, waitIndexed } from '../lib/api'
import { accountFromEnv, deposit, dep, mint, settlement, submitIntent } from '../lib/chain'
import { simulate } from '../lib/cre'

const user = accountFromEnv()
const check = async (label: string) => {
  const st = await settlement()
  let h = await health()
  for (let i = 0; i < 30 && h.root !== st.stateRoot.toLowerCase(); i++) { await Bun.sleep(1000); h = await health() }
  const ok = h.root === st.stateRoot.toLowerCase()
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${label}: chain epoch ${st.lastEpoch} root ${st.stateRoot} | server epoch ${h.lastCommittedEpoch} root ${h.root} pending ${h.pending}`)
  if (!ok) process.exit(1)
}
const sim = async (label: string, o: Parameters<typeof simulate>[0]) => {
  const r = await simulate(o)
  console.log(`${label}: ${r.ok ? 'tx ' + r.result : 'FAILED'}${r.userLogs.length ? '\n    ' + r.userLogs.join('\n    ') : ''}`)
  if (!r.ok) { console.log(r.output.split('\n').filter((l) => /rror|✗/.test(l)).join('\n')); process.exit(1) }
  return r
}

await check('genesis')
await mint(user, dep.usdToken, user.address, 600_000_000n)
await deposit(user, 0, 600_000_000n)
const intentTx = await submitIntent(user, { version: PAYLOAD_VERSION, action: ACTION_LEND, tenorId: 2, rateBps: 461, nonce: 1n, refId: 0n, expiresAtEpoch: 0n, amount: 250_000_000n, collateral: 0n })
console.log(`deposit + intent submitted (intent tx ${intentTx})`)
await waitIndexed(2)
console.log('server indexed inbox #1..#2')

await sim('H0 log trigger (intent tx)', { trigger: 0, txHash: intentTx, broadcast: true })
await check('after H0')
const v = await accountView(user)
console.log(`/v1/account: epoch ${v.epoch}, usdFree ${v.account?.usdFree}, usdReserved ${v.account?.usdReserved}, open orders ${v.openOrders.length} ` +
  `(fields: ${Object.keys(v.openOrders[0] ?? {}).join(',')})`)
if (v.openOrders.length !== 1) { console.log('[FAIL] order not visible'); process.exit(1) }

await sim('H1 cron heartbeat', { trigger: 1, broadcast: true })
await check('after H1')
console.log('Gate 4 PASS')
