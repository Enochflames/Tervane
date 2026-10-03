import { ButtonLink } from '../components/Button'
import { Wordmark } from '../components/Wordmark'

/** Placeholder until the app pages land (CLIENT.md screens: Lend/Borrow, Market, Wallet, Positions, Credit, Escape). */
export function AppSoon() {
  return (
    <main className="container" style={{ minHeight: '100dvh', display: 'grid', placeContent: 'center', gap: 'var(--s-5)', textAlign: 'center', justifyItems: 'center' }}>
      <Wordmark size={26} />
      <h1 className="display" style={{ fontSize: 'var(--display-sm)', maxWidth: '18ch' }}>The trading app is being built next.</h1>
      <p className="lede" style={{ maxWidth: '44ch' }}>Lend, borrow, wallet, positions and credit proofs will live here, against the contracts on Monad testnet.</p>
      <ButtonLink href="/" variant="secondary">Back to the overview</ButtonLink>
    </main>
  )
}
