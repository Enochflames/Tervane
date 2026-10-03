import { useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import { ConnectButton } from './AppLayout'
import { unlockLedger } from './hooks/useServer'
import { txError } from './lib/tx'
import { Notice } from './ui/ui'

/** Ledger views need a wallet signature (EIP-712, read-only, no gas). Explain it before asking for it. */
export function LedgerGate({ children, need = 'ledger' }: { children: ReactNode; need?: 'wallet' | 'ledger' }) {
  const app = useApp()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!app.isConnected || app.wrongChain) {
    return (
      <div className="gate">
        <h2 className="display">{app.wrongChain ? 'Switch to Monad testnet' : 'Connect a wallet'}</h2>
        <p>{app.wrongChain ? 'Tervane runs on Monad testnet (chain id 10143).' : 'Use any injected wallet with testnet MON for gas.'}</p>
        <ConnectButton />
      </div>
    )
  }
  if (need === 'wallet' || app.session) return <>{children}</>
  return (
    <div className="gate">
      <h2 className="display">Open your ledger view</h2>
      <p>
        Your balances, orders and loans live in the committed ledger, which our server stores. To show them only to you, the
        server asks for a signature proving you control this address. It costs no gas, moves nothing, and lasts five minutes.
      </p>
      <button className="btn" data-variant="primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null)
        try { await unlockLedger(app.address!) } catch (e) { setErr(txError(e)) } finally { setBusy(false) }
      }}>{busy ? 'Waiting for signature…' : 'Sign to view my ledger'}</button>
      {err && <Notice tone="warn">{err}</Notice>}
      <p className="gate-fine">Your bids are never in that view. The server doesn’t have them; this device does.</p>
    </div>
  )
}

/** Shown under ledger pages: session timer and refresh, plus server errors. */
export function LedgerStatus() {
  const app = useApp()
  if (!app.session) return null
  const err = app.ledger.error as (Error & { code?: string }) | null
  return (
    <div className="ledgerst">
      {err ? <span className="ledgerst-err">Server unreachable: {err.message}. Chain data is still live.</span>
        : <span>Ledger view · epoch {app.ledger.data?.epoch ?? '…'} · refreshes every few seconds</span>}
      <span className="mono">{Math.max(0, app.expiresIn)} s left</span>
    </div>
  )
}
