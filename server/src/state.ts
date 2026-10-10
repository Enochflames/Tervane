// Ledger store keyed by root (SERVER.md §4): pending until EpochSettled (or the chain's stateRoot) confirms it,
// then committed; siblings for the same parent become orphaned. Every stored root is recomputed by
// @tervane/core, so a state that doesn't hash to its root never enters the store.
import { applyDiff, encodeState, genesisState, merkleRoot, stateFromJson, type EpochDiff, type Hex, type LedgerState, type Loan } from '@tervane/core'
import type { Db } from './db'
import { HttpError } from './errors'

const s = (x: bigint) => x.toString(10)
const loanJson = (l: Loan) => JSON.stringify({
  id: s(l.id), borrower: l.borrower, tenorId: l.tenorId, principal: s(l.principal), rateBps: l.rateBps, owed: s(l.owed),
  collateral: s(l.collateral), tierAtOpen: l.tierAtOpen, openedAt: s(l.openedAt), maturity: s(l.maturity),
  lenders: l.lenders.map((x) => ({ lender: x.lender, amount: s(x.amount) })),
})

/**
 * Loans present in `prev` and gone in `next`. A repay raises the borrower's repaidVolume by the principal
 * (PROTOCOL-SPEC §10.3); a liquidation never raises it (it resets to the tier floor), so that tells them apart.
 */
export function closedLoans(prev: LedgerState, next: LedgerState) {
  const out: { loan: Loan; outcome: 'repaid' | 'liquidated' }[] = []
  for (const [id, l] of prev.loans) {
    if (next.loans.has(id)) continue
    const before = prev.accounts.get(l.borrower)?.repaidVolume ?? 0n
    const after = next.accounts.get(l.borrower)?.repaidVolume ?? 0n
    out.push({ loan: l, outcome: after >= before + l.principal ? 'repaid' : 'liquidated' })
  }
  return out
}

export class StateStore {
  private cache = new Map<string, LedgerState>()

  constructor(private readonly db: Db, genesisRoot: Hex, private readonly log: (m: string) => void = console.log) {
    const g = genesisState()
    const root = merkleRoot(g)
    if (root !== genesisRoot.toLowerCase()) throw new Error(`deployment genesisRoot ${genesisRoot} != core genesis ${root}`)
    if (!db.headCommitted()) {
      db.upsertState({ root, epoch: 0, status: 'committed', parent: null, snapshot: encodeState(g), created_at: Date.now() })
    }
    this.backfillClosedLoans()
  }

  private recordClosed(prev: LedgerState, next: LedgerState, epoch: number) {
    for (const c of closedLoans(prev, next)) {
      this.db.insertClosedLoan({ loan_id: Number(c.loan.id), epoch, outcome: c.outcome, borrower: c.loan.borrower.toLowerCase(),
        lenders: c.loan.lenders.map((x) => x.lender.toLowerCase()).join(','), loan: loanJson(c.loan) })
    }
  }

  /** One-time: derive closed loans from the committed history of a database that predates the table. */
  private backfillClosedLoans() {
    if (this.db.getKv('closedLoansBackfilled')) return
    const rows = this.db.committedStates()
    this.db.tx(() => {
      for (let i = 1; i < rows.length; i++) {
        this.recordClosed(stateFromJson(JSON.parse(rows[i - 1]!.snapshot)), stateFromJson(JSON.parse(rows[i]!.snapshot)), rows[i]!.epoch)
      }
      this.db.setKv('closedLoansBackfilled', '1')
    })
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
    const prev = row.parent ? this.load(row.parent) : undefined
    const next = this.load(root)
    this.db.tx(() => {
      if (prev && next) this.recordClosed(prev, next, row.epoch)
      this.db.setStatus(root, 'committed')
      if (row.parent) this.db.orphanSiblings(row.parent, root)
      this.db.gc(row.epoch)
    })
    this.log(`committed epoch=${row.epoch} root=${root}`)
    return 'committed'
  }
}
