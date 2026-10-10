// DEMO-SCRIPT §5 preflight checklist (green/red). Run before recording.
// --live: for a demo on a deployment already in use (no 'fresh deployment' checks); everything must be in sync now.
//   set -a; . settler/.env; set +a; TERVANE_SERVER_PORT=8797 bun scripts/demo/00-preflight.ts --live
import { bytesToHex, formatEther, hexToBytes } from 'viem'
import { coreAbi, enclavePublicKey, feedAbi } from '@tervane/core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountFromEnv, dep, pub, settlement } from '../lib/chain'
import { SERVER, health } from '../lib/api'
import { Checks, ROOT_CHECK, wallets } from './preflight-lib'

const c = new Checks()
const LIVE = process.argv.includes('--live')
const PATH = `${join(homedir(), '.cre/bin')}:${process.env.PATH}`
const sh = async (cmd: string[]) => { const p = Bun.spawn(cmd, { env: { ...process.env, PATH }, stdout: 'pipe', stderr: 'pipe' }); return (await new Response(p.stdout).text()) + (await new Response(p.stderr).text()) }
const ver = (await sh(['cre', 'version'])).match(/v(\d+)\.(\d+)\.(\d+)/)
c.ok('cre', 'CRE CLI ≥ 1.30', !!ver && (Number(ver[1]) > 1 || Number(ver[2]) >= 30), ver?.[0])
c.ok('cre', 'cre login valid + monad-testnet supported', (await sh(['cre', 'workflow', 'supported-chains', '--output', 'json'])).includes('"monad-testnet"'))
const deployer = accountFromEnv()
const minMon = LIVE ? 5n * 10n ** 17n : 10n ** 18n // live: ~25 epochs + a price change; fresh: a deploy
c.ok('gas', `CRE_ETH_PRIVATE_KEY ≥ ${formatEther(minMon)} MON`, (await pub.getBalance({ address: deployer.address })) >= minMon, formatEther(await pub.getBalance({ address: deployer.address })))
for (const [n, a] of Object.entries(await wallets())) {
  const b = await pub.getBalance({ address: a.address })
  c.ok('gas', `${n} ≥ 0.2 MON`, b >= 2n * 10n ** 17n, formatEther(b).slice(0, 6))
}
const st = await settlement()
if (!LIVE) c.ok('chain', 'fresh deployment (epoch 0, empty inbox)', st.lastEpoch === 0n && st.inboxCount === 0n, `epoch ${st.lastEpoch}, inbox ${st.inboxCount}`)
const fwd = await pub.readContract({ address: dep.tervaneCore, abi: [{ type: 'function', name: 'getForwarderAddress', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }], functionName: 'getForwarderAddress' })
c.ok('chain', 'forwarder == monad-testnet mock forwarder', fwd.toLowerCase() === '0xb9f79d863261869b234c481d1f9a7af84aead192')
const pk = await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey' })
c.ok('chain', 'enclavePubKey == key derived from TERVANE_ENCLAVE_SK', pk.toLowerCase() === bytesToHex(enclavePublicKey(hexToBytes(process.env.TERVANE_ENCLAVE_SK as `0x${string}`))))
const [round, answer, , updatedAt] = await pub.readContract({ address: dep.priceFeed, abi: feedAbi, functionName: 'latestRoundData' })
const now = (await pub.getBlock()).timestamp
if (LIVE) {
  c.ok('chain', 'not escaped', !st.escaped)
  const quiet = now - st.lastSettleAt
  c.ok('chain', 'settled recently (escape clock far from ESCAPE_DELAY)', quiet < 300n, `${quiet}s since last epoch`)
  c.ok('chain', 'price feed fresh (< 20 h; the auto-settler refreshes it)', now - updatedAt < 72_000n, `$${answer / 10n ** 8n}, ${(now - updatedAt) / 60n} min old`)
} else c.ok('chain', 'mock feed 2500e8, round 1, fresh', answer === 2500n * 10n ** 8n && round === 1n && now - updatedAt <= 86_400n)
try {
  const h = await health()
  c.ok('server', 'server up, indexer lag < 5 blocks', Number(h.indexer?.lagBlocks ?? 99) < 5, `lag ${h.indexer?.lagBlocks}`)
  c.ok('server', 'every onchain inbox message indexed', (h.indexer?.lastInboxIdx ?? -1) >= Number(st.inboxCount), `server #${h.indexer?.lastInboxIdx}, chain #${st.inboxCount}`)
  if (LIVE) c.ok('server', 'server root == chain root (nothing pending)', h.root === st.stateRoot.toLowerCase(), `epoch ${h.lastCommittedEpoch}`)
} catch { c.ok('server', 'server up', false, `not reachable at ${SERVER}`) }
const cfg = await Bun.file(join(ROOT_CHECK, 'settler/settle/config.staging.json')).json()
c.ok('config', 'settler config matches deployment', cfg.coreAddress === dep.tervaneCore && cfg.priceFeedAddress === dep.priceFeed && cfg.debugLogs === true)
c.ok('config', 'settler config points at this server', String(cfg.serverUrl).replace(/\/$/, '') === SERVER, `${cfg.serverUrl}`)
process.exit(c.passed ? 0 : 1)
