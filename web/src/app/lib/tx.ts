// One path for every write: explicit gas limit → wallet → receipt. Phases drive TxButton and toasts.
import type { Abi, Address, TransactionReceipt } from 'viem'
import { getAccount, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { CHAIN_ID } from './config'
import { toast } from '../ui/toast'
import { wagmiConfig } from './wagmi'

export type TxPhase = 'idle' | 'wallet' | 'pending' | 'done' | 'error'
export interface TxRequest { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; gas: bigint }

/** TervaneCore reverts a user can hit from the app, in words. Others fall through to the error name. */
const REVERTS: Record<string, string> = {
  Escaped: 'Escape is active: deposits, intents and withdrawals are closed. Use the Escape page.',
  NotEscaped: 'Escape is not active yet.',
  EscapeTooEarly: 'Settlement has not been quiet for the full escape delay yet.',
  AlreadyExited: 'This account has already exited.',
  AlreadyResolved: 'This loan was already repaid or liquidated in escape.',
  NotLiquidatable: 'This loan is healthy at the current feed price and not past maturity.',
  InvalidProof: 'The proof does not match the last committed root.',
  NotAccountOwner: 'Only the account owner can exit it.',
  NotBorrower: 'Only the borrower can repay this loan.',
  LendersMismatch: 'The lender list does not match the loan.',
  PriceStale: 'The price feed is stale.',
  ZeroAmount: 'Enter an amount above zero.',
}

export function txError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string; cause?: { name?: string; data?: { errorName?: string } } }
  const text = `${err.name ?? ''} ${err.cause?.name ?? ''} ${err.shortMessage ?? ''} ${err.message ?? ''}`
  if (/UserRejected|User rejected|denied/i.test(text)) return 'Cancelled in your wallet.'
  const name = err.cause?.data?.errorName
  if (name) return REVERTS[name] ?? `The contract rejected this (${name}).`
  const m = (err.shortMessage ?? err.message ?? 'Transaction failed').split('\n')[0]!
  return m.length > 160 ? `${m.slice(0, 157)}…` : m
}

export async function sendTx(req: TxRequest, onPhase: (p: TxPhase) => void = () => {}): Promise<TransactionReceipt> {
  // Monad charges the full gas limit even on a revert: simulate first so a doomed call never reaches the wallet.
  const call = { ...req, args: req.args ?? [], chainId: CHAIN_ID, account: getAccount(wagmiConfig).address }
  await simulateContract(wagmiConfig, call as never)
  onPhase('wallet')
  const hash = await writeContract(wagmiConfig, call as never)
  onPhase('pending')
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID })
  if (receipt.status !== 'success') throw new Error('The transaction reverted onchain.')
  onPhase('done')
  return receipt
}

/** Runs a sequence of writes with toasts; returns the last receipt or null if anything failed. */
export async function runTxs(label: string, reqs: TxRequest[], onPhase: (p: TxPhase) => void): Promise<TransactionReceipt | null> {
  const id = toast.show({ title: label, body: 'Confirm in your wallet…', tone: 'pending' })
  try {
    let last: TransactionReceipt | null = null
    for (let i = 0; i < reqs.length; i++) {
      const step = reqs.length > 1 ? ` (${i + 1}/${reqs.length})` : ''
      last = await sendTx(reqs[i]!, (p) => {
        onPhase(p)
        if (p === 'wallet') toast.update(id, { body: `Confirm in your wallet${step}…` })
        if (p === 'pending') toast.update(id, { body: `Waiting for Monad${step}…` })
      })
    }
    toast.update(id, { tone: 'success', body: 'Confirmed onchain.', txHash: last?.transactionHash, ttl: 6000 })
    setTimeout(() => onPhase('idle'), 1600)
    return last
  } catch (e) {
    onPhase('error')
    setTimeout(() => onPhase('idle'), 2500)
    toast.update(id, { tone: 'error', body: txError(e), ttl: 8000 })
    return null
  }
}
