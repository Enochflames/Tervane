// Shared chain helpers for scripts (deployment, clients, user actions). Keys come from env only and are never printed.
import { coreAbi, encodePayload, encryptIntent, erc20Abi, feedAbi, type Hex, type IntentPayload } from '@tervane/core'
import { bytesToHex, createPublicClient, createWalletClient, defineChain, hexToBytes, http, type Account } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { join } from 'node:path'

export const ROOT = join(import.meta.dir, '..', '..')
export const dep = await Bun.file(join(ROOT, 'deployments/monad-testnet.json')).json() as {
  chainId: number; tervaneCore: Hex; usdToken: Hex; ethToken: Hex; priceFeed: Hex; treasury: Hex; deployBlock: number; genesisRoot: Hex
}
export const rpc = process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz'
export const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
export const pub = createPublicClient({ chain, transport: http(rpc) })

export function accountFromEnv(name = 'CRE_ETH_PRIVATE_KEY'): Account {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} not set`)
  return privateKeyToAccount(`0x${raw.replace(/^0x/, '')}`)
}

export function walletFor(account: Account) {
  return createWalletClient({ chain, account, transport: http(rpc) })
}

/** Monad charges the gas limit: every write passes an explicit limit (CONTRACTS.md §5). */
async function send(account: Account, address: Hex, abi: never, functionName: string, args: unknown[], gas: bigint) {
  const hash = await walletFor(account).writeContract({ address, abi, functionName, args, gas } as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`)
  return hash
}

export const faucet = (user: Account, token: Hex) => send(user, token, erc20Abi as never, 'faucet', [], 150_000n)
export const mint = (owner: Account, token: Hex, to: Hex, amount: bigint) => send(owner, token, erc20Abi as never, 'mint', [to, amount], 120_000n)
export async function deposit(user: Account, asset: 0 | 1, amount: bigint) {
  await send(user, asset === 0 ? dep.usdToken : dep.ethToken, erc20Abi as never, 'approve', [dep.tervaneCore, amount], 80_000n)
  return send(user, dep.tervaneCore, coreAbi as never, 'deposit', [asset, amount], 250_000n)
}
export const requestWithdraw = (user: Account, asset: 0 | 1, amount: bigint) =>
  send(user, dep.tervaneCore, coreAbi as never, 'requestWithdraw', [asset, amount], 200_000n)
export const setPrice = (owner: Account, answer: bigint) => send(owner, dep.priceFeed, feedAbi as never, 'updateAnswer', [answer], 150_000n)

/** Encrypts to the enclave key read from the chain (CLAUDE.md §3.5) and submits. Never prints payload fields. */
export async function submitIntent(user: Account, p: IntentPayload) {
  const pk = await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey' })
  const blob = encryptIntent(hexToBytes(pk), hexToBytes(encodePayload(p)), {
    chainId: BigInt(dep.chainId), core: dep.tervaneCore.toLowerCase() as Hex, sender: account(user),
  })
  return send(user, dep.tervaneCore, coreAbi as never, 'submitIntent', [bytesToHex(blob)], 150_000n)
}

export const account = (a: Account) => a.address.toLowerCase() as Hex
export const settlement = () => pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'settlementState' })
