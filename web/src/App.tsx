import React, { useState } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { AuctionVisualizer } from './components/AuctionVisualizer'
import { EnvelopeInspector } from './components/EnvelopeInspector'
import { CreditCalculator } from './components/CreditCalculator'
import { PipelineFlow } from './components/PipelineFlow'
import { TrustMatrix } from './components/TrustMatrix'
import { AppModal } from './components/AppModal'
import { Footer } from './components/Footer'

function App() {
  const [isAppModalOpen, setIsAppModalOpen] = useState(false)
  const [initialScreen, setInitialScreen] = useState<string>('market')

  const handleOpenApp = (screen: string = 'market') => {
    setInitialScreen(screen)
    setIsAppModalOpen(true)
  }

  const handleCloseApp = () => {
    setIsAppModalOpen(false)
  }

  const handleJumpToAuction = () => {
    const el = document.getElementById('auction-engine')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div id="top" className="site-canvas">
      {/* Background ambient lighting */}
      <div className="ambient-background" aria-hidden="true" />

      {/* Main Topbar */}
      <Header onOpenApp={handleOpenApp} />

      {/* Main Landing Sections */}
      <main className="main-content">
        <Hero onOpenApp={handleOpenApp} onJumpToAuction={handleJumpToAuction} />
        <AuctionVisualizer />
        <EnvelopeInspector />
        <CreditCalculator />
        <PipelineFlow />
        <TrustMatrix />
      </main>

      {/* Comprehensive Footer */}
      <Footer />

      {/* Interactive App Modal for Testing the 7 dApp Screens */}
      <AppModal
        isOpen={isAppModalOpen}
        onClose={handleCloseApp}
        initialScreen={initialScreen}
      />
    </div>
  )
}

export default App
