// Writes settler/settle/config.{staging,production}.json from deployments/monad-testnet.json (CRE-WORKFLOW §3.4).
// Usage: bun scripts/gen-settler-config.ts [--server http://localhost:8787]   (default port: TERVANE_SERVER_PORT or 8787)
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const dep = await Bun.file(join(root, 'deployments/monad-testnet.json')).json()
const serverArg = process.argv.indexOf('--server')
const serverUrl = serverArg > 0 ? process.argv[serverArg + 1]! : `http://localhost:${process.env.TERVANE_SERVER_PORT || 8787}`

// D-22 write-gas constants, calibrated on the Gate 3 broadcast trace (tx 0x55215835…7a9f): intrinsic 21k,
// forwarder ~40.4k, _processReport ~48.9k (Foundry's monad model overstates this ~2x). perPayout stays a
// conservative upper bound until an epoch with payouts is traced (Phase 5). See CONTRACTS.md §5.
const writeGas = {
  base: '110500',
  perPayout: '50000',
  perClear: '4000',
  overheadBytes: '1100', // forwarder metadata + signatures (S3: 1,124 B calldata for a 32 B payload)
  perByte: '16',
  headroomBps: '12000',
  max: '2500000',
}

const base = {
  chainName: dep.chainName,
  chainId: String(dep.chainId),
  coreAddress: dep.tervaneCore,
  priceFeedAddress: dep.priceFeed,
  usdTokenAddress: dep.usdToken,
  ethTokenAddress: dep.ethToken,
  treasuryAddress: dep.treasury,
  serverUrl,
  cronSchedule: '*/30 * * * * *',
  maxInboxPerEpoch: 200,
  writeGas,
}
const write = (name: string, x: object) => Bun.write(join(root, 'settler/settle', name), `${JSON.stringify(x, null, 2)}\n`)
await write('config.staging.json', { ...base, demoMode: true, debugLogs: true })
await write('config.production.json', { ...base, demoMode: false, debugLogs: false })
console.log(`wrote settler/settle/config.{staging,production}.json for core ${dep.tervaneCore}`)
