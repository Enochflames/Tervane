import type { ReactNode } from 'react'

export function SectionHead({ index, kicker, title, children }: { index: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="sec-head">
      <p className="eyebrow" data-reveal><b>{index}</b> {kicker}</p>
      <h2 className="display sec-title" data-reveal style={{ ['--reveal-i' as string]: 1 }}>{title}</h2>
      {children && <div className="lede" data-reveal style={{ ['--reveal-i' as string]: 2 }}>{children}</div>}
    </header>
  )
}
