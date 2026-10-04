import { Auction } from './Auction'
import { Closing, Footer } from './Closing'
import { Credit } from './Credit'
import { Header } from './Header'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { Problem } from './Problem'
import { Testnet } from './Testnet'
import { Trust } from './Trust'
import './sections.css'

export function Landing() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <Auction />
        <Credit />
        <Trust />
        <Testnet />
        <Closing />
      </main>
      <Footer />
    </>
  )
}
