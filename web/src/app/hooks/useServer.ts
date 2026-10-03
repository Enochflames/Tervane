// Server data: public market view and the EIP-712-signed ledger view (SERVER.md §5).
// The signature proves control of the account and is valid for ±300 s; we keep it in memory for its lifetime.
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { signTypedData } from 'wagmi/actions'
import { CHAIN_ID, DEP, SERVER_URL } from '../lib/config'
import { cacheProof } from '../lib/storage'
import { wagmiConfig } from '../lib/wagmi'

export interface MarketView {
  epoch: string; lastSettleAt: string; escaped: boolean; enclavePubKey: string
  clears: { tenorId: number; rateBps: number; volume: string; epoch: number }[]
}
export interface AccountJson { addr: string; usdFree: string; usdReserved: string; ethFree: string; ethReserved: string; ethLocked: string; tier: number; repaidVolume: string; nonce: string }
export interface OrderJson { id: string; owner: string; side: number; tenorId: number; remaining: string; collateral: string; expiresAtEpoch: string; blobHash: string }
export interface LoanView {
  id: string; role: 'borrower' | 'lender'; tenorId: number; principal: string; clearingRateBps: number; owed: string; collateral: string
  tierAtOpen: number; openedAt: string; maturity: string; share: string | null; healthBps: string | null
}
export interface LedgerView { root: string; epoch: string; account: AccountJson | null; openOrders: OrderJson[]; loans: LoanView[] }
export interface ProofBundle {
  root: string; epoch: string
  account: { leaf: string; value: AccountJson; proof: string[] }
  loans: { leaf: string; value: { id: string; borrower: string; tenorId: number; principal: string; rateBps: number; owed: string; collateral: string; tierAtOpen: number; openedAt: string; maturity: string; lendersHash: string }; lenders: { lender: string; amount: string }[]; proof: string[] }[]
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${SERVER_URL}${path}`, init)
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { code?: string; message?: string }
    throw Object.assign(new Error(body.message ?? `Server returned ${r.status}`), { code: body.code, status: r.status })
  }
  return r.json() as Promise<T>
}

export function useMarket() {
  return useQuery({ queryKey: ['market'], queryFn: () => get<MarketView>('/v1/market'), refetchInterval: 5000, retry: 1 })
}

// ── signed view session ─────────────────────────────────────
interface Session { account: string; issuedAt: number; signature: string }
const SESSION_KEY = 'tervane-view-session'
function restore(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
    return s && Math.floor(Date.now() / 1000) - s.issuedAt < 280 ? s : null
  } catch { return null }
}
let session: Session | null = typeof window !== 'undefined' ? restore() : null
const subs = new Set<() => void>()
const emit = () => subs.forEach((s) => s())
const VALID_FOR = 280 // seconds; the server accepts ±300

export async function unlockLedger(account: Address) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const signature = await signTypedData(wagmiConfig, {
    domain: { name: 'Tervane', version: '1', chainId: CHAIN_ID, verifyingContract: DEP.tervaneCore },
    types: { ViewAccount: [{ name: 'account', type: 'address' }, { name: 'issuedAt', type: 'uint64' }] },
    primaryType: 'ViewAccount',
    message: { account, issuedAt: BigInt(issuedAt) },
  })
  session = { account: account.toLowerCase(), issuedAt, signature }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
  emit()
}

export function useLedgerSession(account: Address | undefined, now: number) {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb) } }, () => session)
  const valid = !!s && !!account && s.account === account.toLowerCase() && now - s.issuedAt < VALID_FOR
  return { session: valid ? s : null, expiresIn: valid ? VALID_FOR - (now - s!.issuedAt) : 0 }
}

const body = (s: Session) => JSON.stringify({ account: s.account, issuedAt: String(s.issuedAt), signature: s.signature })

export function useLedger(s: Session | null) {
  return useQuery({
    queryKey: ['ledger', s?.account, s?.issuedAt],
    queryFn: () => get<LedgerView>('/v1/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(s!) }),
    enabled: !!s, refetchInterval: 4000, retry: 1,
  })
}

/** Fetches the proof bundle and caches it locally with its root, for the escape hatch (CLIENT.md §5). */
export function useProof(s: Session | null) {
  return useQuery({
    queryKey: ['proof', s?.account, s?.issuedAt],
    queryFn: async () => {
      const p = await get<ProofBundle>('/v1/proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(s!) })
      cacheProof(s!.account, { root: p.root, epoch: p.epoch, fetchedAt: Date.now(), bundle: p })
      return p
    },
    enabled: !!s, refetchInterval: 15_000, retry: 0,
  })
}
