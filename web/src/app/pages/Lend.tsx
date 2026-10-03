import { ACTION_CANCEL, ACTION_LEND } from '@tervane/core'
import { useMemo, useState } from 'react'
import { Segmented } from '../../components/Segmented'
import { useApp } from '../AppContext'
import { LedgerGate, LedgerStatus } from '../LedgerGate'
import { TENOR_OPTIONS } from '../lib/config'
import { parseRateBps, parseUnitsSafe, pct, usd } from '../lib/format'
import { precheck, submitIntent, type IntentDraft } from '../lib/intents'
import type { TxPhase } from '../lib/tx'
import { Empty, Field, Notice, Panel, TxButton } from '../ui/ui'
import { IntentStatus, tenorLabel } from './common'

export function Lend() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lend</h1>
          <p>Set the lowest rate you’ll accept. If you fill, you earn the clearing rate, which is at least your minimum. Your minimum is visible only to you and the enclave.</p>
        </div>
      </div>
      <LedgerGate><LendBody /></LedgerGate>
    </>
  )
}

function LendBody() {
  const app = useApp()
  const [tenor, setTenor] = useState(String(TENOR_OPTIONS[0]!.id))
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [phase, setPhase] = useState<TxPhase>('idle')
  const acct = app.ledger.data?.account ?? null
  const amt = parseUnitsSafe(amount, 6)
  const bps = parseRateBps(rate)
  const draft: IntentDraft | null = amt && bps ? { action: ACTION_LEND, tenorId: Number(tenor), amount: amt, rateBps: bps } : null
  const issues = draft ? precheck(draft, { account: acct, orders: app.ledger.data?.openOrders ?? [], loans: app.ledger.data?.loans ?? [], price: app.chain.data?.price }) : []
  const mine = (app.ledger.data?.openOrders ?? []).filter((o) => o.side === 1)
  const latest = useMemo(() => app.local.intents.find((i) => i.action === ACTION_LEND), [app.local.intents])
  const [cancelPhase, setCancelPhase] = useState<Record<string, TxPhase>>({})

  const submit = async () => {
    if (!draft || issues.length) return
    const r = await submitIntent(app.address!, BigInt(acct?.nonce ?? '0'), draft, setPhase)
    if (r) { setAmount(''); setRate('') }
  }
  const cancel = (id: string) => submitIntent(app.address!, BigInt(acct?.nonce ?? '0'), { action: ACTION_CANCEL, refId: BigInt(id) }, (p) => setCancelPhase((s) => ({ ...s, [id]: p })))

  return (
    <div className="stack">
      <div className="grid-form">
        <Panel title="New lend order">
          <div className="stack-sm">
            <div className="form-row"><span>Tenor</span><Segmented options={TENOR_OPTIONS.map((t) => ({ value: String(t.id), label: t.label }))} value={tenor} onChange={setTenor} label="Tenor" /></div>
            <Field label="Amount" suffix="tUSD" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              action={acct ? <button type="button" className="linkbtn" onClick={() => setAmount(usd(BigInt(acct.usdFree)).replace(/,/g, ''))}>Free {usd(BigInt(acct.usdFree))}</button> : undefined}
              error={amount && !amt ? 'Enter a number.' : null} />
            <Field label="Minimum rate" suffix="% APR" placeholder="5.00" value={rate} onChange={(e) => setRate(e.target.value)}
              error={rate && !bps ? 'Between 0.01 and 100.' : null} hint="Sealed: encrypted in this browser to the enclave key published on TervaneCore." />
            {issues.length > 0 && <Notice tone="warn">{issues.map((i) => <div key={i}>{i}</div>)}</Notice>}
            <TxButton phase={phase} wide disabled={!draft || issues.length > 0} onClick={submit}>Seal and submit</TxButton>
          </div>
        </Panel>
        <Panel title="Latest intent">
          {latest ? <IntentStatus intent={latest} /> : <Empty title="Nothing submitted yet">Your intent is encrypted here, posted to the inbox, then settled by the enclave at the next epoch.</Empty>}
        </Panel>
      </div>

      <Panel title="My lend orders" aside={<span className="local-tag">your bid: from this device only</span>} pad={false}>
        {mine.length === 0 ? <Empty title="No open lend orders" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Tenor</th><th className="num">Remaining</th><th className="num">Your minimum</th><th /></tr></thead>
              <tbody>
                {mine.map((o) => {
                  const r = app.local.rateFor(o.id)
                  return (
                    <tr key={o.id}>
                      <td className="mono">#{o.id}</td>
                      <td>{tenorLabel(o.tenorId)}</td>
                      <td className="num">{usd(BigInt(o.remaining))} tUSD</td>
                      <td className="num">{r !== undefined ? pct(r) : <span className="muted">not on this device</span>}</td>
                      <td className="num"><TxButton phase={cancelPhase[o.id] ?? 'idle'} variant="secondary" onClick={() => cancel(o.id)}>Cancel</TxButton></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <LedgerStatus />
    </div>
  )
}
