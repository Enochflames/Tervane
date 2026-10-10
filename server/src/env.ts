// zod-validated environment (SERVER.md §1). INTERNAL_API_KEY is the enclave's bearer secret; never logged.
import { z } from 'zod'
import { join } from 'node:path'

const schema = z.object({
  MONAD_TESTNET_RPC: z.string().url().default('https://testnet-rpc.monad.xyz'),
  /** Comma-separated fallbacks, used only when the primary fails (public reads: logs and calls). '' disables. */
  MONAD_TESTNET_RPC_FALLBACKS: z.string().default('https://rpc-testnet.monadinfra.com,https://monad-testnet.drpc.org'),
  INTERNAL_API_KEY: z.string().min(32),
  PORT: z.coerce.number().int().default(8787),
  DB_PATH: z.string().default(join(import.meta.dir, '..', 'data', 'tervane.db')),
  DEPLOYMENT_FILE: z.string().default(join(import.meta.dir, '..', '..', 'deployments', 'monad-testnet.json')),
  /** Allowed browser origins for /v1, comma-separated (e.g. http://localhost:5173,https://tervane.vercel.app). */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  POLL_MS: z.coerce.number().int().default(1000),
  /** Monad's public RPC caps eth_getLogs at 100 blocks. */
  LOG_RANGE: z.coerce.number().int().min(1).max(100).default(100),
  /** Pages fetched in parallel while catching up (each ≤ LOG_RANGE blocks), applied strictly in order. */
  LOG_PARALLEL: z.coerce.number().int().min(1).max(16).default(6),
  /** How long /internal/epoch-input waits for the indexer to reach the chain's inboxCount before serving what it has. */
  INDEX_WAIT_MS: z.coerce.number().int().min(0).default(8000),
})

export type Env = z.infer<typeof schema>
export const loadEnv = (src: Record<string, string | undefined> = process.env): Env => schema.parse(src)

export interface Deployment {
  chainId: number
  tervaneCore: `0x${string}`
  usdToken: `0x${string}`
  ethToken: `0x${string}`
  priceFeed: `0x${string}`
  treasury: `0x${string}`
  deployBlock: number
  genesisRoot: `0x${string}`
}

export async function loadDeployment(path: string): Promise<Deployment> {
  return (await Bun.file(path).json()) as Deployment
}
