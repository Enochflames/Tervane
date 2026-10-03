// The encryption path (CLIENT.md §2, PROTOCOL-SPEC §5–§6). Plaintext exists only here and in local storage.
import {
  ACTION_BORROW, ACTION_CANCEL, ACTION_LEND, ACTION_REPAY, MAX_RATE_BPS, PAYLOAD_VERSION, coreAbi, encodePayload,
  encryptIntent, openRatioOk, tierCap, validateEnclavePubKey, type IntentPayload,
} from '@tervane/core'
import { bytesToHex, hexToBytes, parseEventLogs, type Address } from 'viem'
import { readContract } from 'wagmi/actions'
import { CHAIN_ID, DEP, GAS } from './config'
import { addIntent, reserveNonce } from './storage'
import { runTxs, type TxPhase } from './tx'
import { wagmiConfig } from './wagmi'
import type { AccountJson, LoanView, OrderJson } from '../hooks/useServer'

export type IntentDraft =
  | { action: typeof ACTION_LEND; tenorId: number; amount: bigint; rateBps: number }
  | { action: typeof ACTION_BORROW; tenorId: number; amount: bigint; rateBps: number; collateral: bigint }
  | { action: typeof ACTION_CANCEL; refId: bigint }
  | { action: typeof ACTION_REPAY; refId: bigint }

export const ACTION_LABEL: Record<number, string> = { 1: 'Lend', 2: 'Borrow', 3: 'Cancel', 4: 'Repay' }

/** Pre-validation with the rules the enclave applies (§12 step 3), so doomed intents don't cost gas. */
export function precheck(d: IntentDraft, ctx: { account: AccountJson | null; orders: OrderJson[]; loans: LoanView[]; price: bigint | undefined }): string[] {
  const a = ctx.account
  const issues: string[] = []
  if (d.action === ACTION_LEND || d.action === ACTION_BORROW) {
    if (d.rateBps < 1 || d.rateBps > MAX_RATE_BPS) issues.push('Rate must be between 0.01% and 100%.')
    if (d.amount <= 0n) issues.push('Enter an amount.')
  }
  if (!a) { if (d.action !== ACTION_LEND && d.action !== ACTION_BORROW) issues.push('No ledger account yet: deposit first.'); return issues }
  if (d.action === ACTION_LEND && d.amount > BigInt(a.usdFree)) issues.push('Amount exceeds your free tUSD in the ledger.')
  if (d.action === ACTION_BORROW) {
    if (d.collateral <= 0n) issues.push('Add collateral.')
    if (d.collateral > BigInt(a.ethFree)) issues.push('Collateral exceeds your free tETH in the ledger.')
    const outstanding = ctx.loans.filter((l) => l.role === 'borrower').reduce((s, l) => s + BigInt(l.principal), 0n)
      + ctx.orders.filter((o) => o.side === 2).reduce((s, o) => s + BigInt(o.remaining), 0n)
    if (outstanding + d.amount > tierCap(a.tier, BigInt(a.repaidVolume))) issues.push('This would exceed your tier’s borrow cap.')
    if (ctx.price && !openRatioOk(d.collateral, d.amount, a.tier, ctx.price)) issues.push('Collateral is below your tier’s opening ratio at the current price.')
  }
  if (d.action === ACTION_CANCEL && !ctx.orders.some((o) => BigInt(o.id) === d.refId)) issues.push('That order is no longer open.')
  if (d.action === ACTION_REPAY) {
    const l = ctx.loans.find((x) => x.role === 'borrower' && BigInt(x.id) === d.refId)
    if (!l) issues.push('That loan is no longer active.')
    else if (BigInt(a.usdFree) < BigInt(l.owed)) issues.push('Your free tUSD is below the amount owed: deposit the difference first.')
  }
  return issues
}

export async function submitIntent(sender: Address, serverNonce: bigint, d: IntentDraft, onPhase: (p: TxPhase) => void) {
  // 1. Enclave key from the chain, validated.
  const pkHex = await readContract(wagmiConfig, { address: DEP.tervaneCore, abi: coreAbi, functionName: 'enclavePubKey', chainId: CHAIN_ID })
  const pk = validateEnclavePubKey(hexToBytes(pkHex))
  // 2. Nonce reserved before sending, so two quick submissions can't reuse it.
  const nonce = reserveNonce(sender, serverNonce)
  // 3. Payload via the shared core encoder.
  const p: IntentPayload = {
    version: PAYLOAD_VERSION, action: d.action, nonce, expiresAtEpoch: 0n,
    tenorId: 'tenorId' in d ? d.tenorId : 0, rateBps: 'rateBps' in d ? d.rateBps : 0,
    refId: 'refId' in d ? d.refId : 0n, amount: 'amount' in d ? d.amount : 0n, collateral: 'collateral' in d ? d.collateral : 0n,
  }
  // 4. Encrypt with AAD bound to the account that will send the transaction.
  const blob = encryptIntent(pk, hexToBytes(encodePayload(p)), { chainId: BigInt(CHAIN_ID), core: DEP.tervaneCore.toLowerCase() as Address, sender: sender.toLowerCase() as Address })
  // 5. Submit with an explicit gas limit.
  const receipt = await runTxs(`${ACTION_LABEL[d.action]} intent`, [
    { address: DEP.tervaneCore, abi: coreAbi, functionName: 'submitIntent', args: [bytesToHex(blob)], gas: GAS.submitIntent },
  ], onPhase)
  if (!receipt) return null
  // 6. Record locally; the inbox index becomes the order id.
  const log = parseEventLogs({ abi: coreAbi, eventName: 'InboxMessage', logs: receipt.logs })[0]
  addIntent(sender, {
    txHash: receipt.transactionHash, inboxIndex: log ? log.args.index.toString() : null, action: d.action,
    tenorId: p.tenorId, amount: p.amount.toString(), rateBps: p.rateBps, collateral: p.collateral.toString(),
    refId: p.refId.toString(), nonce: nonce.toString(), at: Math.floor(Date.now() / 1000),
  })
  return { receipt, inboxIndex: log?.args.index ?? null }
}
