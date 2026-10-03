import { NavLink, Outlet, Link } from 'react-router-dom'
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import { Wordmark } from '../components/Wordmark'
import { useApp } from './AppContext'
import { CHAIN_ID } from './lib/config'
import { ago, short } from './lib/format'
import { txError } from './lib/tx'
import { toast } from './ui/toast'
import { Toaster } from './ui/ui'
import './app.css'

const NAV = [
  { to: '/app', label: 'Market', end: true },
  { to: '/app/lend', label: 'Lend' },
  { to: '/app/borrow', label: 'Borrow' },
  { to: '/app/wallet', label: 'Wallet' },
  { to: '/app/positions', label: 'Positions' },
  { to: '/app/credit', label: 'Credit' },
]

export function ConnectButton() {
  const { isConnected, address, wrongChain } = useApp()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const sw = useSwitchChain()
  const injected = connectors.find((c) => c.type === 'injected')
  if (!isConnected) {
    const hasWallet = typeof window !== 'undefined' && 'ethereum' in window
    if (!hasWallet) return <a className="btn" data-variant="secondary" data-size="sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install a wallet</a>
    return (
      <button className="btn" data-variant="primary" data-size="sm" disabled={connect.isPending}
        onClick={() => injected && connect.mutateAsync({ connector: injected }).catch((e) => toast.show({ title: 'Couldn’t connect', body: txError(e), tone: 'error', ttl: 6000 }))}>
        {connect.isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }
  if (wrongChain) {
    return (
      <button className="btn" data-variant="primary" data-size="sm" disabled={sw.isPending}
        onClick={() => sw.mutateAsync({ chainId: CHAIN_ID }).catch((e) => toast.show({ title: 'Couldn’t switch network', body: txError(e), tone: 'error', ttl: 6000 }))}>
        Switch to Monad testnet
      </button>
    )
  }
  return (
    <button className="acct" onClick={() => disconnect.mutate({})} title="Disconnect">
      <span className="acct-dot" aria-hidden="true" />
      <span className="mono">{short(address!, 6, 4)}</span>
    </button>
  )
}

function NetworkStatus() {
  const { chain, now, escapeOpen } = useApp()
  const c = chain.data
  if (!c) return <span className="netst mono">{chain.error ? 'chain unreachable' : 'reading chain…'}</span>
  return (
    <span className="netst" data-escape={escapeOpen}>
      <span className="netst-dot" aria-hidden="true" />
      <span className="mono">epoch {c.lastEpoch.toString()}</span>
      <span className="netst-sep">·</span>
      <span>{c.escaped ? 'escape active' : `settled ${ago(now - Number(c.lastSettleAt))}`}</span>
    </span>
  )
}

export function AppLayout() {
  const { escapeOpen } = useApp()
  return (
    <div className="app">
      <header className="app-top">
        <div className="container app-top-inner">
          <Link to="/" className="app-brand" aria-label="Tervane overview"><Wordmark size={20} /></Link>
          <nav className="app-nav" aria-label="App">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
            {escapeOpen && <NavLink to="/app/escape" className="app-nav-escape">Escape</NavLink>}
          </nav>
          <div className="app-top-right">
            <NetworkStatus />
            <ConnectButton />
          </div>
        </div>
      </header>
      <main className="container app-main">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
