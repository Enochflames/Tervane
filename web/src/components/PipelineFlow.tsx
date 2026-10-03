import React, { useState } from 'react'

interface Stage {
  number: string
  title: string
  location: 'Client' | 'Monad L1' | 'CRE TEE' | 'Settlement'
  badgeColor: string
  shortSummary: string
  details: string[]
  codeSnippet?: string
}

const STAGES: Stage[] = [
  {
    number: '01',
    title: 'Client-Side Encryption',
    location: 'Client',
    badgeColor: '#38bdf8',
    shortSummary: 'Plaintext intents are born only on user devices and encrypted before broadcast.',
    details: [
      'Reads enclavePubKey onchain from TervaneCore (never from server).',
      'Encodes 288-byte static IntentPayload via ABI (viem).',
      'Encrypts with ECIES (noble) + AES-256-GCM bound to AAD (chainId, core, msg.sender).',
      'Local storage preserves own rate for UI; no rate is ever sent in plaintext.',
    ],
    codeSnippet: 'blob = 0x01 ‖ eph_pk(33B) ‖ iv(12B) ‖ ct_tag(304B) // 350B total',
  },
  {
    number: '02',
    title: 'Monad Onchain Inbox',
    location: 'Monad L1',
    badgeColor: '#8353e2',
    shortSummary: 'Hash-chained accumulator guarantees zero dropped or reordered intents.',
    details: [
      'submitIntent(blob) appends message to contract inbox.',
      'Updates onchain accumulator: acc_i = keccak(acc_{i-1}, msgHash_i).',
      'Contract stores inboxAcc[i] for every message index.',
      'Emits InboxMessage event, firing Chainlink CRE log trigger.',
    ],
    codeSnippet: 'event InboxMessage(uint64 index, uint8 kind, address sender, bytes blob);',
  },
  {
    number: '03',
    title: 'Enclave State Ingest & Verification',
    location: 'CRE TEE',
    badgeColor: '#34d399',
    shortSummary: 'TEE verifies server integrity against onchain commitments before reading.',
    details: [
      'Trigger H0 (log trigger) or H1 (cron every 30s) invokes handlerInTee.',
      'Fetches ENCLAVE_SK from Chainlink Vault DON into transient memory.',
      'Verifies server ledger state: merkleRoot(prev) == onchain.stateRoot.',
      'Verifies inbox accumulator chain against onchain inboxAcc commitments.',
    ],
    codeSnippet: 'if (merkleRoot(prev) != stateRoot) throw E_ROOT_MISMATCH;',
  },
  {
    number: '04',
    title: 'Uniform Call Auction & Matching',
    location: 'CRE TEE',
    badgeColor: '#34d399',
    shortSummary: 'Decryption and matching happen exclusively in confidential TEE memory.',
    details: [
      'Decrypts 350-byte blobs with ephemeral keys and AAD verification.',
      'Sorts lenders by minRate asc; sorts borrowers by maxRate desc.',
      'Greedily covers demand; sets uniform clearing rate r* = max(consumed slices).',
      'Zero plaintext rates logged or transmitted. Unfilled bids remain sealed.',
    ],
    codeSnippet: 'r_star = max(minRate over all recorded slices) // Uniform clearing price',
  },
  {
    number: '05',
    title: 'Onchain Report Execution',
    location: 'Monad L1',
    badgeColor: '#8353e2',
    shortSummary: 'TervaneCore enforces 10 strict validation checks before advancing state.',
    details: [
      'CRE DON signs SettlementReport and submits via KeystoneForwarder.',
      'TervaneCore._processReport checks forwarder, epoch == lastEpoch + 1, prevRoot == stateRoot.',
      'Verifies priceRoundId against Chainlink oracle feed (freshness check).',
      'Enforces payout ceilings (paid <= requested); emits EpochSettled and Cleared.',
    ],
    codeSnippet: 'emit EpochSettled(epoch, newRoot, inboxTo, asOf, priceUsed);',
  },
  {
    number: '06',
    title: 'Validium Escape Hatch',
    location: 'Settlement',
    badgeColor: '#f43f5e',
    shortSummary: 'Guaranteed exit against the last committed Merkle root if settlement halts.',
    details: [
      'If CRE falls silent for > ESCAPE_DELAY (24h prod, 10m demo), activateEscape() unlocks.',
      'exitAccount(Account a, bytes32[] proof) returns all free & reserved balances.',
      'escapeRepay and escapeLiquidate resolve open term loans with OpenZeppelin proofs.',
      'No reliance on sequencer liveness or server cooperation for fund recovery.',
    ],
    codeSnippet: 'MerkleProof.verify(proof, stateRoot, leaf) -> transfers funds',
  },
]

export const PipelineFlow: React.FC = () => {
  const [activeStageIndex, setActiveStageIndex] = useState<number>(3) // Stage 4 default (Auction)

  const activeStage = STAGES[activeStageIndex]

  return (
    <section id="architecture" className="pipeline-section">
      <div className="section-header">
        <div className="section-pill">Settlement Protocol Loop</div>
        <h2 className="section-title">
          How Tervane Settles Each 30-Second Epoch
        </h2>
        <p className="section-subtitle">
          From browser-level encryption to Chainlink CRE TEE matching and onchain Monad Merkle commitments.
          No single party can both read rates and move funds.
        </p>
      </div>

      <div className="pipeline-container">
        {/* Step Navigation Bar */}
        <div className="pipeline-stepper" role="tablist">
          {STAGES.map((st, idx) => {
            const isCurrent = activeStageIndex === idx
            return (
              <button
                key={st.number}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                className={`step-nav-btn ${isCurrent ? 'active' : ''}`}
                onClick={() => setActiveStageIndex(idx)}
              >
                <div className="step-num-pill" style={{ borderColor: isCurrent ? st.badgeColor : undefined }}>
                  {st.number}
                </div>
                <div className="step-label-wrap">
                  <span className="step-location-tag" style={{ color: st.badgeColor }}>
                    {st.location}
                  </span>
                  <strong className="step-nav-title">{st.title}</strong>
                </div>
              </button>
            )
          })}
        </div>

        {/* Active Stage Detailed Stage Card */}
        <div className="stage-detail-card">
          <div className="stage-header-row">
            <div className="stage-title-wrap">
              <span className="stage-big-badge" style={{ backgroundColor: `${activeStage.badgeColor}18`, color: activeStage.badgeColor }}>
                Stage {activeStage.number} • {activeStage.location}
              </span>
              <h3 className="stage-headline">{activeStage.title}</h3>
            </div>
            <p className="stage-summary">{activeStage.shortSummary}</p>
          </div>

          <div className="stage-body-grid">
            <div className="stage-bullets-list">
              {activeStage.details.map((item, i) => (
                <div key={i} className="bullet-row">
                  <span className="bullet-indicator" style={{ backgroundColor: activeStage.badgeColor }} />
                  <p>{item}</p>
                </div>
              ))}
            </div>

            {activeStage.codeSnippet && (
              <div className="stage-code-panel">
                <div className="code-panel-top">
                  <span className="code-lang">Protocol Implementation</span>
                </div>
                <pre className="code-body">
                  <code>{activeStage.codeSnippet}</code>
                </pre>
              </div>
            )}
          </div>

          <div className="stage-navigation-arrows">
            <button
              type="button"
              className="prev-stage-btn"
              disabled={activeStageIndex === 0}
              onClick={() => setActiveStageIndex((prev) => Math.max(0, prev - 1))}
            >
              ← Previous Step
            </button>
            <span className="step-counter-tag">
              {activeStageIndex + 1} of {STAGES.length}
            </span>
            <button
              type="button"
              className="next-stage-btn"
              disabled={activeStageIndex === STAGES.length - 1}
              onClick={() => setActiveStageIndex((prev) => Math.min(STAGES.length - 1, prev + 1))}
            >
              Next Step →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
