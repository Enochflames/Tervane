// DEMO-SCRIPT §5 preflight checklist (green/red). Run before recording.
import { bytesToHex, formatEther, hexToBytes } from 'viem'
import { coreAbi, enclavePublicKey, feedAbi } from '@tervane/core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountFromEnv, dep, pub, settlement } from '../lib/chain'
import { health } from '../lib/api'
import { Checks, ROOT_CHECK, wallets } from './preflight-lib'

const c = new Checks()
const PATH = `${join(homedir(), '.cre/bin')}:${process.env.PATH}`
const sh = async (cmd: string[]) => { const p = Bun.spawn(cmd, { env: { ...process.env, PATH }, stdout: 'pipe', stderr: 'pipe' }); return (await new Response(p.stdout).text()) + (await new Response(p.stderr).text()) }
const ver = (await sh(['cre', 'version'])).match(/v(\d+)\.(\d+)\.(\d+)/)
c.ok('cre', 'CRE CLI ≥ 1.30', !!ver && (Number(ver[1]) > 1 || Number(ver[2]) >= 30), ver?.[0])
c.ok('cre', 'cre login valid + monad-testnet supported', (await sh(['cre', 'workflow', 'supported-chains', '--output', 'json'])).includes('"monad-testnet"'))
const deployer = accountFromEnv()
c.ok('gas', 'CRE_ETH_PRIVATE_KEY ≥ 1 MON', (await pub.getBalance({ address: deployer.address })) >= 10n ** 18n, formatEther(await pub.getBalance({ address: deployer.address })))
for (const [n, a] of Object.entries(await wallets())) {
  const b = await pub.getBalance({ address: a.address })
  c.ok('gas', `${n} ≥ 0.2 MON`, b >= 2n * 10n ** 17n, formatEther(b).slice(0, 6))
}
const st = await settlement()
c.ok('chain', 'fresh deployment (epoch 0, empty inbox)', st.lastEpoch === 0n && st.inboxCount === 0n, `epoch ${st.lastEpoch}, inbox ${st.inboxCount}`)
const fwd = await pub.readContract({ address: dep.tervaneCore, abi: [{ type: 'function', name: 'getForwarderAddress', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }], functionName: 'getForwarderAddress' })
c.ok('chain', 'forwarder == monad-testnet mock forwarder', fwd.toLowerCase() === '0xb9f79d863261869b234c481d1f9a7af84aead192')
const pk = await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey' })
c.ok('chain', 'enclavePubKey == key derived from TERVANE_ENCLAVE_SK', pk.toLowerCase() === bytesToHex(enclavePublicKey(hexToBytes(process.env.TERVANE_ENCLAVE_SK as `0x${string}`))))
const [round, answer, , updatedAt] = await pub.readContract({ address: dep.priceFeed, abi: feedAbi, functionName: 'latestRoundData' })
const now = (await pub.getBlock()).timestamp
c.ok('chain', 'mock feed 2500e8, round 1, fresh', answer === 2500n * 10n ** 8n && round === 1n && now - updatedAt <= 86_400n)
try {
  const h = await health()
  c.ok('server', 'server up, indexer lag < 5 blocks', Number(h.indexer?.lagBlocks ?? 99) < 5, `lag ${h.indexer?.lagBlocks}`)
} catch { c.ok('server', 'server up', false, 'not reachable on :8787') }
const cfg = await Bun.file(join(ROOT_CHECK, 'settler/settle/config.staging.json')).json()
c.ok('config', 'settler config matches deployment', cfg.coreAddress === dep.tervaneCore && cfg.priceFeedAddress === dep.priceFeed && cfg.debugLogs === true)
process.exit(c.passed ? 0 : 1)
