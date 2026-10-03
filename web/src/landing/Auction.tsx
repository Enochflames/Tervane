import { owedFor, runAuction, type Address } from '@tervane/core'
import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '../components/Segmented'
import { useReveal } from '../lib/useReveal'
import { SectionHead } from './SectionHead'
import './auction.css'

// The demo book (DEMO-SCRIPT §2). Matching uses @tervane/core's runAuction: the same code the enclave runs.
const LENDS = [
  { id: 5n, name: 'Ada', owner: '0x000000000000000000000000000000000000ada0' as Address, remaining: 600_000_000n, minRate: 413 },
  { id: 6n, name: 'Bola', owner: '0x000000000000000000000000000000000000b01a' as Address, remaining: 600_000_000n, minRate: 527 },
  { id: 7n, name: 'Chidi', owner: '0x00000000000000000000000000000000000c41d1' as Address, remaining: 1_000_000_000n, minRate: 611 },
]
const TENOR_SECS = { '7d': 604_800n, '30d': 2_592_000n } as const
type Tenor = keyof typeof TENOR_SECS

const USD = 1_000_000n
const money = (x: bigint, dp = 2) => {
  const whole = (x / USD).toLocaleString('en-US')
  if (dp === 0) return whole
  const frac = ((x % USD) * 10n ** BigInt(dp)) / USD
  return `${whole}.${frac.toString().padStart(dp, '0')}`
}
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`

// chart geometry
const W = 640, H = 340, L = 44, R = 12, T = 24, B = 30
const X_MAX = 2_400, Y_MIN = 300, Y_MAX = 760
const x = (usd: number) => L + (usd / X_MAX) * (W - L - R)
const y = (bps: number) => T + (1 - (bps - Y_MIN) / (Y_MAX - Y_MIN)) * (H - T - B)

export function Auction() {
  const ref = useReveal<HTMLElement>()
  const [maxRate, setMaxRate] = useState(552)
  const [amount, setAmount] = useState(1000)
  const [tenor, setTenor] = useState<Tenor>('30d')
  const [small, setSmall] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)')
    const on = () => setSmall(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const result = useMemo(() => {
    const borrow = { id: 8n, owner: '0x000000000000000000000000000000000000da40' as Address, remaining: BigInt(amount) * USD, maxRate }
    const { fills, rStar } = runAuction(LENDS, [borrow])
    const used = new Map<bigint, bigint>()
    for (const s of fills[0]?.slices ?? []) used.set(s.lendId, s.amount)
    const owed = rStar !== undefined ? owedFor(borrow.remaining, BigInt(rStar), TENOR_SECS[tenor]) : 0n
    const available = LENDS.filter((l) => l.minRate <= maxRate).reduce((s, l) => s + l.remaining, 0n)
    return { filled: fills.length > 0, rStar, used, owed, principal: borrow.remaining, available }
  }, [maxRate, amount, tenor])

  let cum = 0
  const slices = LENDS.map((l) => {
    const amt = Number(l.remaining / USD)
    const s = { ...l, x0: cum, x1: cum + amt, used: Number((result.used.get(l.id) ?? 0n) / USD) }
    cum += amt
    return s
  })

  return (
    <section className="sec" id="auction" ref={ref}>
      <div className="container">
        <SectionHead index="03" kicker="The auction" title={<>One rate <em>clears</em> the book.</>}>
          <p>
            Each epoch, per tenor, borrows fill whole from the cheapest lend slices up to their sealed maximum. Everyone
            matched trades at the marginal lend rate. Unfilled bids stay sealed. Move the borrower’s numbers: this runs the
            same matching code as the enclave.
          </p>
        </SectionHead>

        <div className="sec-body auc" data-reveal>
          <div className="auc-chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lend supply curve and the borrower's sealed maximum">
              {[400, 500, 600, 700].map((r) => (
                <g key={r}>
                  <line x1={L} x2={W - R} y1={y(r)} y2={y(r)} className="auc-grid" />
                  <text x={L - 8} y={y(r) + 4} className="auc-axis" textAnchor="end">{r / 100}%</text>
                </g>
              ))}
              <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="auc-base" />
              {[0, 600, 1200, 2200].map((v) => (
                <text key={v} x={x(v)} y={H - B + 18} className="auc-axis" textAnchor={v === 0 ? 'start' : 'middle'}>{v.toLocaleString('en-US')}</text>
              ))}

              {slices.map((s) => (
                <g key={s.name}>
                  <rect x={x(s.x0)} y={y(s.minRate)} width={x(s.x1) - x(s.x0)} height={H - B - y(s.minRate)} className="auc-slice" />
                  {s.used > 0 && (
                    <rect x={x(s.x0)} y={y(s.minRate)} width={x(s.x0 + s.used) - x(s.x0)} height={H - B - y(s.minRate)} className="auc-used" />
                  )}
                  <line x1={x(s.x0)} x2={x(s.x1)} y1={y(s.minRate)} y2={y(s.minRate)} className="auc-edge" />
                </g>
              ))}

              {result.filled && result.rStar !== undefined && (
                <g>
                  <line x1={L} x2={x(amount)} y1={y(result.rStar)} y2={y(result.rStar)} className="auc-clear" />
                  <text x={L + 6} y={y(result.rStar) + 15} className="auc-clear-label">clears at {pct(result.rStar)}</text>
                </g>
              )}

              <line x1={L} x2={x(Math.min(amount, X_MAX))} y1={y(maxRate)} y2={y(maxRate)} className="auc-demand" />
              <line x1={x(Math.min(amount, X_MAX))} x2={x(Math.min(amount, X_MAX))} y1={y(maxRate)} y2={H - B} className="auc-demand" />
              <circle cx={x(Math.min(amount, X_MAX))} cy={y(maxRate)} r={4} className="auc-demand-dot" />
              {slices.map((s) => {
                const label = `${s.name} · ${pct(s.minRate)}`
                const cx = (x(s.x0) + x(s.x1)) / 2
                const w = label.length * (small ? 10.6 : 6.9) + 12
                return (
                  <g key={`l-${s.name}`} className="auc-chip">
                    <rect x={cx - w / 2} y={y(s.minRate) - (small ? 30 : 23)} width={w} height={small ? 24 : 17} rx={4} />
                    <text x={cx} y={y(s.minRate) - (small ? 12 : 11)} className="auc-label" textAnchor="middle">{label}</text>
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="auc-side">
            <div className="auc-controls">
              <label className="auc-field">
                <span className="auc-field-top"><span>Borrower’s sealed maximum</span><span className="mono">{pct(maxRate)}</span></span>
                <input type="range" min={350} max={740} step={1} value={maxRate} onChange={(e) => setMaxRate(Number(e.target.value))} />
              </label>
              <label className="auc-field">
                <span className="auc-field-top"><span>Amount</span><span className="mono">{amount.toLocaleString('en-US')} tUSD</span></span>
                <input type="range" min={100} max={2400} step={50} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </label>
              <div className="auc-field auc-tenor">
                <span>Tenor</span>
                <Segmented options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} value={tenor} onChange={setTenor} label="Tenor" />
              </div>
            </div>

            <div className="auc-result" aria-live="polite">
              {result.filled && result.rStar !== undefined ? (
                <>
                  <p className="auc-headline">
                    Matched {money(result.principal, 0)} tUSD at <span className="auc-r">{pct(result.rStar)}</span>
                  </p>
                  <ul className="auc-fills">
                    {slices.map((s) => (
                      <li key={s.name} data-filled={s.used > 0}>
                        <span>{s.name}</span>
                        {s.used > 0
                          ? <span className="mono">{s.used.toLocaleString('en-US')} tUSD at {pct(result.rStar!)}</span>
                          : <span className="auc-sealed">not filled · bid stays sealed</span>}
                      </li>
                    ))}
                  </ul>
                  {maxRate > result.rStar && (
                    <p className="auc-explain">
                      Your sealed maximum is <span className="mono">{pct(maxRate)}</span>, but you pay <span className="mono">{pct(result.rStar)}</span>: the
                      price is set by the marginal lender, not by your bid.
                    </p>
                  )}
                  <p className="auc-owed">
                    Owed at maturity: <span className="mono">{money(result.owed)}</span> tUSD
                    <span className="auc-dim"> · {money(result.owed - result.principal)} interest over {tenor === '7d' ? '7' : '30'} days</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="auc-headline">No match this epoch</p>
                  <p className="auc-explain">
                    {result.available === 0n
                      ? 'No lender will take your maximum. The order rests, and its rate stays sealed.'
                      : `Only ${money(result.available, 0)} tUSD is offered at or below your maximum. Borrows fill whole or not at all, so the order rests, sealed.`}
                  </p>
                </>
              )}
              <p className="auc-published">
                <span className="mono">Published onchain</span>
                {result.filled && result.rStar !== undefined
                  ? <> Cleared(tenor, <b className="mono">{result.rStar}</b>, <b className="mono">{money(result.principal, 0)}</b>). Nothing else.</>
                  : <> nothing for this tenor.</>}
              </p>
            </div>
          </div>
        </div>

        <p className="auc-note" data-reveal>
          Lenders below the clearing rate earn more than they asked, so they gain nothing by misreporting. Only the marginal
          lender can move the price, at the risk of not filling.
        </p>
      </div>
    </section>
  )
}
