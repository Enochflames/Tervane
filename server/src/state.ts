// Ledger store keyed by root (SERVER.md §4): pending until EpochSettled (or the chain's stateRoot) confirms it,
// then committed; siblings for the same parent become orphaned. Every stored root is recomputed by
// @tervane/core, so a state that doesn't hash to its root never enters the store.
import { applyDiff, encodeState, genesisState, merkleRoot, stateFromJson, type EpochDiff, type Hex, type LedgerState } from '@tervane/core'
import type { Db } from './db'
import { HttpError } from './errors'

export class StateStore {
  private cache = new Map<string, LedgerState>()

  constructor(private readonly db: Db, genesisRoot: Hex, private readonly log: (m: string) => void = console.log) {
    const g = genesisState()
    const root = merkleRoot(g)
    if (root !== genesisRoot.toLowerCase()) throw new Error(`deployment genesisRoot ${genesisRoot} != core genesis ${root}`)
    if (!db.headCommitted()) {
      db.upsertState({ root, epoch: 0, status: 'committed', parent: null, snapshot: encodeState(g), created_at: Date.now() })
    }
  }

  load(root: string): LedgerState | undefined {
    const key = root.toLowerCase()
    const hit = this.cache.get(key)
    if (hit) return hit
    const row = this.db.getState(key)
    if (!row) return undefined
    const s = stateFromJson(JSON.parse(row.snapshot))
    this.cache.set(key, s)
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
    return s
  }

  head(): { root: Hex; epoch: number; state: LedgerState } {
    const row = this.db.headCommitted()!
    return { root: row.root as Hex, epoch: row.epoch, state: this.load(row.root)! }
  }

  /** POST /internal/epoch-output. Idempotent for a repeated identical diff. */
  putPending(diff: EpochDiff): Hex {
    const prevRow = this.db.getState(diff.prevRoot)
    if (!prevRow || prevRow.status !== 'committed') throw new HttpError(409, 'E_UNKNOWN_PREV', 'prevRoot is not a committed state')
    let next: LedgerState
    try {
      next = applyDiff(this.load(diff.prevRoot)!, diff)
    } catch {
      this.log(`E_DIFF_ROOT epoch=${diff.epoch} newRoot=${diff.newRoot} — enclave and server code diverged`)
      throw new HttpError(422, 'E_DIFF_ROOT', 'diff does not reproduce newRoot')
    }
    if (this.db.getState(diff.newRoot)) return diff.newRoot // idempotent repeat, verified above
    this.db.upsertState({ root: diff.newRoot, epoch: Number(diff.epoch), status: 'pending', parent: diff.prevRoot, snapshot: encodeState(next), created_at: Date.now() })
    this.cache.set(diff.newRoot.toLowerCase(), next)
    return diff.newRoot
  }

  /** Confirms `root` as committed (on EpochSettled or when the chain's stateRoot equals it). */
  commit(root: Hex): 'committed' | 'already' | 'missing' {
    const row = this.db.getState(root)
    if (!row) {
      this.log(`E_MISSING_PENDING root=${root} — settled onchain without a stored pending state`)
      return 'missing'
    }
    if (row.status === 'committed') return 'already'
    this.db.tx(() => {
      this.db.setStatus(root, 'committed')
      if (row.parent) this.db.orphanSiblings(row.parent, root)
      this.db.gc(row.epoch)
    })
    this.log(`committed epoch=${row.epoch} root=${root}`)
    return 'committed'
  }
}
