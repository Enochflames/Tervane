import { ACTION_BORROW, ACTION_LEND } from '@tervane/core'
import { useApp } from '../AppContext'
import { TENOR_OPTIONS } from '../lib/config'
import { usd } from '../lib/format'
import { ACTION_LABEL } from '../lib/intents'
import type { LocalIntent } from '../lib/storage'
import { TxLink } from '../ui/ui'

export const tenorLabel = (id: number) => TENOR_OPTIONS.find((t) => t.id === id)?.label ?? `tenor ${id}`

const REASONS: Record<number, string> = {
  [ACTION_LEND]: 'not enough free tUSD when it was processed, a reused nonce, or a tenor this deployment doesn’t offer',
  [ACTION_BORROW]: 'free tETH below the collateral, the tier’s borrow cap, or collateral under the opening ratio at the epoch’s price',
  3: 'the order had already filled or expired',
  4: 'free tUSD below the amount owed when it was processed',
}

/** Follows one intent from submission to its outcome in the ledger (CLIENT.md §4). */
export function IntentStatus({ intent }: { intent: LocalIntent }) {
  const { chain, ledger } = useApp()
  const idx = intent.inboxIndex ? BigInt(intent.inboxIndex) : null
  const cursor = chain.data?.cursor ?? 0n
  const processed = idx !== null && cursor >= idx
  const orders = ledger.data?.openOrders ?? []
  const loans = ledger.data?.loans ?? []
  const order = processed ? orders.find((o) => o.id === intent.inboxIndex) : undefined
  const resting = !!order
  const filled = order ? BigInt(intent.amount) - BigInt(order.remaining) : 0n
  const matched = processed && !resting && (intent.action === ACTION_LEND || intent.action === ACTION_BORROW)
    && loans.some((l) => Number(l.openedAt) >= intent.at - 5)
  const done = processed && (intent.action === 3 || intent.action === 4)
  let outcome: { state: 'active' | 'done' | 'failed'; title: string; body: string }
  if (!processed) outcome = { state: 'active', title: 'Waiting for the next epoch', body: 'The CRE workflow settles on a log trigger and a 30-second heartbeat. On this testnet, epochs run when the simulator is invoked.' }
  else if (!ledger.data) outcome = { state: 'done', title: 'Settled', body: 'Open your ledger view to see the outcome.' }
  else if (resting && filled > 0n) outcome = { state: 'done', title: 'Partly matched', body: `${usd(filled)} tUSD filled at the clearing rate; ${usd(BigInt(order!.remaining))} tUSD rests in the book, still sealed.` }
  else if (resting) outcome = { state: 'done', title: 'Resting in the book, sealed', body: 'No match yet. Your rate stays encrypted; it is re-checked every epoch.' }
  else if (matched) outcome = { state: 'done', title: 'Matched', body: 'A loan was opened at the clearing rate. See Positions.' }
  else if (done) outcome = { state: 'done', title: 'Processed', body: 'The ledger reflects it from this epoch.' }
  else outcome = { state: 'failed', title: 'Not accepted', body: `The enclave consumed it without effect. Likely: ${REASONS[intent.action] ?? 'a failed check'}.` }
  return (
    <ol className="timeline">
      <li data-state="done"><span className="timeline-dot" /><div className="timeline-text"><strong>Encrypted on this device</strong><p>{ACTION_LABEL[intent.action]} · 350-byte blob bound to your address</p></div></li>
      <li data-state="done"><span className="timeline-dot" /><div className="timeline-text"><strong>On Monad</strong><p>Inbox #{intent.inboxIndex ?? '?'} · <TxLink hash={intent.txHash} /></p></div></li>
      <li data-state={outcome.state}><span className="timeline-dot" /><div className="timeline-text"><strong>{outcome.title}</strong><p>{outcome.body}</p></div></li>
    </ol>
  )
}
