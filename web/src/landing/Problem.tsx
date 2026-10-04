import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'

const ROWS = [
  { what: 'Each lender’s rate', book: 'Public, the moment it is posted', us: 'Visible only to the lender and the enclave' },
  { what: 'Who wants to borrow, and how much', book: 'Public', us: 'Sealed: every intent is the same 350 bytes' },
  { what: 'Open positions and balances', book: 'Public', us: 'Hidden from the public chain; only a Merkle root is published' },
  { what: 'Price discovery', book: 'Continuous; anyone can trade against a visible book', us: 'One uniform clearing rate per tenor, per epoch' },
  { what: 'What gets published', book: 'Every bid', us: 'The clearing rate and matched volume' },
]

export function Problem() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="sec" id="problem" ref={ref}>
      <div className="container">
        <SectionHead index="01" kicker="The problem" title={<>On a public order book, every bid is a <em>confession</em>.</>}>
          <p>
            Lenders publish their cost of capital to anyone watching. Borrowers reveal how much they need and how much they
            will pay. Tervane keeps the market and removes the leak: bids are sealed, matching happens inside an enclave, and
            the chain enforces the result.
          </p>
        </SectionHead>
        <div className="sec-body" data-reveal>
          <table className="cmp">
            <thead>
              <tr><th scope="col"><span className="visually-hidden">Property</span></th><th scope="col">Onchain order book</th><th scope="col">Tervane</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.what}>
                  <th scope="row">{r.what}</th>
                  <td data-label="Order book">{r.book}</td>
                  <td className="us" data-label="Tervane">{r.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
