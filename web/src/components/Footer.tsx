import React from 'react'

export const Footer: React.FC = () => {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top-grid">
          {/* Brand & Ethos */}
          <div className="footer-brand-col">
            <div className="brand-group">
              <div className="brand-logo-symbol">
                <span className="brand-glyph">T</span>
              </div>
              <span className="brand-name">Tervane</span>
            </div>
            <p className="footer-mission">
              A private fixed-rate lending market on <strong>Monad</strong>, settled by a <strong>Chainlink CRE Confidential Workflow</strong>.
              Sealed-bid call auctions clear each tenor without ever revealing losing bids or lenders&apos; reservation prices.
            </p>
            <div className="target-tracks-badge">
              <span>Monad Metropolis • Track 01</span>
              <span>Chainlink CRE Bounty</span>
            </div>
          </div>

          {/* Docs Links */}
          <div className="footer-links-col">
            <h4 className="footer-heading">Protocol Specs</h4>
            <ul className="footer-nav-list">
              <li>
                <a href="#auction-engine">Uniform Call Auction (§8)</a>
              </li>
              <li>
                <a href="#cryptography">ECIES 350-byte Envelopes (§6)</a>
              </li>
              <li>
                <a href="#calculator">Credit Tiers & Liquidation (§10)</a>
              </li>
              <li>
                <a href="#architecture">CRE Settler Workflow Loop</a>
              </li>
              <li>
                <a href="#threat-model">Threat Model & Limits</a>
              </li>
            </ul>
          </div>

          {/* Testnet & Contracts */}
          <div className="footer-links-col">
            <h4 className="footer-heading">Deployments (10143)</h4>
            <ul className="footer-nav-list">
              <li>
                <span className="mono-sub-link">TervaneCore.sol</span>
              </li>
              <li>
                <span className="mono-sub-link">KeystoneForwarder</span>
              </li>
              <li>
                <span className="mono-sub-link">MockV3Aggregator</span>
              </li>
              <li>
                <span className="mono-sub-link">TestTokens (tUSD, tETH)</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Required Threat Model Disclosure */}
        <div className="footer-bottom-bar">
          <p className="threat-disclosure-text">
            <strong>Security Boundary Notice (docs/THREAT-MODEL.md §5):</strong> Rates are visible only to you and a Chainlink CRE enclave during execution. The public chain verifies Merkle roots, inbox hash chains, and clearing rates, but never observes individual bids. Positions are hidden from the public chain; if settlement ever halts, an onchain escape hatch enables fund recovery via Merkle proof.
          </p>
          <div className="footer-copy-line">
            <span>© {new Date().getFullYear()} Tervane Protocol. Designed with Emil Kowalski engineering craftsmanship.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
