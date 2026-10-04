import { coreAbi, erc20Abi } from '@tervane/core'
import { useState } from 'react'
import { useApp } from '../AppContext'
import { LedgerGate } from '../LedgerGate'
import { DEP, GAS } from '../lib/config'
import { eth, until, usd } from '../lib/format'
import { accountArg, loanArgs } from '../lib/proofArgs'
import { runTxs, type TxPhase } from '../lib/tx'
import type { ProofBundle } from '../hooks/useServer'
import { Empty, KV, Notice, Panel, TxButton } from '../ui/ui'

export function Escape() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Escape hatch</h1>
          <p>If settlement stops for longer than the escape delay, anyone can activate the escape hatch. From then on reports are rejected and every account exits with a Merkle proof against the last committed root.</p>
        </div>
      </div>
      <LedgerGate need="wallet"><EscapeBody /></LedgerGate>
    </>
  )
}

function EscapeBody() {
  const app = useApp()
  const c = app.chain.data
  const w = app.wallet.data
  const [phase, setPhase] = useState<Record<string, TxPhase>>({})
  const set = (k: string) => (p: TxPhase) => setPhase((s) => ({ ...s, [k]: p }))
  // Prefer a fresh server proof; fall back to the bundle cached on this device (CLIENT.md §5).
  const bundle = (app.proof.data ?? app.local.proof?.bundle) as ProofBundle | undefined
  const fromCache = !app.proof.data && !!app.local.proof
  const stale = !!bundle && !!c && bundle.root.toLowerCase() !== c.stateRoot.toLowerCase()
  if (!c) return <Empty title="Reading chain…" />
  const opensAt = Number(c.lastSettleAt + c.escapeDelay)
  const me = app.address!.toLowerCase()

  return (
    <div className="stack">
      <Panel title="Status">
        <dl>
          <KV k="Escape" v={c.escaped ? 'active' : app.escapeOpen ? 'available to activate' : `closed · opens ${until(opensAt - app.now)}`} />
          <KV k="Last committed root" v={`${c.stateRoot.slice(0, 10)}… (epoch ${c.lastEpoch})`} />
          <KV k="Your proof" v={bundle ? `${fromCache ? 'cached on this device' : 'from the server'} · epoch ${bundle.epoch}` : 'none yet'} />
        </dl>
        {!c.escaped && (
          <div style={{ marginTop: 'var(--s-4)' }}>
            <TxButton phase={phase.activate ?? 'idle'} disabled={!app.escapeOpen}
              onClick={() => runTxs('Activate escape', [{ address: DEP.tervaneCore, abi: coreAbi, functionName: 'activateEscape', gas: GAS.activateEscape }], set('activate'))}>
              Activate escape hatch
            </TxButton>
          </div>
        )}
      </Panel>

      {stale && <Notice tone="warn" title="Your proof is stale">It belongs to epoch {bundle!.epoch}, but the chain’s root has moved on. Open your ledger view to fetch a fresh one before exiting.</Notice>}
      {!bundle && <Notice title="No proof yet">Open your ledger view (Positions or Credit) while the server is up to fetch and cache your proof.</Notice>}

      {bundle && !stale && c.escaped && (
        <>
          <Panel title="Exit your account">
            <p className="small muted">Pays out your free and reserved balances. Collateral locked in loans is released when the loan resolves below.</p>
            <dl style={{ marginTop: 'var(--s-3)' }}>
              <KV k="tUSD" v={usd(BigInt(bundle.account.value.usdFree) + BigInt(bundle.account.value.usdReserved))} />
              <KV k="tETH" v={eth(BigInt(bundle.account.value.ethFree) + BigInt(bundle.account.value.ethReserved))} />
            </dl>
            <div style={{ marginTop: 'var(--s-4)' }}>
              {w?.exited ? <Notice>You have already exited.</Notice> : (
                <TxButton phase={phase.exit ?? 'idle'} onClick={() => runTxs('Exit account', [{ address: DEP.tervaneCore, abi: coreAbi, functionName: 'exitAccount', args: [accountArg(bundle.account.value), bundle.account.proof as `0x${string}`[]], gas: GAS.exitAccount }], set('exit'))}>
                  Exit with Merkle proof
                </TxButton>
              )}
            </div>
          </Panel>

          <Panel title="Your loans" pad={false}>
            {bundle.loans.length === 0 ? <Empty title="No loans in your proof" /> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Loan</th><th>Role</th><th className="num">Owed</th><th className="num">Collateral</th><th /></tr></thead>
                  <tbody>
                    {bundle.loans.map((l) => {
                      const borrower = l.value.borrower.toLowerCase() === me
                      const k = `loan-${l.value.id}`
                      return (
                        <tr key={l.value.id}>
                          <td className="mono">#{l.value.id}</td>
                          <td>{borrower ? 'borrower' : 'lender'}</td>
                          <td className="num">{usd(BigInt(l.value.owed))}</td>
                          <td className="num">{eth(BigInt(l.value.collateral))} tETH</td>
                          <td className="num">
                            {borrower ? (
                              <TxButton phase={phase[k] ?? 'idle'} variant="secondary" onClick={() => runTxs('Repay and reclaim collateral', [
                                { address: DEP.usdToken, abi: erc20Abi, functionName: 'approve', args: [DEP.tervaneCore, BigInt(l.value.owed)], gas: GAS.approve },
                                { address: DEP.tervaneCore, abi: coreAbi, functionName: 'escapeRepay', args: loanArgs(l), gas: GAS.escapeRepay },
                              ], set(k))}>Repay</TxButton>
                            ) : (
                              <TxButton phase={phase[k] ?? 'idle'} variant="secondary" onClick={() => runTxs('Liquidate loan', [
                                { address: DEP.tervaneCore, abi: coreAbi, functionName: 'escapeLiquidate', args: loanArgs(l), gas: GAS.escapeLiquidate },
                              ], set(k))}>Liquidate if eligible</TxButton>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Claims">
            <dl>
              <KV k="tUSD from repaid loans" v={w ? usd(w.claimUsd) : '…'} />
              <KV k="tETH from liquidations" v={w ? eth(w.claimEth) : '…'} />
            </dl>
            <div style={{ marginTop: 'var(--s-4)' }}>
              <TxButton phase={phase.claim ?? 'idle'} disabled={!w || (w.claimUsd === 0n && w.claimEth === 0n)}
                onClick={() => runTxs('Claim', [{ address: DEP.tervaneCore, abi: coreAbi, functionName: 'claim', gas: GAS.claim }], set('claim'))}>Claim</TxButton>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
