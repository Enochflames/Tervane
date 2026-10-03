import { Arrow, ButtonLink } from '../components/Button'
import { useReveal } from '../lib/useReveal'
import { InboxPanel } from './InboxPanel'
import './hero.css'

const FACTS = [
  { value: '350 B', label: 'Every intent, any action. Lend, borrow, cancel and repay look identical onchain.' },
  { value: '1 rate', label: 'Published per tenor, per epoch. Losing bids are never revealed.' },
  { value: '30 s', label: 'Heartbeat epoch, plus a log trigger that settles right after an intent lands.' },
  { value: '2.0× → 1.3×', label: 'Collateral falls as repaid volume builds your credit tier.' },
]

export function Hero() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="hero" id="top" ref={ref}>
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="eyebrow" data-reveal style={{ ['--reveal-i' as string]: 0 }}>
            <b>●</b> Monad testnet · Chainlink CRE
          </p>
          <h1 className="display hero-title" data-reveal style={{ ['--reveal-i' as string]: 1 }}>
            Fixed-rate credit, priced by <em>sealed bids</em>.
          </h1>
          <p className="lede" data-reveal style={{ ['--reveal-i' as string]: 2 }}>
            Lenders and borrowers post encrypted intents to an onchain inbox on Monad. A Chainlink CRE enclave clears each
            tenor in a uniform-price auction and publishes a single number: the clearing rate. Your rate is visible only to
            you and the enclave.
          </p>
          <div className="hero-ctas" data-reveal style={{ ['--reveal-i' as string]: 3 }}>
            <ButtonLink href="/app" trailing={<Arrow />}>Launch app</ButtonLink>
            <ButtonLink href="#how" variant="secondary">How it works</ButtonLink>
          </div>
          <p className="hero-note" data-reveal style={{ ['--reveal-i' as string]: 4 }}>
            Simulated with the CRE CLI against Monad testnet. Reports land onchain.
          </p>
        </div>
        <div className="hero-panel" data-reveal style={{ ['--reveal-i' as string]: 3 }}>
          <InboxPanel />
        </div>
      </div>

      <div className="container">
        <dl className="facts">
          {FACTS.map((f, i) => (
            <div className="fact" key={f.value} data-reveal style={{ ['--reveal-i' as string]: i }}>
              <dt className="mono">{f.value}</dt>
              <dd>{f.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
