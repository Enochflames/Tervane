// Protocol data types. PROTOCOL-SPEC §4, §5, §7.1, §7.4, §11.
// I6: no persisted type carries a bid/max rate. Loan.rateBps is the public clearing rate.

export type Hex = `0x${string}`
/** Lowercase 20-byte hex address (canonical form inside core). */
export type Address = `0x${string}`

export interface Meta { epoch: bigint; cursor: bigint; nextLoanId: bigint }

export interface Account {
  addr: Address
  usdFree: bigint
  usdReserved: bigint
  ethFree: bigint
  ethReserved: bigint
  ethLocked: bigint
  tier: number
  repaidVolume: bigint
  nonce: bigint
}

export interface Order {
  id: bigint
  owner: Address
  side: number
  tenorId: number
  remaining: bigint
  collateral: bigint
  expiresAtEpoch: bigint
  blobHash: Hex
}

export interface LenderShare { lender: Address; amount: bigint }

export interface Loan {
  id: bigint
  borrower: Address
  tenorId: number
  principal: bigint
  rateBps: number
  owed: bigint
  collateral: bigint
  tierAtOpen: number
  openedAt: bigint
  maturity: bigint
  lenders: LenderShare[]
}

/** Ledger state. Maps are keyed by lowercase address / id; iteration order is never relied on. */
export interface LedgerState {
  meta: Meta
  accounts: Map<Address, Account>
  orders: Map<bigint, Order>
  loans: Map<bigint, Loan>
}

export interface InboxMessage {
  index: bigint
  kind: number
  sender: Address
  asset: number
  amount: bigint
  blobHash: Hex
  /** `0x` for non-INTENT messages. */
  blob: Hex
}

export interface IntentPayload {
  version: number
  action: number
  tenorId: number
  rateBps: number
  nonce: bigint
  refId: bigint
  expiresAtEpoch: bigint
  amount: bigint
  collateral: bigint
}

export interface Clear { tenorId: number; rateBps: number; volume: bigint }
export interface Payout { to: Address; asset: number; requested: bigint; paid: bigint }

export interface SettlementReport {
  epoch: bigint
  prevRoot: Hex
  newRoot: Hex
  inboxTo: bigint
  inboxAccTo: Hex
  asOf: bigint
  priceRoundId: bigint
  priceUsed: bigint
  clears: Clear[]
  payouts: Payout[]
}

export interface EpochDiff {
  epoch: bigint
  prevRoot: Hex
  newRoot: Hex
  meta: Meta
  upsertAccounts: Account[]
  upsertOrders: Order[]
  upsertLoans: Loan[]
  deleteOrders: bigint[]
  deleteLoans: bigint[]
}
