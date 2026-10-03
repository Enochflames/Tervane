const marketRows = [
  { label: '7d', rate: '4.13%', volume: '$1.2M' },
  { label: '30d', rate: '5.27%', volume: '$3.9M', active: true },
  { label: '10m', rate: '5.52%', volume: '$980k' },
]

const trustPoints = [
  {
    title: 'Encrypted bids',
    text: 'Lenders and borrowers submit sealed intents; the public chain sees only a ciphertext and a sender address.',
  },
  {
    title: 'Chain-enforced results',
    text: 'The Merkle root, hash-chained inbox, fee cap, and price-round checks are all verified before state moves.',
  },
  {
    title: 'Exit if settlement stops',
    text: 'If the enforcer falls silent, the last committed root remains the escape path for all affected users.',
  },
]

const steps = [
  {
    num: '01',
    title: 'Submit an intent',
    text: 'A user encrypts a lend or borrow intent to the enclave key and posts it to the Monad inbox.',
  },
  {
    num: '02',
    title: 'Enclave clears the market',
    text: 'The Chainlink CRE workflow verifies the prior root and the inbox, decrypts the bids, and runs the auction.',
  },
  {
    num: '03',
    title: 'Only the benchmark is public',
    text: 'The result is a single public clearing rate per tenor; a lender’s minimum or borrower’s maximum stays private.',
  },
]

const metrics = [
  { label: 'Public rate', value: '5.27%' },
  { label: 'Epoch', value: '84' },
  { label: 'Protected', value: '100%' },
  { label: 'Exit path', value: 'Live' },
]

function App() {
  return (
    <div id="top" className="page-shell">
      <header className="topbar">
        <div className="brand-wrap" aria-label="Tervane home">
          <div className="brand-mark" aria-hidden="true">T</div>
          <span>Tervane</span>
        </div>
        <nav className="nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#diff">Why sealed bids</a>
          <a href="#trust">Trust model</a>
        </nav>
        <a className="nav-cta" href="#market">View market</a>
      </header>

      <main>
        <section className="hero section-shell">
          <div className="hero-copy">
            <p className="eyebrow">Sealed-bid fixed-rate credit on Monad</p>
            <h1>
              A market where the <span>book stays private</span> and the <span>result is public</span>.
            </h1>
            <p className="lede">
              Tervane lets lenders and borrowers submit encrypted intents, then settles each epoch through a Chainlink CRE enclave. The chain verifies the outcome and publishes only the clearing rate.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#market">Explore the market</a>
              <a className="secondary-action" href="#how-it-works">See the flow</a>
            </div>
            <div className="proof-row" aria-label="Key trust properties">
              <span>Rates visible only to you and the enclave</span>
              <span>Chain-checks every report</span>
            </div>
          </div>

          <div className="hero-panel" aria-label="Example market overview">
            <div className="panel-header">
              <div>
                <p className="panel-label">Live benchmark</p>
                <h2>30d clearing rate</h2>
              </div>
              <span className="status-pill">Settled</span>
            </div>
            <div className="rate-display">5.27%</div>
            <div className="mini-stats">
              {metrics.map((metric) => (
                <div key={metric.label} className="mini-stat">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <div className="chart-bars" aria-hidden="true">
              <span style={{ height: '32%' }} />
              <span style={{ height: '48%' }} />
              <span style={{ height: '62%' }} />
              <span style={{ height: '76%' }} />
              <span style={{ height: '100%' }} />
              <span style={{ height: '88%' }} />
            </div>
          </div>
        </section>

        <section id="market" className="market section-shell">
          <div className="section-heading">
            <p className="eyebrow">Market snapshot</p>
            <h2>Public benchmarks, private bids.</h2>
          </div>
          <div className="market-table" role="table" aria-label="Mock market snapshot">
            <div className="table-header" role="row">
              <span>Tenor</span>
              <span>Clearing rate</span>
              <span>Volume</span>
            </div>
            {marketRows.map((row) => (
              <div key={row.label} className={`table-row ${row.active ? 'active' : ''}`} role="row">
                <span>{row.label}</span>
                <strong>{row.rate}</strong>
                <span>{row.volume}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="section-shell">
          <div className="section-heading narrow">
            <p className="eyebrow">How it works</p>
            <h2>Onchain accountability, enclave-only pricing.</h2>
          </div>
          <div className="steps-grid">
            {steps.map((step) => (
              <article key={step.num} className="step-card">
                <span className="step-number">{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="diff" className="section-shell diff-section">
          <div className="diff-copy">
            <p className="eyebrow">Why sealed bids matter</p>
            <h2>Public order books reveal everyone’s cost of capital.</h2>
            <p>
              Tervane keeps the book sealed. Lenders and borrowers submit encrypted intents, and the clearing rate is the only benchmark the market reveals. The chain still verifies the result: hash-chained inbox, Merkle-root sequencing, feed-verified price checks, and payout ceilings.
            </p>
          </div>
          <div className="diff-panel">
            <div className="compare-card old-book">
              <span className="compare-label">Public order book</span>
              <ul>
                <li>Every bid is visible</li>
                <li>Cost of capital leaks</li>
                <li>Positions are exposed</li>
              </ul>
            </div>
            <div className="compare-card new-book">
              <span className="compare-label">Tervane</span>
              <ul>
                <li>Encrypted intents</li>
                <li>One public clearing rate</li>
                <li>Verified settlement path</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="trust" className="section-shell trust-section">
          <div className="section-heading narrow">
            <p className="eyebrow">Trust model</p>
            <h2>Built to be honest about the limits.</h2>
          </div>
          <div className="trust-grid">
            {trustPoints.map((point) => (
              <article key={point.title} className="trust-card">
                <h3>{point.title}</h3>
                <p>{point.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="closing section-shell">
          <div className="closing-panel">
            <p className="eyebrow">Track 01 framing</p>
            <h2>Onchain credit history, not a public bid tape.</h2>
            <p>
              Tervane makes the market structure the product: fixed-rate term credit with private bids, visible execution results, and an explicit escape path if settlement stops.
            </p>
            <a className="primary-action" href="#top">Back to top</a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="brand-wrap" aria-label="Tervane footer">
          <div className="brand-mark" aria-hidden="true">T</div>
          <span>Tervane</span>
        </div>
        <p>
          Rates are visible only to you and a Chainlink CRE enclave. The chain sees the verified result, not the full bid tape.
        </p>
      </footer>
    </div>
  )
}

export default App
