import { CONTRACTS, RUN, addrUrl, short, txUrl } from '../data/testnet'
import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'
import './testnet.css'

const LABELS: Record<keyof typeof CONTRACTS, string> = {
  tervaneCore: 'TervaneCore', tUSD: 'tUSD', tETH: 'tETH', priceFeed: 'Price feed (mock)', mockForwarder: 'CRE mock forwarder',
}

export function Testnet() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="sec" id="testnet" ref={ref}>
      <div className="container">
        <SectionHead index="06" kicker="On Monad testnet" title={<>Built, and run <em>end to end</em>.</>}>
          <p>
            Every epoch below was produced by the confidential workflow in <span className="mono">cre workflow simulate --broadcast</span>,
            then checked by TervaneCore onchain. Our leak audit found none of the losing bids in logs, the database, calldata
            or events.
          </p>
        </SectionHead>

        <div className="sec-body tn">
          <ol className="tn-run">
            {RUN.map((r, i) => (
              <li key={r.step} data-reveal style={{ ['--reveal-i' as string]: i }}>
                <span className="tn-step mono">{r.step}</span>
                <span className="tn-what">{r.what}</span>
                <span className="tn-result">{r.result}</span>
                <a className="tn-tx mono" href={txUrl(r.tx)} target="_blank" rel="noreferrer">{short(r.tx)} ↗</a>
              </li>
            ))}
          </ol>

          <aside className="tn-contracts" data-reveal>
            <h3 className="eyebrow">Contracts · verified on Sourcify</h3>
            <dl>
              {(Object.keys(CONTRACTS) as (keyof typeof CONTRACTS)[]).map((k) => (
                <div key={k}>
                  <dt>{LABELS[k]}</dt>
                  <dd><a className="mono" href={addrUrl(CONTRACTS[k])} target="_blank" rel="noreferrer">{short(CONTRACTS[k], 8, 6)}</a></dd>
                </div>
              ))}
            </dl>
            <p className="tn-fine">Chain id 10143. Simulated with the CRE CLI against Monad testnet; reports land onchain.</p>
          </aside>
        </div>
      </div>
    </section>
  )
}
