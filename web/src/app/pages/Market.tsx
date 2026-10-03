import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { TENOR_OPTIONS } from '../lib/config'
import { ago, pct, until, usd } from '../lib/format'
import { Empty, Notice, Panel, Stat } from '../ui/ui'

export function Market() {
  const { chain, market, now, escapeOpen } = useApp()
  const c = chain.data
  const clears = market.data?.clears ?? []
  const escapeAt = c ? Number(c.lastSettleAt + c.escapeDelay) : 0
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Market</h1>
          <p>One clearing rate per tenor, per epoch. That rate and the matched volume are the only market data Tervane publishes.</p>
        </div>
      </div>

      {escapeOpen && (
        <div style={{ marginBottom: 'var(--s-5)' }}>
          <Notice tone="warn" title={c?.escaped ? 'Escape hatch is active' : 'Settlement has stalled'}>
            {c?.escaped ? 'Reports are no longer accepted. Exit with a Merkle proof from the Escape page.' : 'No epoch has settled within the escape delay. Anyone can now activate the escape hatch.'}{' '}
            <Link to="/app/escape" className="accent">Open Escape →</Link>
          </Notice>
        </div>
      )}

      <dl className="stats" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Epoch" value={c ? c.lastEpoch.toString() : '—'} sub={c ? `settled ${ago(now - Number(c.lastSettleAt))}` : undefined} />
        <Stat label="ETH / USD (feed)" value={c ? `$${usd(c.price / 100n)}` : '—'} sub={c ? `round ${c.priceRound} · ${ago(now - Number(c.priceUpdatedAt))}` : undefined} />
        <Stat label="Inbox" value={c ? c.inboxCount.toString() : '—'} sub={c ? `${(c.inboxCount - c.cursor).toString()} awaiting settlement` : undefined} />
        <Stat label="Escape hatch" value={c?.escaped ? 'Active' : escapeOpen ? 'Available' : 'Closed'} tone={escapeOpen ? 'accent' : undefined}
          sub={c && !c.escaped ? (escapeOpen ? 'anyone can activate' : `opens ${until(escapeAt - now)} without settlement`) : undefined} />
      </dl>

      <Panel title="Clearing rates" aside={<span className="muted xs">from Cleared events, via the server</span>} pad={false}>
        {market.error ? (
          <Empty title="Server unreachable">Clearing rates come from the indexer. Chain data above is read directly and stays live.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Tenor</th><th className="num">Last clearing rate</th><th className="num">Volume</th><th className="num">Epoch</th></tr></thead>
              <tbody>
                {TENOR_OPTIONS.map((t) => {
                  const cl = clears.find((x) => x.tenorId === t.id)
                  return (
                    <tr key={t.id}>
                      <td>{t.label}</td>
                      <td className="num">{cl ? <span className="accent">{pct(cl.rateBps)}</span> : <span className="muted">no clear yet</span>}</td>
                      <td className="num">{cl ? `${usd(BigInt(cl.volume), 0)} tUSD` : '—'}</td>
                      <td className="num">{cl ? cl.epoch : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="muted small" style={{ marginTop: 'var(--s-4)' }}>
        Lend and borrow intents are sealed: no order book is shown because none is published. <Link to="/app/lend" className="accent">Lend</Link> or{' '}
        <Link to="/app/borrow" className="accent">borrow</Link> at your own rate.
      </p>
    </>
  )
}
