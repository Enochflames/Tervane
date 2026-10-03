// Public chain state. The enclave key is read here, from TervaneCore, never from the server (CLAUDE.md §3.5).
import { coreAbi, erc20Abi, feedAbi } from '@tervane/core'
import type { Address, Hex } from 'viem'
import { useBalance, useReadContracts } from 'wagmi'
import { CHAIN_ID, DEP } from '../lib/config'

export interface ChainState {
  stateRoot: Hex; lastEpoch: bigint; cursor: bigint; inboxCount: bigint; lastSettleAt: bigint; escaped: boolean
  grace: bigint; escapeDelay: bigint; maxPriceAge: bigint
  enclavePubKey: Hex; price: bigint; priceRound: bigint; priceUpdatedAt: bigint
}

export function useChain() {
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'settlementState', chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'params', chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey', chainId: CHAIN_ID },
      { address: DEP.priceFeed, abi: feedAbi, functionName: 'latestRoundData', chainId: CHAIN_ID },
    ],
    query: { refetchInterval: 4000 },
  })
  let data: ChainState | undefined
  if (q.data) {
    const [st, p, pk, round] = q.data
    data = {
      ...st, grace: p.grace, escapeDelay: p.escapeDelay, maxPriceAge: p.maxPriceAge, enclavePubKey: pk,
      price: round[1], priceRound: round[0], priceUpdatedAt: round[3],
    }
  }
  return { data, isLoading: q.isLoading, error: q.error, refetch: q.refetch }
}

export function useWalletBalances(account: Address | undefined) {
  const enabled = !!account
  const q = useReadContracts({
    allowFailure: false,
    contracts: account ? [
      { address: DEP.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [account], chainId: CHAIN_ID },
      { address: DEP.ethToken, abi: erc20Abi, functionName: 'balanceOf', args: [account], chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'pendingWithdraw', args: [account, 0], chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'pendingWithdraw', args: [account, 1], chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'claimUsd', args: [account], chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'claimEth', args: [account], chainId: CHAIN_ID },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'exited', args: [account], chainId: CHAIN_ID },
    ] : [],
    query: { enabled, refetchInterval: 5000 },
  })
  const mon = useBalance({ address: account, chainId: CHAIN_ID, query: { enabled, refetchInterval: 8000 } })
  const d = q.data as readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean] | undefined
  return {
    data: d ? { usd: d[0], eth: d[1], pendingUsd: d[2], pendingEth: d[3], claimUsd: d[4], claimEth: d[5], exited: d[6], mon: mon.data?.value ?? 0n } : undefined,
    refetch: () => { q.refetch(); mon.refetch() },
  }
}
