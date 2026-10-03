// Account views and Merkle proofs against the latest committed root (SERVER.md §5) via @tervane/core.
import {
  BPS, accountLeaf, accountToJson, buildLevels, lendersHash, loanLeaf, orderToJson, proofFromLevels, stateLeaves, valueUsd,
  type Address, type Hex, type LedgerState,
} from '@tervane/core'
import { HttpError } from './errors'

const s = (x: bigint) => x.toString(10)

export function accountView(state: LedgerState, root: Hex, account: Address, price: bigint | undefined) {
  const a = state.accounts.get(account)
  const orders = [...state.orders.values()].filter((o) => o.owner === account).sort((x, y) => (x.id < y.id ? -1 : 1))
  const loans = [...state.loans.values()].filter((l) => l.borrower === account || l.lenders.some((x) => x.lender === account))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
  return {
    root, epoch: s(state.meta.epoch), account: a ? accountToJson(a) : null,
    // Orders carry no rate: the server never has one (I6).
    openOrders: orders.map(orderToJson),
    loans: loans.map((l) => ({
      id: s(l.id), role: l.borrower === account ? 'borrower' : 'lender', tenorId: l.tenorId, principal: s(l.principal),
      clearingRateBps: l.rateBps, owed: s(l.owed), collateral: s(l.collateral), tierAtOpen: l.tierAtOpen,
      openedAt: s(l.openedAt), maturity: s(l.maturity),
      share: l.borrower === account ? null : s(l.lenders.find((x) => x.lender === account)!.amount),
      healthBps: price && l.owed > 0n ? s((valueUsd(l.collateral, price) * BPS) / l.owed) : null,
    })),
  }
}

export function proofBundle(state: LedgerState, root: Hex, account: Address) {
  const a = state.accounts.get(account)
  if (!a) throw new HttpError(404, 'E_NO_ACCOUNT', 'account not in the committed ledger')
  const levels = buildLevels(stateLeaves(state))
  const loans = [...state.loans.values()].filter((l) => l.borrower === account || l.lenders.some((x) => x.lender === account))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
  return {
    root, epoch: s(state.meta.epoch),
    account: { leaf: accountLeaf(a), value: accountToJson(a), proof: proofFromLevels(levels, accountLeaf(a)) },
    loans: loans.map((l) => ({
      leaf: loanLeaf(l),
      value: { id: s(l.id), borrower: l.borrower, tenorId: l.tenorId, principal: s(l.principal), rateBps: l.rateBps, owed: s(l.owed),
        collateral: s(l.collateral), tierAtOpen: l.tierAtOpen, openedAt: s(l.openedAt), maturity: s(l.maturity), lendersHash: lendersHash(l.lenders) },
      lenders: l.lenders.map((x) => ({ lender: x.lender, amount: s(x.amount) })),
      proof: proofFromLevels(levels, loanLeaf(l)),
    })),
  }
}
