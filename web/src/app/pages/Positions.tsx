import { ACTION_REPAY, BPS, TIERS, VALUE_SCALE } from '@tervane/core'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { LedgerGate, LedgerStatus } from '../LedgerGate'
import { ago, eth, pct, until, usd } from '../lib/format'
import { submitIntent } from '../lib/intents'
import type { TxPhase } from '../lib/tx'
import { Empty, Panel, Pill, TxButton } from '../ui/ui'
import { IntentStatus, tenorLabel } from './common'

export function Positions() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Positions</h1>
          <p>Fixed-rate term loans: interest is set at opening for the full term. Loans are hidden from the public chain; only the ledger’s Merkle root is published.</p>
        </div>
      </div>
      <LedgerGate><PositionsBody /></LedgerGate>
    </>
  )
}

function PositionsBody() {
  const app = useApp()
  const acct = app.ledger.data?.account
  const loans = app.ledger.data?.loans ?? []
  const borrowed = loans.filter((l) => l.role === 'borrower')
  const lent = loans.filter((l) => l.role === 'lender')
  const closed = app.ledger.data?.closedLoans ?? []
  const [phase, setPhase] = useState<Record<string, TxPhase>>({})
  const latest = useMemo(() => app.local.intents.find((i) => i.action === ACTION_REPAY), [app.local.intents])
  const free = acct ? BigInt(acct.usdFree) : 0n

  return (
    <div className="stack">
      <Panel title="Borrowed" pad={false}>
        {borrowed.length === 0 ? <Empty title="No active loans as borrower">Borrow orders fill at the next epoch that clears your tenor.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Loan</th><th>Tenor</th><th className="num">Principal</th><th className="num">Rate</th><th className="num">Owed</th><th className="num">Matures</th><th className="num">Health</th><th className="num">Liquidates below</th><th /></tr></thead>
              <tbody>
                {borrowed.map((l) => {
                  const owed = BigInt(l.owed)
                  const health = l.healthBps ? Number(l.healthBps) / 10_000 : null
                  const liqRatio = TIERS[l.tierAtOpen]!.liqRatioBps
                  const liqPrice = (owed * liqRatio * VALUE_SCALE) / (BPS * BigInt(l.collateral))
                  const short = owed > free
                  return (
                    <tr key={l.id}>
                      <td className="mono">#{l.id}</td>
                      <td>{tenorLabel(l.tenorId)}</td>
                      <td className="num">{usd(BigInt(l.principal))}</td>
                      <td className="num">{pct(l.clearingRateBps)}</td>
                      <td className="num">{usd(owed, 6)}</td>
                      <td className="num">{until(Number(l.maturity) - app.now)}</td>
                      <td className="num">{health !== null ? <Pill tone={health < Number(liqRatio) / 10_000 * 1.1 ? 'warn' : 'neutral'}>{health.toFixed(2)}×</Pill> : '—'}</td>
                      <td className="num">${usd(liqPrice / 100n)}</td>
                      <td className="num">
                        {short
                          ? <Link to="/app/wallet" className="small accent">Deposit {usd(owed - free)} to repay</Link>
                          : <TxButton phase={phase[l.id] ?? 'idle'} variant="secondary" onClick={() => submitIntent(app.address!, BigInt(acct?.nonce ?? '0'), { action: ACTION_REPAY, refId: BigInt(l.id) }, (p) => setPhase((s) => ({ ...s, [l.id]: p })))}>Repay</TxButton>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Lent" pad={false}>
        {lent.length === 0 ? <Empty title="No active loans as lender">When your lend order fills, your share of each loan appears here.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Loan</th><th>Tenor</th><th className="num">Your share</th><th className="num">Clearing rate</th><th className="num">Expected at maturity</th><th className="num">Matures</th><th className="num">Collateral</th></tr></thead>
              <tbody>
                {lent.map((l) => {
                  const share = BigInt(l.share ?? '0')
                  const expected = (BigInt(l.owed) * share) / BigInt(l.principal)
                  return (
                    <tr key={l.id}>
                      <td className="mono">#{l.id}</td>
                      <td>{tenorLabel(l.tenorId)}</td>
                      <td className="num">{usd(share)}</td>
                      <td className="num">{pct(l.clearingRateBps)}</td>
                      <td className="num">{usd(expected, 6)}</td>
                      <td className="num">{until(Number(l.maturity) - app.now)}</td>
                      <td className="num">{eth(BigInt(l.collateral))} tETH</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Closed" pad={false}>
        {closed.length === 0 ? <Empty title="No closed loans yet">Loans you borrowed or lent appear here once they’re repaid or liquidated.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Loan</th><th>Role</th><th>Tenor</th><th className="num">Amount</th><th className="num">Clearing rate</th><th className="num">Settled for</th><th>Outcome</th><th className="num">Closed</th></tr></thead>
              <tbody>
                {closed.map((l) => {
                  const amount = l.role === 'borrower' ? BigInt(l.principal) : BigInt(l.share ?? '0')
                  const owed = (BigInt(l.owed) * amount) / BigInt(l.principal)
                  return (
                    <tr key={l.id}>
                      <td className="mono">#{l.id}</td>
                      <td>{l.role === 'borrower' ? 'Borrowed' : 'Lent'}</td>
                      <td>{tenorLabel(l.tenorId)}</td>
                      <td className="num">{usd(amount)}</td>
                      <td className="num">{pct(l.clearingRateBps)}</td>
                      <td className="num">{l.outcome === 'repaid' ? `${usd(owed, 6)} tUSD` : l.role === 'lender' ? 'in tETH from collateral' : `${eth(BigInt(l.collateral))} tETH collateral liquidated`}</td>
                      <td>{l.outcome === 'repaid' ? <Pill tone="positive">Repaid</Pill> : <Pill tone="warn">Liquidated</Pill>}</td>
                      <td className="num">{l.closedAt ? ago(app.now - Number(l.closedAt)) : `epoch ${l.closedEpoch}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {latest && <Panel title="Latest repayment"><IntentStatus intent={latest} /></Panel>}
      <p className="muted xs">If a loan’s health falls below its liquidation ratio, or it passes maturity plus the grace period, the enclave liquidates it: owed + 10% of collateral is seized, 5% of that goes to the treasury, the rest to lenders pro rata.</p>
      <LedgerStatus />
    </div>
  )
}
