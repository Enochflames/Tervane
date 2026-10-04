import { useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react'
import { EXPLORER } from '../lib/config'
import { short } from '../lib/format'
import type { TxPhase } from '../lib/tx'
import { toast } from './toast'
import './ui.css'

export function Panel({ title, aside, children, pad = true }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="pnl">
      {(title || aside) && <header className="pnl-head"><h2>{title}</h2>{aside}</header>}
      <div className={pad ? 'pnl-body' : undefined}>{children}</div>
    </section>
  )
}

export function Field({ label, suffix, hint, error, action, ...input }: {
  label: string; suffix?: string; hint?: ReactNode; error?: string | null; action?: ReactNode
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="fld" data-invalid={!!error}>
      <span className="fld-top"><span>{label}</span>{action}</span>
      <span className="fld-box">
        <input inputMode="decimal" autoComplete="off" spellCheck={false} {...input} />
        {suffix && <span className="fld-suffix">{suffix}</span>}
      </span>
      {(error || hint) && <span className={error ? 'fld-error' : 'fld-hint'}>{error || hint}</span>}
    </label>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'muted' }) {
  return (
    <div className="stat" data-tone={tone}>
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
      {sub && <dd className="stat-sub">{sub}</dd>}
    </div>
  )
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'accent' | 'warn'; children: ReactNode }) {
  return <span className="pill" data-tone={tone}>{children}</span>
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'accent'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ntc" data-tone={tone} role={tone === 'warn' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  )
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <div className="kv"><dt>{k}</dt><dd>{v}</dd></div>
}

export function TxLink({ hash }: { hash: string }) {
  return <a className="mono txlink" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">{short(hash)} ↗</a>
}

const PHASE_LABEL: Record<TxPhase, string | null> = { idle: null, wallet: 'Confirm in wallet…', pending: 'Waiting for Monad…', done: 'Done', error: null }

export function TxButton({ phase, children, disabled, onClick, variant = 'primary', wide }: {
  phase: TxPhase; children: ReactNode; disabled?: boolean; onClick: () => void; variant?: 'primary' | 'secondary'; wide?: boolean
}) {
  const busy = phase === 'wallet' || phase === 'pending'
  const label = PHASE_LABEL[phase] ?? children
  return (
    <button className="btn txbtn" data-variant={variant} data-wide={wide} disabled={disabled || busy} aria-busy={busy} onClick={onClick}>
      <span className="txbtn-label" key={String(phase)}>{busy && <span className="spin" aria-hidden="true" />}{label}</span>
    </button>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children && <div className="empty-body">{children}</div>}</div>
}

export function Toaster() {
  const items = useSyncExternalStore(toast.subscribe, toast.get)
  return (
    <ol className="toasts" aria-live="polite">
      {items.map((t) => (
        <li key={t.id} className="toast" data-tone={t.tone}>
          <span className="toast-dot" aria-hidden="true" />
          <div className="toast-text">
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
            {t.txHash && <TxLink hash={t.txHash} />}
          </div>
          <button className="toast-x" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss">×</button>
        </li>
      ))}
    </ol>
  )
}
