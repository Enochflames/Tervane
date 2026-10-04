import { useState } from 'react'
import { Segmented } from '../components/Segmented'
import { EPOCH_1, INBOX, short, txUrl, type InboxRow } from '../data/testnet'
import './inbox.css'

type Lens = 'chain' | 'you' | 'enclave'
const LENSES: { value: Lens; label: string }[] = [
  { value: 'chain', label: 'Public chain' },
  { value: 'you', label: 'You · Bola' },
  { value: 'enclave', label: 'CRE enclave' },
]
const CAPTION: Record<Lens, string> = {
  chain: 'Anyone can read the deposits and see that four addresses sent an intent. Each one is the same 350 bytes of ciphertext.',
  you: 'Bola’s browser decrypts Bola’s own intent from local memory. Every other intent stays sealed, even to the server.',
  enclave: 'Inside the CRE enclave, for one execution: every intent decrypts, the book clears, and only the clearing rate leaves.',
}

function Payload({ row, lens }: { row: InboxRow; lens: Lens }) {
  if (row.kind === 'DEPOSIT') return <span className="ib-deposit">{row.deposit}</span>
  const open = lens === 'enclave' || (lens === 'you' && row.who === 'Bola')
  if (!open || !row.plain) {
    return (
      <span className="ib-blob" title="AES-256-GCM ciphertext">
        <span className="mono">{row.blob!.slice(0, 26)}…</span>
        <span className="ib-size mono">350 B</span>
      </span>
    )
  }
  return (
    <span className="ib-plain">
      <span className="ib-action" data-side={row.plain.action}>{row.plain.action}</span>
      <span className="mono">{row.plain.amount}</span>
      <span className="ib-rate mono">{row.plain.rate}</span>
      {lens === 'you' && <span className="ib-local">decrypted on this device</span>}
    </span>
  )
}

export function InboxPanel() {
  const [lens, setLens] = useState<Lens>('chain')
  return (
    <figure className="ib" aria-label="TervaneCore inbox from the Monad testnet run">
      <div className="ib-head">
        <div className="ib-title">
          <span className="ib-dot" aria-hidden="true" />
          <span className="mono">TervaneCore.inbox</span>
                  </div>
        <Segmented options={LENSES} value={lens} onChange={setLens} label="Who is looking" />
      </div>

      <ol className="ib-rows">
        {INBOX.map((r) => (
          <li key={r.index} className="ib-row" data-kind={r.kind}>
            <span className="ib-idx mono">#{r.index}</span>
            <span className="ib-kind mono">{r.kind}</span>
            <span className="ib-who">{r.who}</span>
            <span className="ib-payload" key={`${lens}-${r.index}`} data-swap>
              <Payload row={r} lens={lens} />
            </span>
          </li>
        ))}
      </ol>

      <div className="ib-foot">
        <span className="ib-foot-label mono">Epoch 1 · settled by CRE</span>
        <span className="ib-clear">
          <span>Cleared</span>
          <strong className="mono">{EPOCH_1.rate}</strong>
          <span className="ib-muted">· {EPOCH_1.volume}</span>
        </span>
        <a className="ib-tx mono" href={txUrl(EPOCH_1.tx)} target="_blank" rel="noreferrer">{short(EPOCH_1.tx)} ↗</a>
      </div>

      <figcaption className="ib-caption" key={lens} data-swap>{CAPTION[lens]}</figcaption>
    </figure>
  )
}
