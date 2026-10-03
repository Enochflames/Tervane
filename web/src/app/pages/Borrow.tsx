import { ACTION_BORROW, ACTION_CANCEL, BPS, TIERS, VALUE_SCALE, ceilDiv, tierCap } from '@tervane/core'
import { useMemo, useState } from 'react'
import { Segmented } from '../../components/Segmented'
import { useApp } from '../AppContext'
import { LedgerGate, LedgerStatus } from '../LedgerGate'
import { TENOR_OPTIONS } from '../lib/config'
import { eth, parseRateBps, parseUnitsSafe, pct, usd } from '../lib/format'
import { precheck, submitIntent, type IntentDraft } from '../lib/intents'
import type { TxPhase } from '../lib/tx'
import { Empty, Field, KV, Notice, Panel, TxButton } from '../ui/ui'
import { IntentStatus, tenorLabel } from './common'

export function Borrow() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Borrow</h1>
          <p>Set the highest rate you’ll pay. If you fill, you pay the clearing rate, which is at most your maximum. Your maximum is visible only to you and the enclave.</p>
        </div>
      </div>
      <LedgerGate><BorrowBody /></LedgerGate>
    </>
  )
}

function BorrowBody() {
  const app = useApp()
  const [tenor, setTenor] = useState(String(TENOR_OPTIONS[0]!.id))
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [coll, setColl] = useState('')
  const [phase, setPhase] = useState<TxPhase>('idle')
  const acct = app.ledger.data?.account ?? null
  const price = app.chain.data?.price
  const tier = acct?.tier ?? 0
  const tp = TIERS[tier]!
  const amt = parseUnitsSafe(amount, 6)
  const bps = parseRateBps(rate)
  const col = parseUnitsSafe(coll, 18)
  // smallest collateral that meets the opening ratio: value × BPS ≥ principal × openRatio, value = coll × price / 1e20
  const minColl = amt && price ? ceilDiv(ceilDiv(amt * tp.openRatioBps, BPS) * VALUE_SCALE, price) : null
  const liqPrice = amt && col && col > 0n ? (amt * tp.liqRatioBps * VALUE_SCALE) / (BPS * col) : null
  const draft: IntentDraft | null = amt && bps && col ? { action: ACTION_BORROW, tenorId: Number(tenor), amount: amt, rateBps: bps, collateral: col } : null
  const issues = draft ? precheck(draft, { account: acct, orders: app.ledger.data?.openOrders ?? [], loans: app.ledger.data?.loans ?? [], price }) : []
  const outstanding = (app.ledger.data?.loans ?? []).filter((l) => l.role === 'borrower').reduce((s, l) => s + BigInt(l.principal), 0n)
    + (app.ledger.data?.openOrders ?? []).filter((o) => o.side === 2).reduce((s, o) => s + BigInt(o.remaining), 0n)
  const cap = acct ? tierCap(tier, BigInt(acct.repaidVolume)) : 2_000_000_000n
  const mine = (app.ledger.data?.openOrders ?? []).filter((o) => o.side === 2)
  const latest = useMemo(() => app.local.intents.find((i) => i.action === ACTION_BORROW), [app.local.intents])
  const [cancelPhase, setCancelPhase] = useState<Record<string, TxPhase>>({})

  const submit = async () => {
    if (!draft || issues.length) return
    const r = await submitIntent(app.address!, BigInt(acct?.nonce ?? '0'), draft, setPhase)
    if (r) { setAmount(''); setRate(''); setColl('') }
  }
  const cancel = (id: string) => submitIntent(app.address!, BigInt(acct?.nonce ?? '0'), { action: ACTION_CANCEL, refId: BigInt(id) }, (p) => setCancelPhase((s) => ({ ...s, [id]: p })))

  return (
    <div className="stack">
      <div className="grid-form">
        <Panel title="New borrow order">
          <div className="stack-sm">
            <div className="form-row"><span>Tenor</span><Segmented options={TENOR_OPTIONS.map((t) => ({ value: String(t.id), label: t.label }))} value={tenor} onChange={setTenor} label="Tenor" /></div>
            <Field label="Amount" suffix="tUSD" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !amt ? 'Enter a number.' : null}
              hint={`Borrow cap for ${tp.name}: ${usd(cap, 0)} tUSD · ${usd(outstanding, 0)} in use`} />
            <Field label="Maximum rate" suffix="% APR" placeholder="6.00" value={rate} onChange={(e) => setRate(e.target.value)} error={rate && !bps ? 'Between 0.01 and 100.' : null}
              hint="Sealed: encrypted in this browser. Borrows fill whole or not at all." />
            <Field label="Collateral" suffix="tETH" placeholder="0.0000" value={coll} onChange={(e) => setColl(e.target.value)} error={coll && !col ? 'Enter a number.' : null}
              action={minColl ? <button type="button" className="linkbtn" onClick={() => setColl(eth(minColl, 6).replace(/,/g, ''))}>Use minimum {eth(minColl)}</button> : undefined} />
            {issues.length > 0 && <Notice tone="warn">{issues.map((i) => <div key={i}>{i}</div>)}</Notice>}
            <TxButton phase={phase} wide disabled={!draft || issues.length > 0} onClick={submit}>Seal and submit</TxButton>
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Collateral at the current price">
            <dl>
              <KV k="Your tier" v={tp.name} />
              <KV k="Opens at / liquidates below" v={`${Number(tp.openRatioBps) / 10_000}× / ${Number(tp.liqRatioBps) / 10_000}×`} />
              <KV k="ETH / USD" v={price ? `$${usd(price / 100n)}` : '…'} />
              <KV k="Minimum collateral" v={minColl ? `${eth(minColl)} tETH` : '—'} />
              <KV k="Liquidation price" v={liqPrice ? `$${usd(liqPrice / 100n)}` : '—'} />
              <KV k="Free tETH in the ledger" v={acct ? `${eth(BigInt(acct.ethFree))}` : '—'} />
            </dl>
          </Panel>
          <Panel title="Latest intent">
            {latest ? <IntentStatus intent={latest} /> : <Empty title="Nothing submitted yet" />}
          </Panel>
        </div>
      </div>

      <Panel title="My borrow orders" aside={<span className="local-tag">your maximum: from this device only</span>} pad={false}>
        {mine.length === 0 ? <Empty title="No open borrow orders" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Tenor</th><th className="num">Amount</th><th className="num">Collateral</th><th className="num">Your maximum</th><th /></tr></thead>
              <tbody>
                {mine.map((o) => {
                  const r = app.local.rateFor(o.id)
                  return (
                    <tr key={o.id}>
                      <td className="mono">#{o.id}</td>
                      <td>{tenorLabel(o.tenorId)}</td>
                      <td className="num">{usd(BigInt(o.remaining))} tUSD</td>
                      <td className="num">{eth(BigInt(o.collateral))} tETH</td>
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
