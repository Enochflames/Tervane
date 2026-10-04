// Local intent memory (CLIENT.md §3): keyed by chainId:core:account, holds only this user's own submitted intents
// (including their rates) and the last proof bundle. Nothing here is ever sent anywhere.
import { CHAIN_ID, DEP } from './config'

export interface LocalIntent {
  txHash: string
  inboxIndex: string | null
  action: number
  tenorId: number
  amount: string
  rateBps: number
  collateral: string
  refId: string
  nonce: string
  at: number
}
export interface CachedProof { root: string; epoch: string; fetchedAt: number; bundle: unknown }
interface Store { nonce: string; intents: LocalIntent[]; proof?: CachedProof }

const key = (account: string) => `tervane:${CHAIN_ID}:${DEP.tervaneCore.toLowerCase()}:${account.toLowerCase()}`
const empty = (): Store => ({ nonce: '0', intents: [] })

export function load(account: string): Store {
  try {
    const raw = localStorage.getItem(key(account))
    return raw ? { ...empty(), ...(JSON.parse(raw) as Store) } : empty()
  } catch { return empty() }
}

function save(account: string, s: Store) {
  try { localStorage.setItem(key(account), JSON.stringify(s)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent('tervane-storage', { detail: account.toLowerCase() }))
}

/** Reserves the next nonce = max(server, local) + 1 and persists it before any transaction is sent. */
export function reserveNonce(account: string, serverNonce: bigint): bigint {
  const s = load(account)
  const next = (serverNonce > BigInt(s.nonce) ? serverNonce : BigInt(s.nonce)) + 1n
  save(account, { ...s, nonce: next.toString() })
  return next
}

export function addIntent(account: string, i: LocalIntent) {
  const s = load(account)
  save(account, { ...s, intents: [i, ...s.intents.filter((x) => x.txHash !== i.txHash)] })
}

export function cacheProof(account: string, p: CachedProof) {
  save(account, { ...load(account), proof: p })
}

export function exportData(account: string): string {
  return JSON.stringify({ chainId: CHAIN_ID, core: DEP.tervaneCore, account, ...load(account) }, null, 2)
}

export function clearData(account: string) {
  try { localStorage.removeItem(key(account)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('tervane-storage', { detail: account.toLowerCase() }))
}
