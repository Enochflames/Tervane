import React, { useState, useEffect } from 'react'

interface HeaderProps {
  onOpenApp: (screen?: string) => void
  activeSection?: string
}

export const Header: React.FC<HeaderProps> = ({ onOpenApp }) => {
  const [epoch, setEpoch] = useState(84)
  const [secondsLeft, setSecondsLeft] = useState(28)
  const [copiedContract, setCopiedContract] = useState(false)

  // 30s heartbeat timer mirroring the Chainlink CRE cron
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setEpoch((e) => e + 1)
          return 30
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleCopyContract = () => {
    navigator.clipboard.writeText('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
    setCopiedContract(true)
    setTimeout(() => setCopiedContract(false), 2000)
  }

  return (
    <header className="topbar-container">
      <div className="topbar-inner">
        {/* Brand */}
        <div className="brand-group">
          <a href="#top" className="brand-link" aria-label="Tervane Home">
            <div className="brand-logo-symbol">
              <span className="brand-glyph">T</span>
              <span className="brand-glow" />
            </div>
            <div className="brand-text">
              <span className="brand-name">Tervane</span>
              <span className="brand-tagline">Confidential Fixed-Rate Credit</span>
            </div>
          </a>

          {/* Network & Sequencer Status */}
          <div className="status-badges" aria-label="Network Status">
            <span className="network-pill" title="Target: Monad Testnet (Chain ID 10143)">
              <span className="pulse-dot monad" />
              <span>Monad Testnet</span>
            </span>

            <div className="enclave-pill" title="Chainlink CRE Confidential Workflow settling every 30s">
              <span className="pulse-dot cre" />
              <span className="enclave-label">CRE Settle:</span>
              <span className="tabular-num">Epoch #{epoch}</span>
              <span className="heartbeat-timer">({secondsLeft}s)</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="desktop-nav" aria-label="Primary Navigation">
          <a href="#auction-engine" className="nav-item">Call Auction</a>
          <a href="#cryptography" className="nav-item">350-byte ECIES</a>
          <a href="#calculator" className="nav-item">Term & Tiers</a>
          <a href="#architecture" className="nav-item">Settler Loop</a>
          <a href="#threat-model" className="nav-item">Threat Model</a>
        </nav>

        {/* Action Controls */}
        <div className="header-actions">
          <button
            type="button"
            className="contract-pill-btn"
            onClick={handleCopyContract}
            title="Click to copy TervaneCore contract address"
          >
            <span className="mono-addr">0x742d...f44e</span>
            <span className="copy-state">{copiedContract ? 'Copied!' : 'Copy Core'}</span>
          </button>

          <button
            type="button"
            className="launch-app-btn"
            onClick={() => onOpenApp('market')}
            aria-label="Launch Tervane Testnet App"
          >
            <span>Launch App</span>
            <svg
              className="arrow-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
