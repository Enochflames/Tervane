import { useEffect, useState } from 'react'
import { load, type LocalIntent, type CachedProof } from '../lib/storage'

/** This device's memory of the user's own intents (with their rates) and last proof bundle. */
export function useLocal(account: string | undefined) {
  const read = () => (account ? load(account) : { nonce: '0', intents: [] as LocalIntent[], proof: undefined as CachedProof | undefined })
  const [s, setS] = useState(read)
  useEffect(() => {
    setS(read())
    const on = (e: Event) => { if (!account || (e as CustomEvent).detail === account.toLowerCase()) setS(read()) }
    window.addEventListener('tervane-storage', on)
    return () => window.removeEventListener('tervane-storage', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])
  const rateFor = (orderId: string) => s.intents.find((i) => i.inboxIndex === orderId)?.rateBps
  return { ...s, rateFor }
}
