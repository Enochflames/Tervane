import { TIERS, coreAbi } from '@tervane/core'
import { useState } from 'react'
import { readContract } from 'wagmi/actions'
import { useApp } from '../AppContext'
import { LedgerGate, LedgerStatus } from '../LedgerGate'
import { CHAIN_ID, DEP } from '../lib/config'
import { usd } from '../lib/format'
import { accountArg } from '../lib/proofArgs'
import { txError } from '../lib/tx'
import { wagmiConfig } from '../lib/wagmi'
import { KV, Notice, Panel, Stat } from '../ui/ui'

export function Credit() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Credit</h1>
          <p>Repaid volume builds your tier, and a higher tier opens loans with less collateral. Prove your tier to anyone without revealing your orders or loans.</p>
        </div>
      </div>
      <LedgerGate><CreditBody /></LedgerGate>
    </>
  )
}

function CreditBody() {
  const app = useApp()
  const acct = app.ledger.data?.account
  const tier = acct?.tier ?? 0
  const repaid = BigInt(acct?.repaidVolume ?? '0')
  const next = TIERS[tier + 1]
  const progress = next ? Number((repaid * 10_000n) / next.minRepaid) / 10_000 : 1
  const [result, setResult] = useState<{ ok: boolean; root: string; epoch: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const prove = async () => {
    setBusy(true); setErr(null); setResult(null)
    try {
      const p = app.proof.data ?? (await app.proof.refetch()).data
      if (!p) throw new Error('No proof available yet: your account appears after your first deposit settles.')
      const ok = await readContract(wagmiConfig, {
        address: DEP.tervaneCore, abi: coreAbi, functionName: 'verifyAccount', args: [accountArg(p.account.value), p.account.proof as `0x${string}`[]], chainId: CHAIN_ID,
      })
      setResult({ ok, root: p.root, epoch: p.epoch })
    } catch (e) { setErr(txError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <dl className="stats">
        <Stat label="Tier" value={TIERS[tier]!.name} tone="accent" sub={`opens at ${Number(TIERS[tier]!.openRatioBps) / 10_000}× collateral`} />
        <Stat label="Repaid volume" value={`${usd(repaid, 0)} tUSD`} sub={next ? `${usd(next.minRepaid - repaid, 0)} to ${next.name}` : 'highest tier'} />
        <Stat label="Next tier opens at" value={next ? `${Number(next.openRatioBps) / 10_000}×` : '—'} sub={next ? `${next.name}, after ${usd(next.minRepaid, 0)} repaid` : undefined} />
      </dl>
      {next && <div className="bar" aria-label={`Progress to ${next.name}`}><span style={{ transform: `scaleX(${Math.min(1, progress)})` }} /></div>}

      <div className="grid-2">
        <Panel title="Prove my tier">
          <div className="stack-sm">
            <p className="small muted">
              Fetches your account leaf and Merkle proof, then asks TervaneCore to check it against the live root. Anyone you share
              the leaf and proof with can run the same check, and learns your tier and repaid volume, nothing about your book.
            </p>
            <button className="btn" data-variant="primary" disabled={busy} onClick={prove}>{busy ? 'Checking onchain…' : 'Prove my tier onchain'}</button>
            {err && <Notice tone="warn">{err}</Notice>}
            {result && (
              <Notice tone={result.ok ? 'info' : 'warn'} title={result.ok ? 'verifyAccount → true' : 'verifyAccount → false'}>
                {result.ok ? `Disclosed: tier ${TIERS[tier]!.name}, repaid ${usd(repaid)} tUSD. Root ${result.root.slice(0, 10)}… (epoch ${result.epoch}).` : 'The proof is for an older root. Refresh and try again after the next epoch.'}
              </Notice>
            )}
          </div>
        </Panel>
        <Panel title="Tiers">
          <dl>
            {TIERS.map((t) => (
              <KV key={t.name} k={<span style={{ color: t.id === tier ? 'var(--ink)' : undefined, fontWeight: t.id === tier ? 500 : 400 }}>{t.name}</span>}
                v={`${Number(t.openRatioBps) / 10_000}× · from ${usd(t.minRepaid, 0)}`} />
            ))}
          </dl>
          <p className="muted xs" style={{ marginTop: 'var(--s-3)' }}>A liquidation drops you one tier and resets repaid volume to that tier’s floor.</p>
        </Panel>
      </div>
      {app.local.proof && <p className="muted xs">Proof cached on this device for the escape hatch: epoch {app.local.proof.epoch}, root {app.local.proof.root.slice(0, 10)}….</p>}
      <LedgerStatus />
    </div>
  )
}
