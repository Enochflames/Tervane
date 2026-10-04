import { Arrow, ButtonLink } from '../components/Button'
import { Wordmark } from '../components/Wordmark'
import { REPO, doc } from '../data/testnet'
import { useReveal } from '../lib/useReveal'
import './closing.css'

export function Closing() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="closing" ref={ref}>
      <div className="container closing-inner">
        <h2 className="display closing-title" data-reveal>Bid without <em>showing your hand</em>.</h2>
        <div className="closing-ctas" data-reveal style={{ ['--reveal-i' as string]: 1 }}>
          <ButtonLink href="/app" trailing={<Arrow />}>Launch app</ButtonLink>
          <ButtonLink href={doc('PROTOCOL-SPEC.md')} variant="secondary" target="_blank" rel="noreferrer">Read the protocol</ButtonLink>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="ftr">
      <div className="container ftr-inner">
        <div className="ftr-brand">
          <Wordmark size={20} />
          <p>A sealed-bid fixed-rate credit market on Monad, settled by a Chainlink CRE confidential workflow.</p>
        </div>
        <nav className="ftr-links" aria-label="Footer">
          <div>
            <h3>Protocol</h3>
            <a href={doc('ARCHITECTURE.md')} target="_blank" rel="noreferrer">Architecture</a>
            <a href={doc('PROTOCOL-SPEC.md')} target="_blank" rel="noreferrer">Specification</a>
            <a href={doc('CRE-WORKFLOW.md')} target="_blank" rel="noreferrer">CRE workflow</a>
          </div>
          <div>
            <h3>Security</h3>
            <a href={doc('THREAT-MODEL.md')} target="_blank" rel="noreferrer">Trust model</a>
            <a href={doc('CONTRACTS.md')} target="_blank" rel="noreferrer">Contracts</a>
            <a href={REPO} target="_blank" rel="noreferrer">Source</a>
          </div>
        </nav>
      </div>
      <div className="container ftr-base">
        <div className="ftr-base-inner">
          <span>Testnet software. Not audited. Test tokens only.</span>
          <span className="mono">Monad Metropolis · Chainlink CRE</span>
        </div>
      </div>
    </footer>
  )
}
