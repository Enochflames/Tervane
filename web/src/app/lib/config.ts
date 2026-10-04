// App configuration. Addresses come from the one deployment file every component reads (CONTRACTS.md §6).
import dep from '../../../../deployments/monad-testnet.json'
import type { Address } from 'viem'

export const DEP = dep as unknown as {
  chainId: number; tervaneCore: Address; usdToken: Address; ethToken: Address; priceFeed: Address; treasury: Address
  deployBlock: number; escapeDelay: number; grace: number
}
export const CHAIN_ID = 10143
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787'
export const EXPLORER = 'https://testnet.monadscan.com'
export const DEMO_MODE = true // the deployment runs demo params (PROTOCOL-SPEC §2), so the 10-minute tenor exists

/** Monad charges the gas limit, not gas used: every write sets an explicit limit (CONTRACTS.md §5 + headroom). */
export const GAS = {
  faucet: 150_000n, approve: 80_000n, deposit: 250_000n, requestWithdraw: 200_000n, submitIntent: 150_000n,
  activateEscape: 120_000n, exitAccount: 400_000n, escapeRepay: 600_000n, escapeLiquidate: 600_000n, claim: 200_000n,
} as const

export const TENOR_OPTIONS = [
  { id: 0, label: '7 days', seconds: 604_800 },
  { id: 1, label: '30 days', seconds: 2_592_000 },
  ...(DEMO_MODE ? [{ id: 2, label: '10 min (demo)', seconds: 600 }] : []),
]
