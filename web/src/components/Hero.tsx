import React, { useState } from 'react'
import { TENORS, TenorInfo } from '../types'

interface HeroProps {
  onOpenApp: (screen?: string) => void
  onJumpToAuction: () => void
}

export const Hero: React.FC<HeroProps> = ({ onOpenApp, onJumpToAuction }) => {
  const [selectedTenor, setSelectedTenor] = useState<TenorInfo>(TENORS[1]) // 30d default

  return (
    <section className="hero-section">
      <div className="hero-content">
        {/* Track 01 & Hackathon Eyebrow */}
        <div className="eyebrow-container">
          <span className="eyebrow-chip">Monad Metropolis • Track 01</span>
          <span className="eyebrow-separator">/</span>
          <span className="eyebrow-sub">Chainlink CRE Confidential Workflows</span>
        </div>

        {/* Primary Headline */}
        <h1 className="hero-title">
          Private bids.{' '}
          <span className="headline-gradient">Public benchmarks.</span>{' '}
          Zero cost-of-capital leak.
        </h1>

        {/* Technical Sub-headline adhering to THREAT-MODEL §5 */}
        <p className="hero-description">
          Tervane is a validium-style lending market on <strong>Monad</strong> where lenders and borrowers
          submit <strong>fully encrypted intents</strong>. Every 30 seconds, a <strong>Chainlink CRE enclave</strong> decrypts
          orders inside a TEE, runs a uniform-price call auction per tenor, and commits one signed Merkle root
          to <code className="inline-code">TervaneCore</code>.
        </p>

        {/* Action Triggers with Emil Kowalski scale(0.97) micro-interactions */}
        <div className="hero-button-row">
          <button
            type="button"
            className="hero-primary-btn"
            onClick={() => onOpenApp('lend')}
          >
            <span>Submit Encrypted Intent</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          <button
            type="button"
            className="hero-secondary-btn"
            onClick={onJumpToAuction}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Interactive Auction Demo</span>
          </button>

          <button
            type="button"
            className="hero-ghost-btn"
            onClick={() => onOpenApp('escape')}
          >
            <span>Escape Hatch Mode</span>
          </button>
        </div>

        {/* Protocol Trust Guarantees */}
        <div className="trust-strip">
          <div className="trust-item">
            <span className="trust-icon-dot" />
            <span>Rates visible <strong>only to you & the enclave</strong></span>
          </div>
          <div className="trust-item">
            <span className="trust-icon-dot" />
            <span>Onchain accumulator prevents dropped intents</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon-dot" />
            <span>Merkle proof exit if settlement ever halts</span>
          </div>
        </div>
      </div>

      {/* Live Benchmark & Telemetry Card */}
      <div className="hero-telemetry-panel">
        <div className="telemetry-inner-card">
          {/* Card Header with Tenor Selector */}
          <div className="telemetry-top">
            <div>
              <span className="metric-eyebrow">Clearing Benchmark</span>
              <h2 className="telemetry-title">Uniform Call Auction</h2>
            </div>
            <div className="tenor-segmented-control" role="tablist" aria-label="Select Tenor">
              {TENORS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedTenor.id === t.id}
                  className={`tenor-tab-btn ${selectedTenor.id === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedTenor(t)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Rate Display */}
          <div className="rate-hero-display">
            <div className="rate-number-wrap">
              <span className="rate-value tabular-num">
                {(selectedTenor.defaultRateBps / 100).toFixed(2)}%
              </span>
              <span className="rate-term-badge">Fixed APR</span>
            </div>
            <span className="clearing-badge">
              <span className="clearing-status-dot" />
              Settled Uniform Price
            </span>
          </div>

          <p className="tenor-context-caption">
            {selectedTenor.description} • Term duration: <code className="mono-label">{(selectedTenor.seconds / 86400).toFixed(1)} days</code>
          </p>

          {/* Real Protocol Telemetry Grid */}
          <div className="telemetry-data-grid">
            <div className="telemetry-stat-cell">
              <span className="stat-label">Last Settle Block</span>
              <span className="stat-val tabular-num">#1,492,801</span>
              <span className="stat-sub">Monad Testnet</span>
            </div>

            <div className="telemetry-stat-cell">
              <span className="stat-label">Committed State Root</span>
              <span className="stat-val mono-addr" title="0x3e18a49c91028471bade02938471bade02938471">
                0x3e18...bade
              </span>
              <span className="stat-sub">OZ Commutative Merkle</span>
            </div>

            <div className="telemetry-stat-cell">
              <span className="stat-label">Chainlink ETH Feed</span>
              <span className="stat-val tabular-num">$2,500.00</span>
              <span className="stat-sub">Round #1 • Fresh</span>
            </div>

            <div className="telemetry-stat-cell">
              <span className="stat-label">Inbox Cursor</span>
              <span className="stat-val tabular-num">#12 / 12</span>
              <span className="stat-sub">0 Pending • 100% Ingest</span>
            </div>
          </div>

          {/* Quick Simulation Bar */}
          <div className="telemetry-footer-bar">
            <div className="telemetry-heartbeat-note">
              <span className="ping-beacon" />
              <span>Next CRE settlement trigger in <strong>~12s</strong></span>
            </div>
            <button
              type="button"
              className="quick-explore-btn"
              onClick={onJumpToAuction}
            >
              Inspect Bids
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
