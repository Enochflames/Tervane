import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './button.css'

type Variant = 'primary' | 'secondary' | 'quiet'
interface Common { variant?: Variant; size?: 'md' | 'sm'; children: ReactNode; trailing?: ReactNode }

export function Button({ variant = 'primary', size = 'md', trailing, children, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="btn" data-variant={variant} data-size={size} {...rest}>
      <span>{children}</span>
      {trailing}
    </button>
  )
}

/** Internal routes use the router; anything with a scheme or a hash is a plain anchor. */
export function ButtonLink({ variant = 'primary', size = 'md', trailing, children, href, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const internal = href.startsWith('/') && !href.startsWith('//')
  const props = { className: 'btn', 'data-variant': variant, 'data-size': size }
  return internal ? (
    <Link to={href} {...props} {...rest}><span>{children}</span>{trailing}</Link>
  ) : (
    <a href={href} {...props} {...rest}><span>{children}</span>{trailing}</a>
  )
}

export const Arrow = () => (
  <svg className="btn-arrow" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
