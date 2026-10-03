// Converts the server's proof JSON into the exact tuples TervaneCore expects (TervaneLeaves structs).
import type { Address, Hex } from 'viem'
import type { AccountJson, ProofBundle } from '../hooks/useServer'

export const accountArg = (a: AccountJson) => ({
  addr: a.addr as Address, usdFree: BigInt(a.usdFree), usdReserved: BigInt(a.usdReserved), ethFree: BigInt(a.ethFree),
  ethReserved: BigInt(a.ethReserved), ethLocked: BigInt(a.ethLocked), tier: a.tier, repaidVolume: BigInt(a.repaidVolume), nonce: BigInt(a.nonce),
})

export const loanArgs = (l: ProofBundle['loans'][number]) => [
  {
    id: BigInt(l.value.id), borrower: l.value.borrower as Address, tenorId: l.value.tenorId, principal: BigInt(l.value.principal),
    rateBps: l.value.rateBps, owed: BigInt(l.value.owed), collateral: BigInt(l.value.collateral), tierAtOpen: l.value.tierAtOpen,
    openedAt: BigInt(l.value.openedAt), maturity: BigInt(l.value.maturity), lendersHash: l.value.lendersHash as Hex,
  },
  l.lenders.map((s) => ({ lender: s.lender as Address, amount: BigInt(s.amount) })),
  l.proof as Hex[],
] as const
