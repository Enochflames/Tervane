// Workflow config (CRE-WORKFLOW §3.4). Public values only: source and config are not confidential.
import { z } from 'zod'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const uint = z.string().regex(/^[0-9]+$/)

export const configSchema = z.object({
  chainName: z.string(),
  chainId: uint,
  coreAddress: address,
  priceFeedAddress: address,
  usdTokenAddress: address,
  ethTokenAddress: address,
  treasuryAddress: address,
  serverUrl: z.string().regex(/^https?:\/\/[^\s/]+/), // zod .url() relies on the URL global, absent in QuickJS
  cronSchedule: z.string(),
  maxInboxPerEpoch: z.number().int().min(1).max(200),
  /** D-22 per-epoch gas limit constants (CONTRACTS.md §5). */
  writeGas: z.object({
    base: uint, perPayout: uint, perClear: uint, overheadBytes: uint, perByte: uint, headroomBps: uint, max: uint,
  }),
  demoMode: z.boolean(),
  /** Gates every runtime.log in the TEE handler. Never log payloads or rates even when true. */
  debugLogs: z.boolean(),
})

export type Config = z.infer<typeof configSchema>
