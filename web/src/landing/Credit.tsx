import { TIERS } from '@tervane/core'
import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'
import './credit.css'

const PRICE = 2500 // USD per ETH, for the collateral illustration
const CAP = ['2,000', 'repaid, min. 2,000', '1.5 × repaid', '2 × repaid']
const ratio = (bps: bigint) => `${(Number(bps) / 10_000).toFixed(2).replace(/0$/, '')}×`
const usd = (x: bigint) => (Number(x) / 1e6).toLocaleString('en-US')

export function Credit() {
  const ref = useReveal<HTMLElement>()
  const max = Number(TIERS[0]!.openRatioBps)
  return (
    <section className="sec" id="credit" ref={ref}>
      <div className="container">
        <SectionHead index="04" kicker="Credit" title={<>Repay on time. <em>Post less</em> next time.</>}>
          <p>
            Tiers grow with repaid volume and live in the committed ledger. A higher tier opens loans at a lower collateral
            ratio; a liquidation drops you one tier. The tier at opening governs a loan for its whole life.
          </p>
        </SectionHead>

        <div className="sec-body credit">
          <div className="credit-table" data-reveal>
            <table>
              <thead>
                <tr><th scope="col">Tier</th><th scope="col">Opens at</th><th scope="col">Liquidates below</th><th scope="col">Unlocks after repaying</th><th scope="col">Borrow cap (tUSD)</th></tr>
              </thead>
              <tbody>
                {TIERS.map((t, i) => (
                  <tr key={t.name}>
                    <th scope="row">{t.name}</th>
                    <td className="mono">{ratio(t.openRatioBps)}</td>
                    <td className="mono">{ratio(t.liqRatioBps)}</td>
                    <td className="mono">{t.minRepaid === 0n ? '—' : `${usd(t.minRepaid)} tUSD`}</td>
                    <td className="mono credit-cap">{CAP[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <figure className="credit-bars" data-reveal style={{ ['--reveal-i' as string]: 1 }}>
            <figcaption>Collateral to borrow 1,000 tUSD with ETH at ${PRICE.toLocaleString('en-US')}</figcaption>
            <ul>
              {TIERS.map((t) => {
                const eth = (1000 * Number(t.openRatioBps)) / 10_000 / PRICE
                return (
                  <li key={t.name}>
                    <span className="credit-bar-name">{t.name}</span>
                    <span className="credit-bar-track"><span className="credit-bar-fill" style={{ transform: `scaleX(${Number(t.openRatioBps) / max})` }} /></span>
                    <span className="mono credit-bar-val">{eth.toFixed(2)} ETH</span>
                  </li>
                )
              })}
            </ul>
          </figure>
        </div>

        <div className="proof" data-reveal>
          <div>
            <h3>Prove your tier, not your book.</h3>
            <p>
              Your account is a leaf in the Merkle tree whose root lives on TervaneCore. Hand any app or contract the leaf
              and its proof, and it can check your tier and repaid volume against the live root. Your orders and loans stay
              out of it.
            </p>
          </div>
          <pre className="proof-code mono" aria-label="Solidity call">
{`TervaneCore.verifyAccount(account, proof)
// → true
// discloses: tier 0 · repaid 150.000000 tUSD`}
          </pre>
        </div>
      </div>
    </section>
  )
}
