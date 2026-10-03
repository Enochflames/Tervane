// Gate 3 check: recompute the epoch-1 root with packages/core from genesis + the recorded inbox, independently
// of the settler, and compare it with TervaneCore.stateRoot. Usage: bun scripts/dev/check-root.ts <onchainRoot>
import { ZERO32, accStep, addr, genesisState, merkleRoot, messageFromJson, msgHash, runEpoch, type Hex } from '@tervane/core'
import { join } from 'node:path'
const dep = await Bun.file(join(import.meta.dir, '../../deployments/monad-testnet.json')).json()
const msgs = ((await Bun.file(join(import.meta.dir, '.data/inbox.json')).json()) as unknown[]).map(messageFromJson)
let acc: Hex = ZERO32
for (const m of msgs) acc = accStep(acc, msgHash(m))
const prev = genesisState()
const out = runEpoch({ prev, inboxTo: BigInt(msgs.length), messages: msgs, openOrderBlobs: new Map(),
  onchain: { stateRoot: merkleRoot(prev), cursor: 0n, accCursor: ZERO32, accTo: acc }, decrypt: () => null,
  price: 2500n * 10n ** 8n, priceRoundId: 1n, asOf: 0n, params: { grace: 60n }, treasury: addr(dep.treasury), demoMode: true })
const onchain = (process.argv[2] ?? '').toLowerCase()
console.log(`core-computed root ${out.report.newRoot}`)
console.log(onchain === out.report.newRoot ? 'MATCH: onchain stateRoot == packages/core root' : 'MISMATCH')
