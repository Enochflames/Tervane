export type Theme = 'light' | 'dark'

export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyStoredTheme() {
  try {
    const t = localStorage.getItem('tervane-theme')
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  } catch { /* storage unavailable: follow the system */ }
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem('tervane-theme', t) } catch { /* ignore */ }
}
