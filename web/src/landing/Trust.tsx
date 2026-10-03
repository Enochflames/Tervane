import { doc } from '../data/testnet'
import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'
import './trust.css'

// THREAT-MODEL §2: what each observer learns.
const COLS = ['Public chain', 'Server operator', 'DON node operators', 'CRE enclave'] as const
const ROWS: { what: string; sees: [boolean, boolean, boolean, boolean]; note?: string }[] = [
  { what: 'Lend minimums and borrow maximums', sees: [false, false, false, true], note: 'during one execution' },
  { what: 'Clearing rate and volume per tenor', sees: [true, true, true, true] },
  { what: 'Intent action, tenor, amount, collateral', sees: [false, true, false, true], note: 'chain sees fixed-size ciphertext' },
  { what: 'Who sent an intent, and when', sees: [true, true, true, true] },
  { what: 'Deposits and withdrawal requests', sees: [true, true, true, true] },
  { what: 'Balances, orders, loans, tiers', sees: [false, true, false, true], note: 'chain sees one Merkle root' },
]

const GUARANTEES = [
  { title: 'Chainlink CRE is the only path to a state change.', body: 'TervaneCore accepts a settlement report only from the forwarder, and only if its epoch, root, inbox accumulator, price round and timestamp all check out.' },
  { title: 'The server can’t read your rate, or alter or drop your intent.', body: 'Intents are sealed to the enclave key, and the enclave verifies the server’s data against the onchain root and inbox hash chain before using it.' },
  { title: 'No payout without your onchain request.', body: 'Every payout needs a withdrawal request from your address and is capped by it, so the enclave can’t silently pay arbitrary addresses.' },
  { title: 'If settlement stops, everyone can exit.', body: 'After the escape delay, anyone can activate the escape hatch, and every account exits with a Merkle proof against the last committed root.' },
]

const Mark = ({ on }: { on: boolean }) => (
  <span className="tm-mark" data-on={on}><span className="visually-hidden">{on ? 'yes' : 'no'}</span></span>
)

export function Trust() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="sec" id="trust" ref={ref}>
      <div className="container">
        <SectionHead index="05" kicker="Trust" title={<>Know exactly <em>who sees what</em>.</>}>
          <p>
            Positions are private from the public, not from our server. Rates are private from everyone except you and the
            enclave. We would rather state that precisely than promise privacy we can’t deliver.
          </p>
        </SectionHead>

        <div className="sec-body tm-wrap" data-reveal>
          <table className="tm">
            <thead>
              <tr><th scope="col"><span className="visually-hidden">Data</span></th>{COLS.map((c) => <th scope="col" key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.what}>
                  <th scope="row">{r.what}{r.note && <span className="tm-note">{r.note}</span>}</th>
                  {r.sees.map((s, i) => <td key={COLS[i]} data-label={COLS[i]}><Mark on={s} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tm-legend"><span><Mark on />can see</span><span><Mark on={false} />cannot</span><a href={doc('THREAT-MODEL.md')} target="_blank" rel="noreferrer">Full threat model ↗</a></p>
        </div>

        <ul className="guarantees">
          {GUARANTEES.map((g, i) => (
            <li key={g.title} data-reveal style={{ ['--reveal-i' as string]: i }}>
              <h3>{g.title}</h3>
              <p>{g.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
