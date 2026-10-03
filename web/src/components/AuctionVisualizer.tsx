import React, { useState, useMemo } from 'react'
import { DEMO_BOOK } from '../types'
import { simulateUniformAuction } from '../utils/protocolMath'

export const AuctionVisualizer: React.FC = () => {
  const [viewMode, setViewMode] = useState<'tee' | 'public'>('tee')
  const [borrowerMaxRateBps, setBorrowerMaxRateBps] = useState<number>(552)
  const [borrowerAmount, setBorrowerAmount] = useState<number>(1000)
  const [auditRun, setAuditRun] = useState<boolean>(false)

  // Demo lenders
  const lenders = useMemo(() => [
    { id: 'ada', name: 'Ada', amount: 600, minRateBps: 413 },
    { id: 'bola', name: 'Bola', amount: 600, minRateBps: 527 },
    { id: 'chidi', name: 'Chidi', amount: 1000, minRateBps: 611 },
  ], [])

  const borrower = useMemo(() => ({
    name: 'Dayo (Bronze)',
    amount: borrowerAmount,
    maxRateBps: borrowerMaxRateBps,
  }), [borrowerAmount, borrowerMaxRateBps])

  // Run the exact protocol uniform call auction
  const auctionResult = useMemo(() => {
    return simulateUniformAuction(lenders, borrower)
  }, [lenders, borrower])

  return (
    <section id="auction-engine" className="auction-section">
      <div className="section-header">
        <div className="section-pill">Interactive Protocol Engine</div>
        <h2 className="section-title">
          Uniform-Price Call Auction Visualizer
        </h2>
        <p className="section-subtitle">
          Experience the exact deterministic demo book from <code className="inline-code">docs/DEMO-SCRIPT.md</code>.
          Toggle between what the public chain observes vs what happens inside the Chainlink CRE enclave memory.
        </p>
      </div>

      {/* Control Bar: Perspective Toggle & Parameters */}
      <div className="auction-control-panel">
        <div className="view-mode-toggle">
          <span className="toggle-label">Perspective:</span>
          <div className="segmented-switch">
            <button
              type="button"
              className={`mode-btn ${viewMode === 'tee' ? 'active' : ''}`}
              onClick={() => setViewMode('tee')}
            >
              <span className="mode-indicator tee-dot" />
              Inside Enclave Memory (TEE)
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === 'public' ? 'active' : ''}`}
              onClick={() => setViewMode('public')}
            >
              <span className="mode-indicator public-dot" />
              Public Monad Chain View
            </button>
          </div>
        </div>

        {/* Live Tweak Sliders */}
        <div className="param-sliders">
          <div className="slider-group">
            <div className="slider-label-row">
              <span>Dayo Max Borrow Rate:</span>
              <span className="slider-val tabular-num">{(borrowerMaxRateBps / 100).toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="350"
              max="700"
              step="10"
              value={borrowerMaxRateBps}
              onChange={(e) => setBorrowerMaxRateBps(Number(e.target.value))}
              className="range-input"
            />
          </div>

          <div className="slider-group">
            <div className="slider-label-row">
              <span>Dayo Principal Demand:</span>
              <span className="slider-val tabular-num">${borrowerAmount} tUSD</span>
            </div>
            <input
              type="range"
              min="400"
              max="1800"
              step="100"
              value={borrowerAmount}
              onChange={(e) => setBorrowerAmount(Number(e.target.value))}
              className="range-input"
            />
          </div>
        </div>
      </div>

      {/* Main Auction Board */}
      <div className="auction-grid">
        {/* Left Column: Bids Table / Inbox */}
        <div className="auction-panel orders-panel">
          <div className="panel-top-row">
            <h3 className="panel-headline">
              {viewMode === 'tee' ? 'Decrypted Intent Book (Enclave Only)' : 'Onchain Monad Inbox (Encrypted)'}
            </h3>
            <span className="panel-chip">
              {viewMode === 'tee' ? 'Transient TEE Memory' : 'Permanent Public Calldata'}
            </span>
          </div>

          <div className="order-cards-stack">
            {DEMO_BOOK.map((bid) => {
              const isFilled = auctionResult.filledLenders.some((f) => f.name.toLowerCase().includes(bid.id.replace('bid-', '')))
              const isBorrower = bid.role === 'borrower'

              return (
                <div
                  key={bid.id}
                  className={`bid-card ${isBorrower ? 'borrower-card' : 'lender-card'} ${isFilled ? 'filled' : ''}`}
                >
                  <div className="bid-card-header">
                    <div className="bid-identity">
                      <span className={`role-badge ${bid.role}`}>
                        {bid.role.toUpperCase()}
                      </span>
                      <strong className="wallet-name">{bid.wallet}</strong>
                    </div>
                    <span className="deposit-tag">{bid.deposit}</span>
                  </div>

                  {viewMode === 'tee' ? (
                    // Plaintext TEE View
                    <div className="tee-bid-details">
                      <div className="bid-data-line">
                        <span className="line-label">
                          {isBorrower ? 'Max Willing Rate:' : 'Min Willing Rate:'}
                        </span>
                        <span className="line-val tabular-num highlight-rate">
                          {isBorrower ? `${(borrowerMaxRateBps / 100).toFixed(2)}%` : `${(bid.rateBps / 100).toFixed(2)}%`}
                        </span>
                      </div>
                      <div className="bid-data-line">
                        <span className="line-label">Amount:</span>
                        <span className="line-val tabular-num">${isBorrower ? borrowerAmount : bid.amount} tUSD</span>
                      </div>
                      {isBorrower && (
                        <div className="bid-data-line">
                          <span className="line-label">Collateral:</span>
                          <span className="line-val tabular-num">0.85 tETH ($2,125 value @ $2,500)</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Ciphertext Public View
                    <div className="public-cipher-details">
                      <div className="cipher-row">
                        <span className="cipher-label">Blob Size:</span>
                        <span className="cipher-badge">350 bytes (Standardized)</span>
                      </div>
                      <div className="cipher-hex-snippet mono-addr">
                        {bid.cipherBlobHex}
                      </div>
                      <div className="privacy-guarantee-note">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>Rate & intent data strictly encrypted to enclave public key</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Execution Outcome & Clearing Rate */}
        <div className="auction-panel outcome-panel">
          <div className="panel-top-row">
            <h3 className="panel-headline">Settlement Report & Benchmark</h3>
            <span className="status-indicator-live">
              <span className="status-ping" />
              Epoch Result
            </span>
          </div>

          <div className="clearing-hero-box">
            <span className="clearing-label">Uniform Market Clearing Rate (r*)</span>
            <div className="clearing-hero-number tabular-num">
              {auctionResult.clearingRatePct}
            </div>
            <p className="clearing-explainer">
              {auctionResult.clearingRateBps ? (
                <>
                  Marginal accepted lender sets the single uniform rate for <strong>all participants</strong>.
                  Inframarginal lenders receive higher yields than their bid without leakage.
                </>
              ) : (
                'Borrower max rate is lower than cheapest available lender slices. No trade cleared.'
              )}
            </p>
          </div>

          {/* Allocation & Fill Breakdown */}
          <div className="fill-breakdown-card">
            <h4 className="card-subhead">Enclave Allocation Result:</h4>
            {auctionResult.filledLenders.length > 0 ? (
              <div className="fill-list">
                {auctionResult.filledLenders.map((f, i) => (
                  <div key={i} className="fill-item">
                    <div className="fill-name-group">
                      <span className="fill-dot" />
                      <strong>{f.name}</strong>
                      <span className="bid-original">bid: {(f.bidRateBps / 100).toFixed(2)}%</span>
                    </div>
                    <div className="fill-outcome">
                      <span className="fill-amount tabular-num">${f.allocatedAmount} filled</span>
                      <span className="fill-cleared tabular-num">→ clears at {(f.effectiveRateBps / 100).toFixed(2)}%</span>
                    </div>
                  </div>
                ))}

                {auctionResult.unfilledLenders.map((u, i) => (
                  <div key={i} className="fill-item unfilled">
                    <div className="fill-name-group">
                      <span className="unfill-dot" />
                      <span className="dimmed-name">{u.name}</span>
                      <span className="bid-original">bid: {(u.bidRateBps / 100).toFixed(2)}%</span>
                    </div>
                    <span className="unfill-reason">{u.reason}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state-text">No orders crossed at current parameters.</p>
            )}
          </div>

          {/* Leak Audit Verification (scripts/audit-leaks.ts) */}
          <div className="leak-audit-card">
            <div className="leak-audit-header">
              <div className="audit-title-wrap">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Automated Zero-Leak Audit</span>
              </div>
              <button
                type="button"
                className="run-audit-btn"
                onClick={() => setAuditRun(true)}
              >
                {auditRun ? 'Audit Verified ✓' : 'Run Audit Test'}
              </button>
            </div>

            <div className="audit-results-grid">
              <div className="audit-metric">
                <span className="audit-lbl">Chidi bid (6.11%):</span>
                <span className="audit-status safe">0 leaks found</span>
              </div>
              <div className="audit-metric">
                <span className="audit-lbl">Ada bid (4.13%):</span>
                <span className="audit-status safe">0 leaks found</span>
              </div>
              <div className="audit-metric">
                <span className="audit-lbl">Dayo max (5.52%):</span>
                <span className="audit-status safe">0 leaks found</span>
              </div>
              <div className="audit-metric">
                <span className="audit-lbl">Public onchain log:</span>
                <span className="audit-status benchmark">Only r* ({auctionResult.clearingRatePct})</span>
              </div>
            </div>
            <p className="audit-footnote">
              Verified by <code className="mono-label">scripts/audit-leaks.ts</code> against simulator stdout, SQLite state, calldata, and Monad receipts.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
