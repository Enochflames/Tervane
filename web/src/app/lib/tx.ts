// One path for every write: explicit gas limit → wallet → receipt. Phases drive TxButton and toasts.
import type { Abi, Address, TransactionReceipt } from 'viem'
import { waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { CHAIN_ID } from './config'
import { toast } from '../ui/toast'
import { wagmiConfig } from './wagmi'

export type TxPhase = 'idle' | 'wallet' | 'pending' | 'done' | 'error'
export interface TxRequest { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; gas: bigint }

export function txError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string; cause?: { name?: string } }
  const text = `${err.name ?? ''} ${err.cause?.name ?? ''} ${err.shortMessage ?? ''} ${err.message ?? ''}`
  if (/UserRejected|User rejected|denied/i.test(text)) return 'Cancelled in your wallet.'
  const m = (err.shortMessage ?? err.message ?? 'Transaction failed').split('\n')[0]!
  return m.length > 160 ? `${m.slice(0, 157)}…` : m
}

export async function sendTx(req: TxRequest, onPhase: (p: TxPhase) => void = () => {}): Promise<TransactionReceipt> {
  onPhase('wallet')
  const hash = await writeContract(wagmiConfig, { ...req, args: req.args ?? [], chainId: CHAIN_ID } as never)
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
