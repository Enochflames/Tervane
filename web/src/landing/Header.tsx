import { useEffect, useState } from 'react'
import { ButtonLink } from '../components/Button'
import { Wordmark } from '../components/Wordmark'
import { REPO } from '../data/testnet'
import { currentTheme, setTheme, type Theme } from '../lib/theme'
import './header.css'

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#auction', label: 'Auction' },
  { href: '#credit', label: 'Credit' },
  { href: '#trust', label: 'Trust' },
  { href: '#testnet', label: 'Testnet' },
]

export function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [theme, setT] = useState<Theme>('light')
  useEffect(() => {
    setT(currentTheme())
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const toggle = () => { const t = theme === 'dark' ? 'light' : 'dark'; setTheme(t); setT(t) }
  return (
    <header className="hdr" data-scrolled={scrolled}>
      <div className="container hdr-inner">
        <a href="#top" className="hdr-brand" aria-label="Tervane home"><Wordmark /></a>
        <nav className="hdr-nav" aria-label="Sections">
          {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
        </nav>
        <div className="hdr-actions">
          <button className="hdr-icon" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            )}
          </button>
          <a className="hdr-icon" href={REPO} target="_blank" rel="noreferrer" aria-label="Source on GitHub">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2Z" /></svg>
          </a>
          <ButtonLink href="/app" size="sm">Launch app</ButtonLink>
        </div>
      </div>
    </header>
  )
}
