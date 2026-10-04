import { createContext, useContext, type ReactNode } from 'react'
import type { Address } from 'viem'
import { useConnection } from 'wagmi'
import { useChain, useWalletBalances, type ChainState } from './hooks/useChain'
import { useLocal } from './hooks/useLocal'
import { useNow } from './hooks/useNow'
import { useLedger, useLedgerSession, useMarket, useProof } from './hooks/useServer'
import { CHAIN_ID } from './lib/config'

function useAppState() {
  const now = useNow()
  const conn = useConnection()
  const address = conn.address as Address | undefined
  const chain = useChain()
  const wallet = useWalletBalances(address)
  const market = useMarket()
  const { session, expiresIn } = useLedgerSession(address, now)
  const ledger = useLedger(session)
  const proof = useProof(session)
  const local = useLocal(address)
  const c: ChainState | undefined = chain.data
  const escapeOpen = !!c && (c.escaped || BigInt(now) > c.lastSettleAt + c.escapeDelay)
  return {
    now, address, isConnected: conn.isConnected, wrongChain: conn.isConnected && conn.chainId !== CHAIN_ID,
    chain, wallet, market, session, expiresIn, ledger, proof, local, escapeOpen,
  }
}

export type AppState = ReturnType<typeof useAppState>
const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useAppState()}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
