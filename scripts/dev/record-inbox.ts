// Appends the InboxMessage(s) emitted by a tx to scripts/dev/.data/inbox.json (hand-crafted Gate 3 inbox).
// Usage: bun scripts/dev/record-inbox.ts <txHash>
import { coreAbi, messageToJson, ZERO32, type Hex } from '@tervane/core'
import { createPublicClient, http, keccak256, parseEventLogs } from 'viem'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const tx = process.argv[2] as Hex
const client = createPublicClient({ transport: http(process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz') })
const receipt = await client.getTransactionReceipt({ hash: tx })
const logs = parseEventLogs({ abi: coreAbi, eventName: 'InboxMessage', logs: receipt.logs })
const dir = join(import.meta.dir, '.data'); mkdirSync(dir, { recursive: true })
const file = join(dir, 'inbox.json')
const inbox: unknown[] = existsSync(file) ? await Bun.file(file).json() : []
for (const l of logs) {
  const a = l.args
  const m = { index: a.index, kind: a.kind, sender: a.sender.toLowerCase() as Hex, asset: a.asset, amount: a.amount,
    blobHash: a.kind === 2 ? keccak256(a.blob) : ZERO32, blob: a.blob }
  inbox.push(messageToJson(m))
  console.log(`recorded inbox #${a.index} kind=${a.kind} sender=${a.sender}`)
}
await Bun.write(file, JSON.stringify(inbox, null, 2))
