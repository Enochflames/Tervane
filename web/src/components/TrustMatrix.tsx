import React, { useState } from 'react'

interface ThreatRow {
  dataItem: string
  publicChain: boolean
  serverOperator: boolean
  donNode: boolean
  enclaveTee: boolean
  note: string
}

const MATRIX_DATA: ThreatRow[] = [
  {
    dataItem: 'Lender Min / Borrower Max Rates',
    publicChain: false,
    serverOperator: false,
    donNode: false,
    enclaveTee: true,
    note: 'Visible only in transient TEE memory during execution. Never written to logs or storage.',
  },
  {
    dataItem: 'Per-Tenor Clearing Rate (r*) & Volume',
    publicChain: true,
    serverOperator: true,
    donNode: true,
    enclaveTee: true,
    note: 'Public benchmark emitted onchain via Cleared event after uniform auction resolution.',
  },
  {
    dataItem: 'Intent Ciphertext (350 bytes)',
    publicChain: true,
    serverOperator: true,
    donNode: true,
    enclaveTee: true,
    note: 'Opaque blob posted to Monad inbox. Sender is bound in AAD to prevent replay.',
  },
  {
    dataItem: 'Account Balances & Order Sizes',
    publicChain: false,
    serverOperator: true,
    donNode: false,
    enclaveTee: true,
    note: 'Held by offchain state store, committed onchain as an OpenZeppelin Merkle root.',
  },
  {
    dataItem: 'Deposits & Withdrawal Requests',
    publicChain: true,
    serverOperator: true,
    donNode: true,
    enclaveTee: true,
    note: 'Public onchain for ERC-20 token tracking. Payouts require prior onchain requests.',
  },
  {
    dataItem: 'Loan Positions & Lender Shares',
    publicChain: false,
    serverOperator: true,
    donNode: false,
    enclaveTee: true,
    note: 'Private from public chain; only leaf hashes committed. Escape hatch resolves via proof.',
  },
]

const CLAIMS_ALLOWED = [
  {
    allowed: 'Rates are visible only to you and a Chainlink CRE enclave.',
    prohibited: 'No one can ever see your rate / Trustless privacy.',
    rationale: 'Enclave memory decrypts rates during matching; privacy is hardware-isolated, not magical.',
  },
  {
    allowed: 'Only the clearing rate is published; losing bids are never revealed.',
    prohibited: 'Individual rates are never exposed.',
    rationale: 'The uniform clearing rate r* equals the marginal accepted lender bid.',
  },
  {
    allowed: 'Positions are hidden from the public chain; only a Merkle root is committed.',
    prohibited: 'Fully private positions.',
    rationale: 'The server indexer stores plaintext balances to serve Merkle proofs.',
  },
  {
    allowed: 'If settlement stops, everyone can exit with a Merkle proof.',
    prohibited: 'Funds are always instantly withdrawable.',
    rationale: 'Exit requires awaiting ESCAPE_DELAY (24h prod, 10m demo) to prevent dual-spend races.',
  },
]

export const TrustMatrix: React.FC = () => {
  const [tab, setTab] = useState<'observer' | 'claims'>('observer')

  return (
    <section id="threat-model" className="trust-matrix-section">
      <div className="section-header">
        <div className="section-pill">Threat Model & Transparency</div>
        <h2 className="section-title">
          Honest Security Guarantees & Observer Matrix
        </h2>
        <p className="section-subtitle">
          From <code className="inline-code">docs/THREAT-MODEL.md</code>. Judges and engineers inspect trust boundaries first.
          Here is exactly what each actor in the system can and cannot observe.
        </p>
      </div>

      <div className="matrix-container">
        {/* Sub-Tabs */}
        <div className="matrix-tabs-row" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'observer'}
            className={`matrix-tab-btn ${tab === 'observer' ? 'active' : ''}`}
            onClick={() => setTab('observer')}
          >
            What Each Observer Learns
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'claims'}
            className={`matrix-tab-btn ${tab === 'claims' ? 'active' : ''}`}
            onClick={() => setTab('claims')}
          >
            Permitted vs Prohibited Claims (§5)
          </button>
        </div>

        {tab === 'observer' ? (
          <div className="table-wrapper">
            <table className="threat-table" role="table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Information Asset</th>
                  <th style={{ textAlign: 'center' }}>Public Monad Chain</th>
                  <th style={{ textAlign: 'center' }}>Server Operator</th>
                  <th style={{ textAlign: 'center' }}>DON Node Operator</th>
                  <th style={{ textAlign: 'center' }}>Enclave (TEE)</th>
                  <th style={{ width: '32%' }}>Technical Boundary</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX_DATA.map((row, i) => (
                  <tr key={i}>
                    <td className="asset-cell">
                      <strong>{row.dataItem}</strong>
                    </td>
                    <td className="status-cell">
                      <span className={`status-tag ${row.publicChain ? 'revealed' : 'hidden'}`}>
                        {row.publicChain ? 'Revealed' : 'Hidden'}
                      </span>
                    </td>
                    <td className="status-cell">
                      <span className={`status-tag ${row.serverOperator ? 'revealed' : 'hidden'}`}>
                        {row.serverOperator ? 'Revealed' : 'Hidden'}
                      </span>
                    </td>
                    <td className="status-cell">
                      <span className={`status-tag ${row.donNode ? 'revealed' : 'hidden'}`}>
                        {row.donNode ? 'Revealed' : 'Hidden'}
                      </span>
                    </td>
                    <td className="status-cell">
                      <span className="status-tag enclave">
                        {row.enclaveTee ? 'Decrypted (TEE)' : 'Hidden'}
                      </span>
                    </td>
                    <td className="note-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="claims-grid">
            {CLAIMS_ALLOWED.map((c, i) => (
              <div key={i} className="claim-card">
                <div className="claim-half allowed">
                  <div className="claim-tag-row">
                    <span className="claim-badge green">Allowed Claim</span>
                  </div>
                  <p className="claim-text">"{c.allowed}"</p>
                </div>

                <div className="claim-half prohibited">
                  <div className="claim-tag-row">
                    <span className="claim-badge red">Prohibited Copy</span>
                  </div>
                  <p className="claim-text">"{c.prohibited}"</p>
                </div>

                <div className="claim-rationale">
                  <strong>Why:</strong> {c.rationale}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="matrix-footer-note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            Key design property: <strong>No domain can both read rates and move funds</strong>, and every domain that moves state is verified by another.
          </span>
        </div>
      </div>
    </section>
  )
}
