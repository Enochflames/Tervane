// Tervane `settle` workflow (CRE-WORKFLOW §1): one workflow, two confidential handlers.
//   index 0: log trigger on TervaneCore.InboxMessage with kind == INTENT (settle right after an intent)
//   index 1: cron heartbeat (30 s minimum)
// Both run the same epoch. Secrets, server HTTP and decrypted intents stay in the enclave; chain reads,
// report signing and the write cross to the DON via usingTheDons() and carry public data only.

import {
  CronCapability, EVMClient, HTTPClient, LATEST_BLOCK_NUMBER, Runner, TxStatus,
  bytesToBase64, bytesToHex, encodeCallMsg, getNetwork, handlerInTee, hexToBase64, text,
  type EVMLog, type TeeRuntime,
} from '@chainlink/cre-sdk'
import { KIND_INTENT } from '@tervane/core'
import { keccak256, padHex, toBytes, zeroAddress, type Hex } from 'viem'
import { configSchema, type Config } from './config'
import { settleEpoch, type SettlerIO, type Trigger } from './settle'

const INBOX_TOPIC0 = keccak256(toBytes('InboxMessage(uint64,uint8,address,uint8,uint256,bytes)'))
const KIND_INTENT_TOPIC = padHex(`0x0${KIND_INTENT}`, { size: 32 })
/** evm.v1alpha.ReceiverContractExecutionStatus.SUCCESS (not re-exported from the SDK root in 1.23). */
const RECEIVER_SUCCESS = 0

function evmClient(cfg: Config): EVMClient {
  const net = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainName, isTestnet: true })
  if (!net) throw new Error(`E_CHAIN unknown chain ${cfg.chainName}`)
  return new EVMClient(net.chainSelector.selector)
}

/** SettlerIO on the CRE runtime. HTTP and secrets use the TEE runtime; chain I/O uses the DON runtime. */
function makeIO(rt: TeeRuntime<Config>): SettlerIO {
  const cfg = rt.config
  const don = rt.usingTheDons()
  const evm = evmClient(cfg)
  const http = new HTTPClient()
  const auth = (bearer: string) => ({ authorization: { values: [`Bearer ${bearer}`] } })
  return {
    secrets(ids) {
      const got = rt.getSecrets(ids.map((id) => ({ id }))).result()
      const out: Record<string, string> = {}
      for (const id of ids) out[id] = got[id]?.value ?? ''
      return out
    },
    call(to, data) {
      const r = evm.callContract(don, { call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: LATEST_BLOCK_NUMBER }).result()
      return bytesToHex(r.data)
    },
    httpGet(url, bearer) {
      const r = http.sendRequest(rt, { url, method: 'GET', multiHeaders: auth(bearer) }).result()
      return { status: r.statusCode, body: text(r) }
    },
    httpPost(url, bearer, json) {
      const r = http.sendRequest(rt, {
        url, method: 'POST', body: bytesToBase64(new TextEncoder().encode(json)),
        multiHeaders: { ...auth(bearer), 'content-type': { values: ['application/json'] } },
      }).result()
      return { status: r.statusCode, body: text(r) }
    },
    writeReport(receiver, payload, gasLimit) {
      const report = don.report({ encodedPayload: hexToBase64(payload), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' }).result()
      const w = evm.writeReport(don, { receiver, report, gasConfig: { gasLimit: gasLimit.toString() } }).result()
      // The forwarder can succeed while the receiver reverted; both must be SUCCESS (O-13).
      const receiverOk = (w.receiverContractExecutionStatus ?? RECEIVER_SUCCESS) === RECEIVER_SUCCESS
      const ok = w.txStatus === TxStatus.SUCCESS && receiverOk
      const detail = `${TxStatus[w.txStatus]}${receiverOk ? '' : '/receiver-reverted'}${w.errorMessage ? `:${w.errorMessage}` : ''}`
      return { ok, txHash: w.txHash && w.txHash.length ? (bytesToHex(w.txHash) as Hex) : undefined, detail }
    },
    nowSeconds: () => BigInt(Math.floor(rt.now().getTime() / 1000)),
    log(msg) {
      if (cfg.debugLogs) rt.log(msg) // codes and counts only (CLAUDE.md §3.2)
    },
  }
}

const run = (trigger: Trigger) => (rt: TeeRuntime<Config>): string => settleEpoch(makeIO(rt), rt.config, trigger)

function initWorkflow(cfg: Config) {
  const evm = evmClient(cfg)
  return [
    handlerInTee(
      evm.logTrigger({
        addresses: [hexToBase64(cfg.coreAddress)],
        topics: [{ values: [hexToBase64(INBOX_TOPIC0)] }, { values: [] }, { values: [hexToBase64(KIND_INTENT_TOPIC)] }],
      }),
      (rt: TeeRuntime<Config>, _log: EVMLog) => run('log')(rt),
      {},
    ),
    handlerInTee(new CronCapability().trigger({ schedule: cfg.cronSchedule }), (rt: TeeRuntime<Config>) => run('cron')(rt), {}),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
