// One settlement epoch (CRE-WORKFLOW §4, ARCHITECTURE §4.3). Runs inside the TEE handler through `SettlerIO`,
// which main.ts implements on the CRE runtime and main.test.ts fakes. Order matters: verify everything,
// run the pure transition, POST the diff, and only then write the report. Any failure throws before a write.

import {
  TervaneError, addr, coreAbi, encodeEpochDiff, encodeReport, erc20Abi, feedAbi, decodeEpochInput, makeDecryptor,
  runEpoch, writeGasLimit, type Address, type Hex,
} from '@tervane/core'
import { decodeFunctionResult, encodeFunctionData, type Abi } from 'viem'
import type { Config } from './config'

export interface HttpResult { status: number; body: string }
export interface WriteResult { ok: boolean; txHash?: Hex; detail: string }

/** Everything the epoch needs from the outside world. Only `secrets`, `httpGet`, `httpPost` run in the enclave. */
export interface SettlerIO {
  secrets(ids: readonly string[]): Record<string, string>
  /** eth_call at the latest block, through the DON (public data only). */
  call(to: Address, data: Hex): Hex
  httpGet(url: string, bearer: string): HttpResult
  httpPost(url: string, bearer: string, json: string): HttpResult
  /** Generates the DON report from the ABI payload and writes it via the forwarder. */
  writeReport(receiver: Address, payload: Hex, gasLimit: bigint): WriteResult
  nowSeconds(): bigint
  /** Debug log; implementations drop it unless config.debugLogs. Codes and counts only. */
  log(msg: string): void
}

export type Trigger = 'log' | 'cron'

function reader(io: SettlerIO) {
  return <T>(to: string, abi: Abi, functionName: string, args: readonly unknown[] = []): T => {
    const data = encodeFunctionData({ abi, functionName, args } as never)
    return decodeFunctionResult({ abi, functionName, data: io.call(addr(to), data) } as never) as T
  }
}

interface SettlementState {
  stateRoot: Hex; lastEpoch: bigint; cursor: bigint; inboxCount: bigint
  lastSettleAt: bigint; escaped: boolean; lastAsOf: bigint; lastPriceRoundId: bigint
}
interface Params { grace: bigint; escapeDelay: bigint; maxSkew: bigint; maxPriceAge: bigint }

/** Returns the tx hash, `"no-tx"` for a dry-run simulation, or `"escaped"`. */
export function settleEpoch(io: SettlerIO, cfg: Config, trigger: Trigger): string {
  const read = reader(io)
  const core = addr(cfg.coreAddress)

  // 1) Secrets, decrypted only inside the enclave. One batch call (limit 5/execution).
  const s = io.secrets(['ENCLAVE_SK', 'SERVER_API_KEY'])
  const enclaveSk = s.ENCLAVE_SK, apiKey = s.SERVER_API_KEY
  if (!enclaveSk || !apiKey) throw new TervaneError('E_CHAIN', 'missing secret')

  // 2) Public chain reads (7 of 15 per execution in total).
  const st = read<SettlementState>(core, coreAbi, 'settlementState')
  if (st.escaped) { io.log(`trigger=${trigger} escaped`); return 'escaped' }
  const params = read<Params>(core, coreAbi, 'params')
  const accCursor = read<Hex>(core, coreAbi, 'inboxAcc', [st.cursor])

  // 3) Prior state + inbox window from the server, requested from inside the enclave.
  const res = io.httpGet(`${cfg.serverUrl}/internal/epoch-input?cursor=${st.cursor}&limit=${cfg.maxInboxPerEpoch}`, apiKey)
  if (res.status !== 200) throw new TervaneError('E_SERVER', String(res.status))
  const input = decodeEpochInput(res.body)
  if (input.inboxTo < st.cursor || input.inboxTo > st.inboxCount) throw new TervaneError('E_INBOX_MISMATCH', 'window')

  // 4) Public price + solvency inputs.
  const accTo = read<Hex>(core, coreAbi, 'inboxAcc', [input.inboxTo])
  const [roundId, answer, , updatedAt] = read<readonly [bigint, bigint, bigint, bigint, bigint]>(cfg.priceFeedAddress, feedAbi, 'latestRoundData')
  const asOf = io.nowSeconds()
  if (answer <= 0n || (asOf > updatedAt && asOf - updatedAt > params.maxPriceAge)) throw new TervaneError('E_PRICE', 'stale')
  const usd = read<bigint>(cfg.usdTokenAddress, erc20Abi, 'balanceOf', [core])
  const eth = read<bigint>(cfg.ethTokenAddress, erc20Abi, 'balanceOf', [core])

  // 5–6) Pure transition: verifies root/cursor/accumulator/blob hashes, decrypts, auctions, liquidates.
  const out = runEpoch({
    prev: input.prev, inboxTo: input.inboxTo, messages: input.messages, openOrderBlobs: input.openOrderBlobs,
    onchain: { stateRoot: st.stateRoot, cursor: st.cursor, accCursor, accTo },
    decrypt: makeDecryptor(enclaveSk as Hex, BigInt(cfg.chainId), core),
    price: answer, priceRoundId: roundId, asOf, params: { grace: params.grace },
    treasury: addr(cfg.treasuryAddress), demoMode: cfg.demoMode, onchainBalances: { usd, eth },
  })

  // 7) Persist the diff BEFORE writing (ARCHITECTURE §4.3): the server must be able to reconstruct newRoot.
  const post = io.httpPost(`${cfg.serverUrl}/internal/epoch-output`, apiKey, encodeEpochDiff(out.diff))
  if (post.status !== 200) throw new TervaneError('E_SERVER_POST', String(post.status))

  // 8) Report + write through the DON with a limit sized to this report (D-22).
  const payload = encodeReport(out.report)
  const g = cfg.writeGas
  const gasLimit = writeGasLimit(out.report, (payload.length - 2) / 2, {
    base: BigInt(g.base), perPayout: BigInt(g.perPayout), perClear: BigInt(g.perClear), overheadBytes: BigInt(g.overheadBytes),
    perByte: BigInt(g.perByte), headroomBps: BigInt(g.headroomBps), max: BigInt(g.max),
  })
  const w = io.writeReport(core, payload, gasLimit)
  const st8 = out.stats
  io.log(`trigger=${trigger} epoch=${out.report.epoch} msgs=${st8.ingested} intents=${st8.intents} rejected=${Object.keys(st8.rejected).sort().reduce((a, k) => a + (st8.rejected[k as keyof typeof st8.rejected] ?? 0), 0)} fills=${st8.fills} clears=${st8.clears} liq=${st8.liquidations} payouts=${out.report.payouts.length} gasLimit=${gasLimit} write=${w.detail}`)
  if (!w.ok) throw new TervaneError('E_WRITE', w.detail)
  return w.txHash ?? 'no-tx'
}
