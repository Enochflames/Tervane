// SQLite schema and typed queries (SERVER.md §2). No column holds a rate except clears.rate_bps.
// Hackathon scale: a full ledger snapshot per root. A production server would keep a persistent Merkle
// structure and store diffs instead of snapshots.
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type StateStatus = 'pending' | 'committed' | 'orphaned'

export interface InboxRow {
  idx: number; kind: number; sender: string; asset: number; amount: string; blob_hash: string
  blob: Uint8Array | null; tx_hash: string; log_index: number; block: number; acc: string
}
export interface StateRow { root: string; epoch: number; status: StateStatus; parent: string | null; snapshot: string; created_at: number }
export interface EpochRow { epoch: number; root: string; inbox_to: number; as_of: number; price: string; tx_hash: string; block: number }
export interface ClearRow { epoch: number; tenor_id: number; rate_bps: number; volume: string }
/** A loan that left the ledger: repaid or liquidated. `loan` is the loan as it was in the last state holding it. */
export interface ClosedLoanRow { loan_id: number; epoch: number; outcome: 'repaid' | 'liquidated'; borrower: string; lenders: string; loan: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbox (
  idx INTEGER PRIMARY KEY, kind INTEGER NOT NULL, sender TEXT NOT NULL, asset INTEGER NOT NULL,
  amount TEXT NOT NULL, blob_hash TEXT NOT NULL, blob BLOB, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
  block INTEGER NOT NULL, acc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS states (
  root TEXT PRIMARY KEY, epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','committed','orphaned')),
  parent TEXT, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS states_status_epoch ON states(status, epoch);
CREATE TABLE IF NOT EXISTS epochs (
  epoch INTEGER PRIMARY KEY, root TEXT NOT NULL, inbox_to INTEGER NOT NULL, as_of INTEGER NOT NULL,
  price TEXT NOT NULL, tx_hash TEXT NOT NULL, block INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clears (epoch INTEGER, tenor_id INTEGER, rate_bps INTEGER, volume TEXT, PRIMARY KEY (epoch, tenor_id));
CREATE TABLE IF NOT EXISTS cursor (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS closed_loans (
  loan_id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('repaid','liquidated')),
  borrower TEXT NOT NULL, lenders TEXT NOT NULL, loan TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS closed_loans_borrower ON closed_loans(borrower);
`

export class Db {
  readonly sql: Database

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.sql = new Database(path, { create: true, strict: true })
    this.sql.exec('PRAGMA journal_mode = WAL;')
    this.sql.exec(SCHEMA)
  }

  /** Checkpoints the WAL into the main file and closes (called on SIGTERM/SIGINT). */
  close() {
    this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    this.sql.close()
  }

  tx<T>(fn: () => T): T {
    return this.sql.transaction(fn)()
  }

  // ── cursor (indexer progress, flags) ──
  getKv(k: string): string | undefined {
    return this.sql.query<{ v: string }, [string]>('SELECT v FROM cursor WHERE k = ?').get(k)?.v
  }
  setKv(k: string, v: string) {
    this.sql.query('INSERT INTO cursor (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
  }

  // ── inbox ──
  lastInbox(): InboxRow | undefined {
    return this.sql.query<InboxRow, []>('SELECT * FROM inbox ORDER BY idx DESC LIMIT 1').get() ?? undefined
  }
  insertInbox(r: InboxRow) {
    this.sql.query(`INSERT INTO inbox (idx, kind, sender, asset, amount, blob_hash, blob, tx_hash, log_index, block, acc)
      VALUES ($idx, $kind, $sender, $asset, $amount, $blob_hash, $blob, $tx_hash, $log_index, $block, $acc)`).run(r as never)
  }
  inboxRange(from: number, to: number): InboxRow[] {
    return this.sql.query<InboxRow, [number, number]>('SELECT * FROM inbox WHERE idx >= ? AND idx <= ? ORDER BY idx').all(from, to)
  }
  inboxAt(idx: number): InboxRow | undefined {
    return this.sql.query<InboxRow, [number]>('SELECT * FROM inbox WHERE idx = ?').get(idx) ?? undefined
  }

  // ── states ──
  getState(root: string): StateRow | undefined {
    return this.sql.query<StateRow, [string]>('SELECT * FROM states WHERE root = ?').get(root.toLowerCase()) ?? undefined
  }
  headCommitted(): StateRow | undefined {
    return this.sql.query<StateRow, []>("SELECT * FROM states WHERE status = 'committed' ORDER BY epoch DESC LIMIT 1").get() ?? undefined
  }
  upsertState(r: StateRow) {
    this.sql.query(`INSERT INTO states (root, epoch, status, parent, snapshot, created_at)
      VALUES ($root, $epoch, $status, $parent, $snapshot, $created_at) ON CONFLICT(root) DO NOTHING`).run(r as never)
  }
  setStatus(root: string, status: StateStatus) {
    this.sql.query('UPDATE states SET status = ? WHERE root = ?').run(status, root.toLowerCase())
  }
  orphanSiblings(parent: string, keep: string): number {
    return this.sql.query("UPDATE states SET status = 'orphaned' WHERE parent = ? AND root != ? AND status = 'pending'")
      .run(parent.toLowerCase(), keep.toLowerCase()).changes
  }
  pendingCount(): number {
    return this.sql.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM states WHERE status = 'pending'").get()!.n
  }
  /** GC (SERVER.md §4): orphaned and pending states older than `keepEpochs` epochs. */
  gc(currentEpoch: number, keepEpochs = 20): number {
    return this.sql.query("DELETE FROM states WHERE status IN ('pending','orphaned') AND epoch < ?").run(currentEpoch - keepEpochs).changes
  }

  // ── epochs / clears ──
  insertEpoch(e: EpochRow, clears: ClearRow[]) {
    this.sql.query(`INSERT OR IGNORE INTO epochs (epoch, root, inbox_to, as_of, price, tx_hash, block)
      VALUES ($epoch, $root, $inbox_to, $as_of, $price, $tx_hash, $block)`).run(e as never)
    for (const c of clears) {
      this.sql.query('INSERT OR IGNORE INTO clears (epoch, tenor_id, rate_bps, volume) VALUES ($epoch, $tenor_id, $rate_bps, $volume)').run(c as never)
    }
  }
  lastEpoch(): EpochRow | undefined {
    return this.sql.query<EpochRow, []>('SELECT * FROM epochs ORDER BY epoch DESC LIMIT 1').get() ?? undefined
  }
  // ── closed loans (history for Positions; same privacy as open loans: served only in the signed account view) ──
  insertClosedLoan(r: ClosedLoanRow) {
    this.sql.query(`INSERT OR IGNORE INTO closed_loans (loan_id, epoch, outcome, borrower, lenders, loan)
      VALUES ($loan_id, $epoch, $outcome, $borrower, $lenders, $loan)`).run(r as never)
  }
  /** Closed loans where `account` (lowercase) was the borrower or a lender, newest first, with the epoch's asOf. */
  closedLoansFor(account: string, limit = 50): (ClosedLoanRow & { as_of: number | null })[] {
    return this.sql.query<ClosedLoanRow & { as_of: number | null }, [string, string, number]>(`SELECT c.*, e.as_of FROM closed_loans c
      LEFT JOIN epochs e ON e.epoch = c.epoch WHERE c.borrower = ? OR instr(c.lenders, ?) > 0 ORDER BY c.epoch DESC, c.loan_id DESC LIMIT ?`)
      .all(account, account, limit)
  }
  committedStates(): StateRow[] {
    return this.sql.query<StateRow, []>("SELECT * FROM states WHERE status = 'committed' ORDER BY epoch").all()
  }

  latestClears(): ClearRow[] {
    return this.sql.query<ClearRow, []>(`SELECT c.* FROM clears c JOIN (SELECT tenor_id, MAX(epoch) AS e FROM clears GROUP BY tenor_id) m
      ON c.tenor_id = m.tenor_id AND c.epoch = m.e ORDER BY c.tenor_id`).all()
  }
}
