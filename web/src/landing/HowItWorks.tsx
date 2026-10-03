import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'

const STEPS = [
  { where: 'Your browser', n: '1', title: 'Seal your intent', body: 'Action, tenor, amount and rate are encrypted to the enclave key published on TervaneCore. Not to our server.', tech: 'ECIES · secp256k1 · HKDF-SHA256 · AES-256-GCM · bound to chain, contract and sender' },
  { where: 'Monad', n: '2', title: 'Post to the inbox', body: 'TervaneCore appends it to a hash-chained inbox. Settlement must consume a contiguous prefix, so no intent can be dropped or reordered.', tech: 'acc[i] = keccak(acc[i−1] ‖ msgHash(i))' },
  { where: 'Chainlink CRE', n: '3', title: 'Clear inside the enclave', body: 'A confidential workflow checks the ledger against the onchain Merkle root, decrypts the intents and runs one uniform-price auction per tenor.', tech: 'handlerInTee · log trigger per intent + 30 s cron', accent: true },
  { where: 'Monad', n: '4', title: 'Settle with one report', body: 'One signed report per epoch. TervaneCore re-checks the forwarder, epoch, root, inbox, price round and every payout before anything moves.', tech: 'writeReport → forwarder → onReport → EpochSettled' },
]

export function HowItWorks() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="sec" id="how" ref={ref}>
      <div className="container">
        <SectionHead index="02" kicker="How it works" title={<>Matching moves offchain. <em>Enforcement</em> stays on Monad.</>}>
          <p>
            Four stages, two trust domains. The enclave can read every bid but can only act through a report the contract
            checks. The contract moves funds but never sees a rate.
          </p>
        </SectionHead>
        <div className="sec-body">
          <ol className="flow">
            {STEPS.map((s, i) => (
              <li className="step" key={s.n} data-accent={s.accent ?? false} data-reveal style={{ ['--reveal-i' as string]: i }}>
                <span className="step-node" aria-hidden="true" />
                <span className="step-where"><span>{s.where}</span><span>{s.n}/4</span></span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <code className="step-tech">{s.tech}</code>
              </li>
            ))}
          </ol>
          <div className="flow-legend" data-reveal>
            <span><i style={{ background: 'var(--accent)' }} />Plaintext rates exist only here, for one execution</span>
            <span><i style={{ boxShadow: 'inset 0 0 0 1.5px var(--ink)' }} />Public: ciphertext, roots, clearing rates</span>
          </div>
        </div>
      </div>
    </section>
  )
}
