import React, { useState } from 'react'
import { TENORS, CREDIT_TIERS } from '../types'

interface AppModalProps {
  isOpen: boolean
  onClose: () => void
  initialScreen?: string
}

type ScreenType = 'market' | 'wallet' | 'lend' | 'borrow' | 'positions' | 'credit' | 'escape'

export const AppModal: React.FC<AppModalProps> = ({ isOpen, onClose, initialScreen = 'market' }) => {
  const [activeScreen, setActiveScreen] = useState<ScreenType>((initialScreen as ScreenType) || 'market')

  // Wallet / balance state
  const [usdFree, setUsdFree] = useState(1200)
  const [usdReserved, setUsdReserved] = useState(600)
  const [ethFree, setEthFree] = useState(2.5)
  const [ethLocked, setEthLocked] = useState(0.85)

  // Faucet notifications
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null)

  // Lend form
  const [lendTenor, setLendTenor] = useState(1) // 30d
  const [lendAmount, setLendAmount] = useState('500')
  const [lendMinRate, setLendMinRate] = useState('5.10')
  const [submittedLendIntents, setSubmittedLendIntents] = useState<
    { id: string; tenor: string; amount: number; rate: number; storedLocally: boolean }[]
  >([
    { id: 'intent-01', tenor: '30d', amount: 600, rate: 5.27, storedLocally: true },
  ])

  // Borrow form
  const [borrowTenor, setBorrowTenor] = useState(0) // 7d
  const [borrowAmount, setBorrowAmount] = useState('1000')
  const [borrowMaxRate, setBorrowMaxRate] = useState('5.60')
  const [borrowCollateral, setBorrowCollateral] = useState('0.80')

  // Credit proof status
  const [proofVerified, setProofVerified] = useState(false)
  const [isVerifyingProof, setIsVerifyingProof] = useState(false)

  // Escape hatch state
  const [escapeTriggered, setEscapeTriggered] = useState(false)

  if (!isOpen) return null

  const handleFaucet = (asset: 'tUSD' | 'tETH') => {
    if (asset === 'tUSD') {
      setUsdFree((prev) => prev + 1000)
      setFaucetMsg('Minted 1,000 tUSD from Testnet Faucet')
    } else {
      setEthFree((prev) => prev + 1.0)
      setFaucetMsg('Minted 1.0 tETH from Testnet Faucet')
    }
    setTimeout(() => setFaucetMsg(null), 3000)
  }

  const handleSubmitLend = (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(lendAmount) || 0
    const rt = parseFloat(lendMinRate) || 0
    if (amt <= 0 || amt > usdFree) return

    setUsdFree((prev) => prev - amt)
    setUsdReserved((prev) => prev + amt)
    setSubmittedLendIntents((prev) => [
      {
        id: `intent-0${prev.length + 2}`,
        tenor: TENORS[lendTenor].label,
        amount: amt,
        rate: rt,
        storedLocally: true,
      },
      ...prev,
    ])
    setFaucetMsg(`Encrypted & Submitted: LEND $${amt} @ min ${rt}% (Stored in localStorage only)`)
    setTimeout(() => setFaucetMsg(null), 4000)
  }

  const handleVerifyTierProof = () => {
    setIsVerifyingProof(true)
    setTimeout(() => {
      setIsVerifyingProof(false)
      setProofVerified(true)
    }, 1200)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="app-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* App Topbar */}
        <div className="app-topbar">
          <div className="app-header-left">
            <div className="app-symbol">T</div>
            <div>
              <span className="app-title">Tervane Protocol Console</span>
              <span className="app-net-pill">Monad Testnet • 10143</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="app-nav-tabs">
            {(['market', 'wallet', 'lend', 'borrow', 'positions', 'credit', 'escape'] as ScreenType[]).map((scr) => (
              <button
                key={scr}
                type="button"
                className={`app-tab-btn ${activeScreen === scr ? 'active' : ''}`}
                onClick={() => setActiveScreen(scr)}
              >
                {scr.toUpperCase()}
              </button>
            ))}
          </nav>

          <button type="button" className="close-modal-btn" onClick={onClose} aria-label="Close Console">
            ✕
          </button>
        </div>

        {/* Feedback Alert Toast */}
        {faucetMsg && (
          <div className="app-toast-alert">
            <span className="toast-dot" />
            <span>{faucetMsg}</span>
          </div>
        )}

        {/* Screen Contents */}
        <div className="app-screen-body">
          {/* SCREEN 1: MARKET */}
          {activeScreen === 'market' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Live Fixed-Rate Call Auction Benchmarks</h3>
                <p>Settled every 30s by Chainlink CRE enclave. Only clearing rates are public; order book is sealed.</p>
              </div>

              <div className="market-cards-row">
                {TENORS.map((t) => (
                  <div key={t.id} className="market-tenor-card">
                    <div className="tenor-card-head">
                      <span className="tenor-duration-badge">{t.label}</span>
                      <span className="tenor-sec-tag">{(t.seconds / 86400).toFixed(1)}d</span>
                    </div>
                    <div className="clearing-stat-big tabular-num">
                      {(t.defaultRateBps / 100).toFixed(2)}%
                    </div>
                    <span className="rate-subtext">Uniform Clearing APR</span>

                    <div className="tenor-sub-stats">
                      <div className="sub-stat">
                        <span>24h Cleared:</span>
                        <strong>$3.4M tUSD</strong>
                      </div>
                      <div className="sub-stat">
                        <span>Last Settle:</span>
                        <strong>18s ago</strong>
                      </div>
                    </div>

                    <div className="tenor-action-split">
                      <button
                        type="button"
                        className="tenor-btn lend"
                        onClick={() => {
                          setLendTenor(t.id)
                          setActiveScreen('lend')
                        }}
                      >
                        Lend
                      </button>
                      <button
                        type="button"
                        className="tenor-btn borrow"
                        onClick={() => {
                          setBorrowTenor(t.id)
                          setActiveScreen('borrow')
                        }}
                      >
                        Borrow
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="market-notice-card">
                <strong>💡 Market Design Property:</strong> Inframarginal lenders never leak their reservation prices.
                Ada bid 4.13%, but received 5.27% along with Bola. Unmatched bids (like Chidi at 6.11%) never appear in
                calldata, logs, or reports.
              </div>
            </div>
          )}

          {/* SCREEN 2: WALLET */}
          {activeScreen === 'wallet' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Account Ledger Balances & Testnet Faucet</h3>
                <p>Balances held in TervaneCore on Monad. Offchain state store indexes movements committed via Merkle root.</p>
              </div>

              <div className="wallet-balances-grid">
                <div className="balance-tile">
                  <span className="balance-token-name">tUSD (Lending Asset)</span>
                  <div className="balance-split-row">
                    <div>
                      <span className="tile-lbl">Free Balance:</span>
                      <strong className="tile-amt tabular-num">${usdFree.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="tile-lbl">Reserved in Bids:</span>
                      <strong className="tile-amt dim tabular-num">${usdReserved.toLocaleString()}</strong>
                    </div>
                  </div>
                  <button type="button" className="faucet-mint-btn" onClick={() => handleFaucet('tUSD')}>
                    + Faucet 1,000 tUSD
                  </button>
                </div>

                <div className="balance-tile">
                  <span className="balance-token-name">tETH (Collateral Asset)</span>
                  <div className="balance-split-row">
                    <div>
                      <span className="tile-lbl">Free Balance:</span>
                      <strong className="tile-amt tabular-num">{ethFree.toFixed(2)} tETH</strong>
                    </div>
                    <div>
                      <span className="tile-lbl">Locked in Loans:</span>
                      <strong className="tile-amt dim tabular-num">{ethLocked.toFixed(2)} tETH</strong>
                    </div>
                  </div>
                  <button type="button" className="faucet-mint-btn" onClick={() => handleFaucet('tETH')}>
                    + Faucet 1.0 tETH
                  </button>
                </div>
              </div>

              <div className="onchain-ledger-info">
                <h4>Verified Validium Accounting</h4>
                <p>
                  Withdrawals are requested onchain via <code className="inline-code">requestWithdraw(asset, amount)</code>.
                  The next enclave report processes up to 32 payouts and transfers tokens directly to your EOA.
                </p>
              </div>
            </div>
          )}

          {/* SCREEN 3: LEND */}
          {activeScreen === 'lend' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Submit Encrypted Lend Intent</h3>
                <p>
                  Your minimum acceptable rate is encrypted in your browser with ECIES and sent as an opaque 350-byte blob.
                  It will be stored locally on your machine only.
                </p>
              </div>

              <div className="trade-split-layout">
                <form className="order-form-card" onSubmit={handleSubmitLend}>
                  <div className="form-group">
                    <label>Tenor:</label>
                    <select
                      value={lendTenor}
                      onChange={(e) => setLendTenor(Number(e.target.value))}
                      className="form-select"
                    >
                      {TENORS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label} (Current Clearing: {(t.defaultRateBps / 100).toFixed(2)}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Amount to Lend (tUSD):</label>
                    <input
                      type="number"
                      value={lendAmount}
                      onChange={(e) => setLendAmount(e.target.value)}
                      className="form-input tabular-num"
                      max={usdFree}
                      min="50"
                    />
                    <span className="input-hint">Available Free Balance: ${usdFree.toLocaleString()} tUSD</span>
                  </div>

                  <div className="form-group">
                    <label>Minimum Acceptable APR (%):</label>
                    <input
                      type="number"
                      step="0.05"
                      value={lendMinRate}
                      onChange={(e) => setLendMinRate(e.target.value)}
                      className="form-input tabular-num"
                    />
                    <span className="input-hint">
                      Enclave matches you at uniform r* &ge; this minimum. Never fills lower.
                    </span>
                  </div>

                  <div className="form-crypto-preview">
                    <span>Client ECIES Cipher Output:</span>
                    <code className="mono-addr">0x018b209e4a...[350 bytes AES-256-GCM]</code>
                  </div>

                  <button type="submit" className="submit-intent-btn">
                    Encrypt & Submit Intent to Monad
                  </button>
                </form>

                {/* Local Storage Saved Bids */}
                <div className="local-memory-panel">
                  <h4>My Submitted Bids (Local Client Storage Only)</h4>
                  <p className="privacy-caveat">
                    Per <code className="inline-code">docs/CLIENT.md §3</code>, your bid rates are stored strictly in your browser.
                    The server does not know and cannot serve them.
                  </p>

                  <div className="saved-bids-list">
                    {submittedLendIntents.map((intent) => (
                      <div key={intent.id} className="saved-bid-item">
                        <div className="bid-title-line">
                          <strong>{intent.tenor} Term</strong>
                          <span className="local-shield-badge">Device Local</span>
                        </div>
                        <div className="bid-metrics-line">
                          <span>Amount: ${intent.amount} tUSD</span>
                          <span className="local-rate-tag">My Bid: {intent.rate}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 4: BORROW */}
          {activeScreen === 'borrow' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Submit Encrypted Borrow Intent</h3>
                <p>
                  Borrow against locked tETH at fixed simple interest. Your max rate and intent payload are sealed inside the 350-byte ECIES blob.
                </p>
              </div>

              <div className="trade-split-layout">
                <form
                  className="order-form-card"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setFaucetMsg('Borrow Intent Encrypted and Submitted to Monad Inbox!')
                    setTimeout(() => setFaucetMsg(null), 3000)
                  }}
                >
                  <div className="form-group">
                    <label>Tenor:</label>
                    <select
                      value={borrowTenor}
                      onChange={(e) => setBorrowTenor(Number(e.target.value))}
                      className="form-select"
                    >
                      {TENORS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Borrow Principal (tUSD):</label>
                    <input
                      type="number"
                      value={borrowAmount}
                      onChange={(e) => setBorrowAmount(e.target.value)}
                      className="form-input tabular-num"
                    />
                  </div>

                  <div className="form-group">
                    <label>Maximum Willing APR (%):</label>
                    <input
                      type="number"
                      step="0.05"
                      value={borrowMaxRate}
                      onChange={(e) => setBorrowMaxRate(e.target.value)}
                      className="form-input tabular-num"
                    />
                  </div>

                  <div className="form-group">
                    <label>Collateral to Reserve (tETH):</label>
                    <input
                      type="number"
                      step="0.05"
                      value={borrowCollateral}
                      onChange={(e) => setBorrowCollateral(e.target.value)}
                      className="form-input tabular-num"
                    />
                    <span className="input-hint">
                      Collateral Value: ${(parseFloat(borrowCollateral) * 2500 || 0).toFixed(2)} USD (
                      {(((parseFloat(borrowCollateral) * 2500) / (parseFloat(borrowAmount) || 1)) * 100).toFixed(0)}% ratio)
                    </span>
                  </div>

                  <button type="submit" className="submit-intent-btn">
                    Encrypt & Submit Borrow to Inbox
                  </button>
                </form>

                <div className="local-memory-panel">
                  <h4>Collateral Requirement Checklist</h4>
                  <ul className="borrow-req-list">
                    <li>✓ Bronze tier requires 200% initial collateral ratio ($2,000 value per $1,000 principal).</li>
                    <li>✓ Simple term loan interest: fixed for full duration, no variable spikes.</li>
                    <li>✓ No liquidation if price stays above 160% liquidation threshold.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 5: POSITIONS */}
          {activeScreen === 'positions' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>My Active Loan & Lending Positions</h3>
                <p>Term loans tracked offchain by the CRE enclave and committed to Monad via Merkle state root.</p>
              </div>

              <div className="positions-container">
                <div className="position-card">
                  <div className="pos-card-head">
                    <div className="pos-badge-group">
                      <span className="pos-type borrower">BORROWER</span>
                      <strong>Loan #1084 (30d Term)</strong>
                    </div>
                    <span className="pos-health-badge good">Health: 1.48x</span>
                  </div>

                  <div className="pos-data-grid">
                    <div className="p-stat">
                      <span>Principal:</span>
                      <strong>$1,000.00 tUSD</strong>
                    </div>
                    <div className="p-stat">
                      <span>Owed at Maturity:</span>
                      <strong>$1,004.33 tUSD</strong>
                    </div>
                    <div className="p-stat">
                      <span>Locked Collateral:</span>
                      <strong>0.85 tETH ($2,125 @ $2,500)</strong>
                    </div>
                    <div className="p-stat">
                      <span>Clearing Rate:</span>
                      <strong>5.27% Fixed APR</strong>
                    </div>
                  </div>

                  <div className="pos-actions">
                    <button
                      type="button"
                      className="repay-btn"
                      onClick={() => {
                        setFaucetMsg('Repay Intent Encrypted and Submitted to Inbox!')
                        setTimeout(() => setFaucetMsg(null), 3000)
                      }}
                    >
                      Repay Loan ($1,004.33 tUSD)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 6: CREDIT PROOF */}
          {activeScreen === 'credit' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Selective Disclosure Credit Attestation</h3>
                <p>
                  Prove your credit tier and repaid volume onchain without disclosing your previous loans,
                  rates, or counter-parties.
                </p>
              </div>

              <div className="credit-proof-box">
                <div className="tier-display-large">
                  <span className="tier-crown">👑</span>
                  <div>
                    <h4 className="tier-big-name">Silver Credit Tier</h4>
                    <span className="tier-repaid-stat">Repaid Volume: $3,500 tUSD</span>
                  </div>
                </div>

                <div className="proof-verification-area">
                  <button
                    type="button"
                    className="verify-onchain-btn"
                    onClick={handleVerifyTierProof}
                    disabled={isVerifyingProof}
                  >
                    {isVerifyingProof ? 'Evaluating Merkle Proof...' : 'Prove My Tier Onchain'}
                  </button>

                  {proofVerified && (
                    <div className="proof-success-banner">
                      <span className="check-icon">✓</span>
                      <div>
                        <strong>TervaneCore.verifyAccount(Account, proof) returned TRUE!</strong>
                        <p>Verified against stateRoot <code className="mono-addr">0x3e18...bade</code>. Zero leaks of order details.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 7: ESCAPE HATCH */}
          {activeScreen === 'escape' && (
            <div className="screen-content">
              <div className="screen-header-block">
                <h3>Validium Escape Hatch Exit</h3>
                <p>
                  If CRE stops settling for &gt; 24 hours (or 10 minutes in demo mode), any user can activate the escape hatch
                  and withdraw funds directly against the last committed Merkle root.
                </p>
              </div>

              <div className="escape-console-card">
                <div className="escape-status-row">
                  <span>Enclave Settlement Status:</span>
                  <span className="escape-status-chip normal">Active (Settling every 30s)</span>
                </div>

                <p className="escape-info-text">
                  In production, after <code className="inline-code">ESCAPE_DELAY = 86,400s</code> of silence,
                  calling <code className="inline-code">activateEscape()</code> permanently halts CRE authority and enables
                  Merkle proof exits for all accounts and open loans.
                </p>

                <div className="escape-actions-row">
                  <button
                    type="button"
                    className="simulate-escape-btn"
                    onClick={() => setEscapeTriggered(true)}
                  >
                    Simulate Sequencer Halt & Test Exit Proof
                  </button>
                </div>

                {escapeTriggered && (
                  <div className="escape-triggered-box">
                    <h4>Escape Mode Active!</h4>
                    <p>Generating Merkle branch proof for address <code className="mono-addr">0x742d...4f12</code>:</p>
                    <code className="merkle-proof-code">
                      proof = [0x92f...a1, 0x88c...42, 0x11e...90] → MerkleProof.verify(proof, stateRoot, leaf)
                    </code>
                    <button
                      type="button"
                      className="exit-account-btn"
                      onClick={() => {
                        setFaucetMsg('Exit Account executed on Monad! Funds returned to EOA.')
                        setUsdFree((p) => p + usdReserved)
                        setUsdReserved(0)
                        setTimeout(() => setFaucetMsg(null), 3000)
                      }}
                    >
                      Execute exitAccount() with Cached Proof
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
