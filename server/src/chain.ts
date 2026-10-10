// Chain access for the indexer and views. Only logs over ranges and calls at the latest block:
// Monad nodes don't serve arbitrary historical state (CLAUDE.md §8).
import { coreAbi, type Hex } from '@tervane/core'
import { createPublicClient, fallback, http, parseEventLogs, type PublicClient } from 'viem'
import type { Deployment } from './env'

export interface IndexedLog {
  eventName: 'InboxMessage' | 'EpochSettled' | 'Cleared' | 'EscapeActivated' | string
  args: Record<string, unknown>
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

export interface SettlementView {
  stateRoot: Hex; lastEpoch: bigint; cursor: bigint; inboxCount: bigint; lastSettleAt: bigint; escaped: boolean
}

export interface ChainSource {
  finalizedBlock(): Promise<bigint>
  logs(from: bigint, to: bigint): Promise<IndexedLog[]>
  inboxAcc(idx: bigint): Promise<Hex>
  settlementState(): Promise<SettlementView>
  enclavePubKey(): Promise<Hex>
}

/** First URL is primary; the rest are tried in order only when it fails (Monad's public RPC has outages). */
export function viemSource(rpcs: string | string[], dep: Deployment): ChainSource {
  const urls = [rpcs].flat().filter(Boolean)
  const transport = urls.length > 1
    ? fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 8_000 })), { rank: false })
    : http(urls[0], { retryCount: 2 })
  const client: PublicClient = createPublicClient({ transport })
  const core = dep.tervaneCore
  return {
    async finalizedBlock() {
      return (await client.getBlock({ blockTag: 'finalized' })).number
    },
    async logs(from, to) {
      const raw = await client.getLogs({ address: core, fromBlock: from, toBlock: to })
      return parseEventLogs({ abi: coreAbi, logs: raw }).map((l) => ({
        eventName: l.eventName, args: l.args as Record<string, unknown>, blockNumber: l.blockNumber!, logIndex: l.logIndex!, transactionHash: l.transactionHash!,
      }))
    },
    inboxAcc: (idx) => client.readContract({ address: core, abi: coreAbi, functionName: 'inboxAcc', args: [idx] }),
    async settlementState() {
      const s = await client.readContract({ address: core, abi: coreAbi, functionName: 'settlementState' })
      return { stateRoot: s.stateRoot, lastEpoch: s.lastEpoch, cursor: s.cursor, inboxCount: s.inboxCount, lastSettleAt: s.lastSettleAt, escaped: s.escaped }
    },
    enclavePubKey: () => client.readContract({ address: core, abi: coreAbi, functionName: 'enclavePubKey' }),
  }
}
