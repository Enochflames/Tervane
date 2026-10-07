// Decodes a Tervane transaction straight from the Monad RPC, for the demo terminal (explorers block headless capture):
// an intent shows its 350-byte sealed blob; a settlement shows its decoded TervaneCore events.
//   bun scripts/demo/show-tx.ts 0x<tx hash>
import { coreAbi, type Hex } from '@tervane/core'
import { decodeFunctionData, parseEventLogs, size } from 'viem'
import { dep, pub } from '../lib/chain'

const hash = process.argv[2] as Hex
if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new Error('usage: bun scripts/demo/show-tx.ts 0x<tx hash>')
const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })])
const FORWARDER = '0xb9f79d863261869b234c481d1f9a7af84aead192' // CRE MockKeystoneForwarder on Monad testnet (simulation)
const toLabel = tx.to?.toLowerCase() === FORWARDER ? '  (Chainlink CRE forwarder → TervaneCore.onReport)' : tx.to?.toLowerCase() === dep.tervaneCore.toLowerCase() ? '  (TervaneCore)' : ''
console.log(`tx      ${hash}\nblock   ${rc.blockNumber}   status ${rc.status}\nfrom    ${tx.from}\nto      ${tx.to}${toLabel}`)

if (tx.to?.toLowerCase() === dep.tervaneCore.toLowerCase()) {
  try {
    const call = decodeFunctionData({ abi: coreAbi, data: tx.input })
    console.log(`call    ${call.functionName}`)
    if (call.functionName === 'submitIntent') {
      const blob = (call.args as readonly [Hex])[0]
      console.log(`blob    ${size(blob)} bytes, sealed to the enclave key:`)
      for (let i = 2; i < blob.length; i += 96) console.log(`        ${blob.slice(i, i + 96)}`)
    }
  } catch { /* not a TervaneCore call we decode */ }
}
const events = parseEventLogs({ abi: coreAbi, logs: rc.logs })
for (const e of events) {
  const args = Object.entries(e.args as Record<string, unknown>)
    .filter(([k]) => k !== 'blob' && k !== 'newRoot')
    .map(([k, v]) => `${k}=${String(v)}`).join('  ')
  console.log(`event   ${e.eventName}  ${args}`)
}
