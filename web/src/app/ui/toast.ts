// Minimal toast store (Sonner-style API: call toast.show() from anywhere, render <Toaster /> once).
export type Tone = 'pending' | 'success' | 'error' | 'info'
export interface ToastItem { id: number; title: string; body?: string; tone: Tone; txHash?: string; ttl?: number }

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function arm(id: number, ttl?: number) {
  clearTimeout(timers.get(id))
  if (ttl) timers.set(id, setTimeout(() => toast.dismiss(id), ttl))
}

export const toast = {
  show(t: Omit<ToastItem, 'id'>): number {
    const id = ++seq
    items = [...items.slice(-3), { ...t, id }]
    arm(id, t.ttl)
    emit()
    return id
  },
  update(id: number, patch: Partial<Omit<ToastItem, 'id'>>) {
    items = items.map((t) => (t.id === id ? { ...t, ...patch } : t))
    arm(id, patch.ttl)
    emit()
  },
  dismiss(id: number) {
    items = items.filter((t) => t.id !== id)
    emit()
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  get: () => items,
}
