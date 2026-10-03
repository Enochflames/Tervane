import React, { useState } from 'react'
import { ENVELOPE_SEGMENTS, EnvelopeSegment } from '../types'

export const EnvelopeInspector: React.FC = () => {
  const [selectedSegment, setSelectedSegment] = useState<EnvelopeSegment>(ENVELOPE_SEGMENTS[1])

  return (
    <section id="cryptography" className="envelope-section">
      <div className="section-header">
        <div className="section-pill">Cryptographic Architecture</div>
        <h2 className="section-title">
          Anatomy of a 350-Byte ECIES Envelope
        </h2>
        <p className="section-subtitle">
          Every action (Lend, Borrow, Cancel, Repay) is padded to an exact 288-byte ABI payload, producing an identical
          350-byte ciphertext blob. Observers on Monad learn zero information about intent type, size, or rate.
        </p>
      </div>

      <div className="envelope-card-container">
        {/* Interactive Byte Strip */}
        <div className="byte-strip-wrapper">
          <div className="byte-strip-header">
            <span>Payload Stream: <code className="mono-label">blob = 0x01 ‖ eph_pk ‖ iv ‖ ct_tag (350 bytes)</code></span>
            <span className="byte-total-badge">350 Bytes Total</span>
          </div>

          <div className="byte-strip" role="list">
            {ENVELOPE_SEGMENTS.map((segment) => {
              const isSelected = selectedSegment.name === segment.name
              // Width proportional to byte size (with min floor for visibility)
              const flexShare = segment.bytes === 1 ? 1 : segment.bytes === 12 ? 3 : segment.bytes === 33 ? 6 : 20

              return (
                <button
                  key={segment.name}
                  type="button"
                  style={{ flex: flexShare }}
                  className={`byte-segment-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedSegment(segment)}
                  title={`${segment.name} (${segment.bytes} bytes)`}
                >
                  <span className="seg-name">{segment.name}</span>
                  <span className="seg-bytes">{segment.bytes}B</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected Segment Deep-Dive */}
        <div className="segment-detail-card">
          <div className="detail-top-row">
            <div className="detail-title-group">
              <span className="detail-bytes-badge">{selectedSegment.bytes} Bytes</span>
              <h3 className="detail-title">{selectedSegment.name}</h3>
            </div>
            <code className="detail-hex-sample mono-addr">{selectedSegment.hexPreview}</code>
          </div>

          <p className="detail-description">{selectedSegment.role}</p>

          <div className="aad-callout">
            <div className="aad-header">
              <span className="aad-tag">AAD Anti-Replay Binding</span>
              <span className="aad-security-note">AEAD Authenticated Additional Data</span>
            </div>
            <div className="aad-code-box">
              <code>
                {`aad = abi.encode(
  keccak256("TERVANE_INTENT_V1"),
  uint256 chainId,    // 10143 (Monad Testnet)
  address tervaneCore,// 0x742d...f44e
  address sender      // msg.sender of submitIntent
)`}
              </code>
            </div>
            <p className="aad-explainer">
              Because <code className="inline-code">sender</code> is bound inside the AES-GCM authentication tag, if an MEV bot or frontrunner copies your ciphertext blob and submits it in their own transaction, the enclave&apos;s GCM verification fails immediately. Your intent cannot be stolen or replayed.
            </p>
          </div>
        </div>

        {/* 3 Privacy Properties Grid */}
        <div className="privacy-specs-grid">
          <div className="spec-card">
            <div className="spec-icon">🛡️</div>
            <h4>Uniform Length</h4>
            <p>
              LEND, BORROW, CANCEL, and REPAY payloads all encode to 288 static ABI bytes. Zero size side-channels exist.
            </p>
          </div>

          <div className="spec-card">
            <div className="spec-icon">🔑</div>
            <h4>Onchain Key Anchor</h4>
            <p>
              Clients read <code className="inline-code">TervaneCore.enclavePubKey()</code> directly from Monad, never from the server.
            </p>
          </div>

          <div className="spec-card">
            <div className="spec-icon">🔒</div>
            <h4>Pure TS / QuickJS Safe</h4>
            <p>
              Uses <code className="inline-code">@noble/curves</code> and <code className="inline-code">@noble/ciphers</code> for byte-for-byte agreement in both browser and TEE.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
