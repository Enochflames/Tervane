import React, { useState, useMemo } from 'react'
import { CREDIT_TIERS, TENORS, CreditTier, TenorInfo } from '../types'
import {
  calculateTermInterest,
  calculateCollateralValue,
  calculateLiquidationBreakdown,
} from '../utils/protocolMath'

export const CreditCalculator: React.FC = () => {
  const [selectedTier, setSelectedTier] = useState<CreditTier>(CREDIT_TIERS[0]) // Bronze default
  const [selectedTenor, setSelectedTenor] = useState<TenorInfo>(TENORS[2]) // DEMO-10m
  const [borrowPrincipal, setBorrowPrincipal] = useState<number>(1000)
  const [rateBps, setRateBps] = useState<number>(527) // 5.27%
  const [collateralEth, setCollateralEth] = useState<number>(0.85)
  const [ethPriceUsd, setEthPriceUsd] = useState<number>(2500) // $2,500 normal vs $1,800 crash

  // Calculate interest and owed
  const interestResult = useMemo(() => {
    return calculateTermInterest(borrowPrincipal, rateBps, selectedTenor.seconds)
  }, [borrowPrincipal, rateBps, selectedTenor])

  // Collateral value
  const collValueUsd = useMemo(() => {
    return calculateCollateralValue(collateralEth, ethPriceUsd)
  }, [collateralEth, ethPriceUsd])

  // Ratios
  const currentCollRatioBps = useMemo(() => {
    if (borrowPrincipal === 0) return 0
    return Math.round((collValueUsd / borrowPrincipal) * 10_000)
  }, [collValueUsd, borrowPrincipal])

  const requiredOpenCollateralUsd = (borrowPrincipal * selectedTier.openRatioBps) / 10_000
  const liquidationThresholdUsd = (interestResult.owedUsd * selectedTier.liqRatioBps) / 10_000
  const isHealthy = collValueUsd >= liquidationThresholdUsd
  const isOpenRatioMet = collValueUsd >= requiredOpenCollateralUsd

  // Liquidation breakdown if underwater
  const liquidationBreakdown = useMemo(() => {
    return calculateLiquidationBreakdown(interestResult.owedUsd, collateralEth, ethPriceUsd, [
      { name: 'Ada (60% share)', shareRatio: 0.6 },
      { name: 'Bola (40% share)', shareRatio: 0.4 },
    ])
  }, [interestResult, collateralEth, ethPriceUsd])

  return (
    <section id="calculator" className="calculator-section">
      <div className="section-header">
        <div className="section-pill">Risk & Term Math</div>
        <h2 className="section-title">
          Credit Tiers & Liquidation Math Simulator
        </h2>
        <p className="section-subtitle">
          Tervane prices credit with simple fixed-rate interest and capital-efficient tiers.
          Test loan health at normal $2,500 ETH or trigger the <code className="inline-code">DEMO-SCRIPT</code> $1,800 oracle crash.
        </p>
      </div>

      <div className="calc-main-container">
        {/* Left Form: Inputs & Tiers */}
        <div className="calc-inputs-panel">
          <div className="input-group">
            <span className="input-label-tag">Borrower Credit Tier:</span>
            <div className="tier-selector-grid">
              {CREDIT_TIERS.map((tier) => (
                <button
                  key={tier.tier}
                  type="button"
                  className={`tier-btn ${selectedTier.tier === tier.tier ? 'active' : ''}`}
                  onClick={() => setSelectedTier(tier)}
                  style={{
                    borderColor: selectedTier.tier === tier.tier ? tier.badgeColor : undefined,
                  }}
                >
                  <span className="tier-btn-name" style={{ color: tier.badgeColor }}>
                    {tier.name}
                  </span>
                  <span className="tier-btn-ratio">{(tier.openRatioBps / 100)}% Collateral</span>
                  <span className="tier-btn-liq">Liq: {(tier.liqRatioBps / 100)}%</span>
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <span className="input-label-tag">Tenor Duration:</span>
            <div className="tenor-calc-grid">
              {TENORS.map((tenor) => (
                <button
                  key={tenor.id}
                  type="button"
                  className={`tenor-calc-btn ${selectedTenor.id === tenor.id ? 'active' : ''}`}
                  onClick={() => setSelectedTenor(tenor)}
                >
                  <strong>{tenor.label}</strong>
                  <span>{(tenor.seconds / 86400).toFixed(1)}d</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="field-slider-box">
            <div className="slider-row-header">
              <span>Principal Amount:</span>
              <span className="slider-readout tabular-num">${borrowPrincipal} tUSD</span>
            </div>
            <input
              type="range"
              min="200"
              max="2000"
              step="50"
              value={borrowPrincipal}
              onChange={(e) => setBorrowPrincipal(Number(e.target.value))}
              className="range-input"
            />
          </div>

          <div className="field-slider-box">
            <div className="slider-row-header">
              <span>Fixed Rate (APR):</span>
              <span className="slider-readout tabular-num">{(rateBps / 100).toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="300"
              max="900"
              step="10"
              value={rateBps}
              onChange={(e) => setRateBps(Number(e.target.value))}
              className="range-input"
            />
          </div>

          <div className="field-slider-box">
            <div className="slider-row-header">
              <span>Deposited Collateral:</span>
              <span className="slider-readout tabular-num">{collateralEth} tETH</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="2.0"
              step="0.05"
              value={collateralEth}
              onChange={(e) => setCollateralEth(Number(e.target.value))}
              className="range-input"
            />
          </div>

          {/* Oracle Crash Simulator Trigger */}
          <div className="oracle-stress-test-box">
            <span className="oracle-box-label">Chainlink Oracle ETH/USD Feed Simulation:</span>
            <div className="oracle-toggle-group">
              <button
                type="button"
                className={`oracle-btn ${ethPriceUsd === 2500 ? 'active normal' : ''}`}
                onClick={() => setEthPriceUsd(2500)}
              >
                <span>Normal Market: $2,500</span>
                <span className="oracle-sub-tag">Round #1 (Healthy)</span>
              </button>
              <button
                type="button"
                className={`oracle-btn ${ethPriceUsd === 1800 ? 'active crash' : ''}`}
                onClick={() => setEthPriceUsd(1800)}
              >
                <span>Demo Crash: $1,800</span>
                <span className="oracle-sub-tag">Round #2 (Liquidatable)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Output: Real-Time Position Telemetry */}
        <div className="calc-results-panel">
          <div className="results-top-header">
            <div>
              <span className="subhead-small">Position Risk Assessment</span>
              <h3 className="results-headline">Health & Liquidation Output</h3>
            </div>
            <span className={`health-status-badge ${isHealthy ? 'healthy' : 'liquidatable'}`}>
              <span className="health-dot" />
              {isHealthy ? 'Healthy Loan' : 'Liquidatable'}
            </span>
          </div>

          {/* Core Numbers Grid */}
          <div className="results-numbers-grid">
            <div className="res-stat-card">
              <span className="res-lbl">Collateral Value</span>
              <span className="res-num tabular-num">${collValueUsd.toFixed(2)}</span>
              <span className="res-note">Current @ ${ethPriceUsd}/ETH</span>
            </div>

            <div className="res-stat-card">
              <span className="res-lbl">Total Owed at Maturity</span>
              <span className="res-num tabular-num">${interestResult.owedUsd.toFixed(4)}</span>
              <span className="res-note">Principal + ${interestResult.interestUsd.toFixed(4)} int.</span>
            </div>

            <div className="res-stat-card">
              <span className="res-lbl">Current Collateral Ratio</span>
              <span className={`res-num tabular-num ${isOpenRatioMet ? 'good' : 'warning'}`}>
                {(currentCollRatioBps / 100).toFixed(1)}%
              </span>
              <span className="res-note">Min Required: {(selectedTier.openRatioBps / 100)}%</span>
            </div>

            <div className="res-stat-card">
              <span className="res-lbl">Liquidation Trigger Price</span>
              <span className="res-num tabular-num">
                ${((interestResult.owedUsd * selectedTier.liqRatioBps) / (10_000 * collateralEth)).toFixed(2)}
              </span>
              <span className="res-note">Threshold: {(selectedTier.liqRatioBps / 100)}%</span>
            </div>
          </div>

          {/* Liquidation Breakdown Card (when underwater or tested) */}
          {!isHealthy && (
            <div className="liquidation-settlement-card">
              <div className="liq-banner">
                <span className="liq-alert-icon">⚠️</span>
                <strong>Protocol Seizure Active (docs/PROTOCOL-SPEC.md §10.4)</strong>
              </div>
              <div className="liq-math-rows">
                <div className="liq-row">
                  <span>Collateral Seized (Owed × 1.10 max):</span>
                  <span className="mono-addr tabular-num">{liquidationBreakdown.seizedEth.toFixed(6)} tETH</span>
                </div>
                <div className="liq-row">
                  <span>Treasury Fee (5% of seized):</span>
                  <span className="mono-addr tabular-num">{liquidationBreakdown.treasuryFeeEth.toFixed(6)} tETH</span>
                </div>
                <div className="liq-row">
                  <span>Lender Recovery Pot (Distributed Pro Rata):</span>
                  <span className="mono-addr tabular-num">{liquidationBreakdown.potEth.toFixed(6)} tETH</span>
                </div>
                <div className="liq-row refund-row">
                  <span>Borrower Refund (Returned to borrower):</span>
                  <span className="mono-addr tabular-num highlight-refund">
                    {liquidationBreakdown.borrowerRefundEth.toFixed(6)} tETH
                  </span>
                </div>
              </div>
              <p className="liq-guarantee-note">
                Borrower keeps the ${borrowPrincipal} tUSD principal. Debt is permanently extinguished. No socialization beyond the loan.
              </p>
            </div>
          )}

          {/* Credit Proof / Selective Disclosure Feature */}
          <div className="credit-proof-feature">
            <div className="proof-header-wrap">
              <div className="proof-icon-box">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <h4 className="proof-title">Onchain Credit Proof (Selective Disclosure)</h4>
                <p className="proof-sub">
                  Call <code className="inline-code">verifyAccount(Account a, bytes32[] proof)</code> on Monad to prove your {selectedTier.name} tier without disclosing transaction history or counterparties.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
