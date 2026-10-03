// Dev helper: encrypts an IntentPayload to the enclave key READ FROM THE CHAIN (CLAUDE.md §3.5) and submits it.
// Prints only the tx hash and blob size, never payload fields. Env: CRE_ETH_PRIVATE_KEY, MONAD_TESTNET_RPC.
// Usage: bun scripts/dev/submit-intent.ts '<payload json with decimal-string bigints>'
import { coreAbi, encodePayload, encryptIntent, PAYLOAD_VERSION, type IntentPayload } from '@tervane/core'
import { createPublicClient, createWalletClient, defineChain, hexToBytes, bytesToHex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { join } from 'node:path'

const dep = await Bun.file(join(import.meta.dir, '../../deployments/monad-testnet.json')).json()
const rpc = process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz'
const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
const account = privateKeyToAccount(`0x${(process.env.CRE_ETH_PRIVATE_KEY ?? '').replace(/^0x/, '')}`)
const pub = createPublicClient({ chain, transport: http(rpc) })
const wallet = createWalletClient({ chain, account, transport: http(rpc) })

const raw = JSON.parse(process.argv[2] ?? '{}')
const p: IntentPayload = {
  version: PAYLOAD_VERSION, action: raw.action, tenorId: raw.tenorId ?? 0, rateBps: raw.rateBps ?? 0, nonce: BigInt(raw.nonce),
  refId: BigInt(raw.refId ?? 0), expiresAtEpoch: BigInt(raw.expiresAtEpoch ?? 0), amount: BigInt(raw.amount ?? 0), collateral: BigInt(raw.collateral ?? 0),
}
const pk = await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey' })
const blob = encryptIntent(hexToBytes(pk), hexToBytes(encodePayload(p)), { chainId: 10143n, core: dep.tervaneCore.toLowerCase(), sender: account.address.toLowerCase() as `0x${string}` })
const hash = await wallet.writeContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'submitIntent', args: [bytesToHex(blob)], gas: 150_000n })
const r = await pub.waitForTransactionReceipt({ hash })
console.log(`submitIntent tx=${hash} status=${r.status} blob=${blob.length}B`)
