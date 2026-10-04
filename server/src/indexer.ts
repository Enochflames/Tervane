// Log follower (SERVER.md §3): finalized blocks only, bounded ranges (Monad public RPC: ≤ 100 blocks),
// contiguous inbox (a gap stops progress instead of skipping), local accumulator cross-checked onchain.
import { ZERO32, accStep, msgHash, type Address, type Hex } from '@tervane/core'
import { hexToBytes, keccak256 } from 'viem'
import type { ChainSource, IndexedLog } from './chain'
import type { ClearRow, Db } from './db'
import type { StateStore } from './state'

export interface IndexerStatus { lastBlock: bigint; finalized: bigint; lastIdx: number; accOk: boolean; error?: string }

export class Indexer {
  private range: bigint
  private sinceAccCheck = 0
  status: IndexerStatus

  constructor(
    private readonly db: Db,
    private readonly store: StateStore,
    private readonly src: ChainSource,
    deployBlock: number,
    private readonly maxRange: number,
    private readonly log: (m: string) => void = console.log,
  ) {
    this.range = BigInt(maxRange)
    const saved = db.getKv('lastBlock')
    this.status = { lastBlock: saved ? BigInt(saved) : BigInt(deployBlock) - 1n, finalized: 0n, lastIdx: db.lastInbox()?.idx ?? 0, accOk: true }
  }

  /** One poll. Returns true if it advanced. */
  async step(): Promise<boolean> {
    const finalized = await this.src.finalizedBlock()
    this.status.finalized = finalized
    const from = this.status.lastBlock + 1n
    if (from > finalized) return false
    const to = from + this.range - 1n < finalized ? from + this.range - 1n : finalized
    let logs: IndexedLog[]
    try {
      logs = await this.src.logs(from, to)
      if (this.range < BigInt(this.maxRange)) this.range += 1n
    } catch (e) {
      this.range = this.range > 1n ? this.range / 2n : 1n // adapt to provider limits
      throw e
    }
    logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))

    const settled: { root: Hex }[] = []
    this.db.tx(() => {
      const clears = new Map<string, ClearRow[]>()
      for (const l of logs) if (l.eventName === 'Cleared') {
        const a = l.args as { epoch: bigint; tenorId: number; rateBps: number; volume: bigint }
        const k = l.transactionHash
        clears.set(k, [...(clears.get(k) ?? []), { epoch: Number(a.epoch), tenor_id: a.tenorId, rate_bps: a.rateBps, volume: a.volume.toString() }])
      }
      for (const l of logs) {
        if (l.eventName === 'InboxMessage') this.onInbox(l)
        else if (l.eventName === 'EpochSettled') {
          const a = l.args as { epoch: bigint; newRoot: Hex; inboxTo: bigint; asOf: bigint; priceUsed: bigint }
          this.db.insertEpoch({ epoch: Number(a.epoch), root: a.newRoot.toLowerCase(), inbox_to: Number(a.inboxTo), as_of: Number(a.asOf),
            price: a.priceUsed.toString(), tx_hash: l.transactionHash, block: Number(l.blockNumber) }, clears.get(l.transactionHash) ?? [])
          settled.push({ root: a.newRoot.toLowerCase() as Hex })
        } else if (l.eventName === 'EscapeActivated') this.db.setKv('escaped', '1')
      }
      this.db.setKv('lastBlock', to.toString())
    })
    this.status.lastBlock = to
    for (const s of settled) this.store.commit(s.root)
    if (++this.sinceAccCheck >= 20 && this.status.lastIdx > 0) { this.sinceAccCheck = 0; await this.checkAcc() }
    return true
  }

  private onInbox(l: IndexedLog) {
    const a = l.args as { index: bigint; kind: number; sender: Address; asset: number; amount: bigint; blob: Hex }
    const idx = Number(a.index)
    const last = this.db.lastInbox()
    const lastIdx = last?.idx ?? 0
    if (idx <= lastIdx) return // re-fetched range
    if (idx !== lastIdx + 1) throw new Error(`E_INBOX_GAP expected ${lastIdx + 1} got ${idx}`)
    const blobHash = a.kind === 2 ? keccak256(a.blob) : ZERO32
    const m = { index: a.index, kind: a.kind, sender: a.sender.toLowerCase() as Address, asset: a.asset, amount: a.amount, blobHash }
    const acc = accStep((last?.acc ?? ZERO32) as Hex, msgHash(m))
    this.db.insertInbox({ idx, kind: a.kind, sender: m.sender, asset: a.asset, amount: a.amount.toString(), blob_hash: blobHash,
      blob: a.kind === 2 ? hexToBytes(a.blob) : null, tx_hash: l.transactionHash, log_index: l.logIndex, block: Number(l.blockNumber), acc })
    this.status.lastIdx = idx
  }

  /** Local accumulator vs onchain inboxAcc (append-only, so reading it at the latest block is fine). */
  async checkAcc(): Promise<boolean> {
    const last = this.db.lastInbox()
    if (!last) return true
    const onchain = await this.src.inboxAcc(BigInt(last.idx))
    this.status.accOk = onchain.toLowerCase() === last.acc
    if (!this.status.accOk) this.log(`E_ACC_MISMATCH idx=${last.idx} — indexing bug`)
    return this.status.accOk
  }

  async run(pollMs: number, signal?: AbortSignal) {
    while (!signal?.aborted) {
      try {
        const advanced = await this.step()
        this.status.error = undefined
        if (!advanced) await Bun.sleep(pollMs)
      } catch (e) {
        this.status.error = (e as Error).message.split('\n')[0]
        this.log(`indexer: ${this.status.error}`)
        await Bun.sleep(pollMs)
      }
    }
  }
}
