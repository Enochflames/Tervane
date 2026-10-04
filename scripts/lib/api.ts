// Server client for scripts: EIP-712-signed account views and proofs (SERVER.md §5).
import type { Account } from 'viem'
import { dep } from './chain'

export const SERVER = process.env.SERVER_URL || 'http://localhost:8787'
const domain = () => ({ name: 'Tervane', version: '1', chainId: dep.chainId, verifyingContract: dep.tervaneCore })
const types = { ViewAccount: [{ name: 'account', type: 'address' }, { name: 'issuedAt', type: 'uint64' }] } as const

async function signed(user: Account, path: string) {
  const issuedAt = BigInt(Math.floor(Date.now() / 1000))
  const signature = await user.signTypedData!({ domain: domain(), types, primaryType: 'ViewAccount', message: { account: user.address, issuedAt } })
  const r = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: user.address, issuedAt: issuedAt.toString(), signature }) })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

export const accountView = (u: Account) => signed(u, '/v1/account') as Promise<{ root: string; epoch: string; account: Record<string, string> | null; openOrders: Record<string, unknown>[]; loans: Record<string, unknown>[] }>
export const proof = (u: Account) => signed(u, '/v1/proof')
export const health = async () => (await fetch(`${SERVER}/v1/health`)).json() as Promise<{ lastCommittedEpoch: number; root: string; pending: number; indexer: { lastInboxIdx: number; lagBlocks: string } | null }>
export const market = async () => (await fetch(`${SERVER}/v1/market`)).json()

/** Waits until the server has indexed inbox index `idx`. */
export async function waitIndexed(idx: number, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const h = await health()
    if ((h.indexer?.lastInboxIdx ?? 0) >= idx) return h
    await Bun.sleep(1000)
  }
  throw new Error(`server did not index inbox #${idx} in time`)
}
