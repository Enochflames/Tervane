# Tervane — CRE Settlement Workflow (`settler/`)

This is the orchestration layer and the piece the Chainlink bounty judges. It must be obviously load-bearing: **no state change in Tervane happens except through a report this workflow produces.**

Primary references (check these before guessing an API):
- TS single-file docs: `https://docs.chain.link/cre/ts/llms-full.txt`
- Confidential Workflows guide (TS): `/cre/guides/workflow/using-confidential-workflows/making-workflow-confidential`
- Confidential Workflows SDK reference: `/cre/reference/sdk/confidential-workflows-client`
- Template to crib structure from: `smartcontractkit/cre-templates/starter-templates/confidential-workflows/ai-audit-firewall` (TEE → `usingTheDons()` → `report` → `writeReport` pattern)
- CRE agent skill: `/chainlink-cre-skill`

---

## 1. What the workflow is

One CRE project (`settler/`) with one workflow (`settle/`) registering two handlers, both confidential:

| Index | Trigger | Purpose |
|---|---|---|
| 0 | `evmClient.logTrigger` on `TervaneCore.InboxMessage` with `kind == INTENT` | Settle within seconds of a new intent |
| 1 | `CronCapability` `*/30 * * * * *` (30 s is the platform minimum) | Heartbeat; settles deposits, withdrawals, maturities, liquidations when no intents arrive |

Both handlers call `runEpoch(teeRuntime)`. The trigger payload is ignored beyond logging the trigger kind (in debug), because the epoch always processes the full contiguous inbox window from the onchain cursor. That makes the two triggers interchangeable and idempotent: if both fire for the same state, the second report reverts on `prevRoot != stateRoot` and nothing breaks.

---

## 2. Confidential execution rules (from the CRE docs, applied to Tervane)

- Register with `handlerInTee(trigger, fn, {})`. `fn` receives a `TeeRuntime<Config>`.
- `TeeConstraint`: `{}` (any TEE). As of the docs, Nitro in `us-west-2` is the only registered option; don't over-constrain.
- **Secrets** are fetched inside the enclave with `runtime.getSecrets([{ id: "ENCLAVE_SK" }, { id: "SERVER_API_KEY" }]).result()`. One batch call (the per-execution secret call limit is 5). No upfront declaration needed in TEE mode.
- **Outbound HTTP from inside the enclave:** `new HTTPClient().sendRequest(teeRuntime, req).result()`. Do **not** use `ConfidentialHTTPClient` here; it has no `TeeRuntime` overload and won't type-check. (Fix this wording anywhere it appears in submission copy.)
- **Chain reads, report generation, chain writes** go through `const don = runtime.usingTheDons()`. Anything passed to `don` leaves the enclave. Only pass public data: addresses, call data for public views, and the final report.
- **Logging:** `runtime.log` inside the TEE handler is gated by `config.debugLogs`. Never log a decrypted payload, a rate, or a ledger snapshot, even in debug. Log codes and counts only.
- **Source code is not confidential.** Workflow logic and binary are public by design. Confidentiality comes from the data (secrets, decrypted intents, intermediate values), so nothing secret may be embedded in code or config.

---

## 3. Project files

### 3.1 `settler/project.yaml`
```yaml
staging-settings:
  rpcs:
    - chain-name: monad-testnet
      url: ${MONAD_TESTNET_RPC}          # https://testnet-rpc.monad.xyz or a provider URL
production-settings:
  rpcs:
    - chain-name: monad-testnet
      url: ${MONAD_TESTNET_RPC}
# Fallback ONLY if spike S7 shows monad-testnet missing for this tenant:
# experimental-chains:
#   - chain-selector: <monad testnet selector from chain-selectors>
#     rpc-url: https://testnet-rpc.monad.xyz
#     forwarder: 0xB9F79d863261869B234c481D1f9A7af84AeAd192
```

### 3.2 `settler/settle/workflow.yaml`
```yaml
staging-settings:
  user-workflow:
    workflow-name: "tervane-settle-staging"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.staging.json"
    secrets-path: "../secrets.yaml"
production-settings:
  user-workflow:
    workflow-name: "tervane-settle"
  workflow-artifacts:
    workflow-path: "./main.ts"
    config-path: "./config.production.json"
    secrets-path: "../secrets.yaml"
```

### 3.3 `settler/secrets.yaml` (names only) and `.env`
```yaml
secretsNames:
  ENCLAVE_SK:
    - TERVANE_ENCLAVE_SK
  SERVER_API_KEY:
    - TERVANE_SERVER_API_KEY
```
```bash
# settler/.env  (never committed; .env.example lists the names)
CRE_ETH_PRIVATE_KEY=0x...          # funded with testnet MON; used by --broadcast
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
TERVANE_ENCLAVE_SK=0x...           # 32-byte secp256k1 secret; pubkey goes into TervaneCore
TERVANE_SERVER_API_KEY=...         # shared with server's INTERNAL_API_KEY
```
For deployed workflows the two secrets move to the Vault DON (`cre secrets create`; see "Using Secrets with Deployed Workflows").

### 3.4 Config (`config.staging.json`) + zod schema
```json
{
  "chainName": "monad-testnet",
  "coreAddress": "0x...",
  "priceFeedAddress": "0x...",
  "usdTokenAddress": "0x...",
  "ethTokenAddress": "0x...",
  "treasuryAddress": "0x...",
  "serverUrl": "http://localhost:8787",
  "cronSchedule": "*/30 * * * * *",
  "writeGas": { "base": "110500", "perPayout": "50000", "perClear": "4000", "overheadBytes": "1100", "perByte": "16", "headroomBps": "12000", "max": "2500000" },
  "maxInboxPerEpoch": 200,
  "demoMode": true,
  "debugLogs": true
}
```
Validate with zod in `Runner.newRunner<Config>({ configSchema })`. Config size limit is 50 KB; keep it small. Production config sets `debugLogs: false`, `demoMode: false`.

### 3.5 `package.json`
Dependencies: `@chainlink/cre-sdk@1.23.0`, `viem`, `zod`, `@noble/curves`, `@noble/hashes`, `@noble/ciphers` (all 2.4.0), and `"@tervane/core": "workspace:*"`. Spike S6 confirmed `cre-compile` bundles the workspace package (D-18); `settler/settle` is a root workspace member. Templates from `cre init` pin older SDK versions; always re-pin.

---

## 4. `main.ts` skeleton

This is a shape, not final code. Every SDK identifier below appears in the CRE docs/templates; still confirm against installed types.

> **As built (Phase 3, D-23):** the epoch body below lives in `settle/settle.ts` as `settleEpoch(io, cfg, trigger)` over a `SettlerIO` port; `settle/main.ts` implements the port on the runtime and registers both handlers; only `main()` is exported (Javy). The write is checked on both `txStatus` and `receiverContractExecutionStatus` (O-13), and the gas limit is sized per report (D-22). Treat the code below as the reference for *what* happens, and the files for *how*.

```ts
import {
  CronCapability, EVMClient, HTTPClient, Runner, handlerInTee, getNetwork,
  hexToBase64, bytesToHex, encodeCallMsg, TxStatus, LATEST_BLOCK_NUMBER,
  type TeeRuntime, type Runtime, type EVMLog, type CronPayload,
} from "@chainlink/cre-sdk"
import { keccak256, toBytes, padHex, encodeFunctionData, decodeFunctionResult, zeroAddress } from "viem"
import { z } from "zod"
import {
  coreAbi, feedAbi, erc20Abi, runEpoch, makeDecryptor, encodeReport, decodeEpochInput, encodeEpochDiff,
  TervaneError,
} from "@tervane/core"

const configSchema = z.object({ /* §3.4 fields */ })
type Config = z.infer<typeof configSchema>

const INBOX_TOPIC0 = keccak256(toBytes("InboxMessage(uint64,uint8,address,uint8,uint256,bytes)"))
const KIND_INTENT_TOPIC = padHex("0x02", { size: 32 })

function settle(runtime: TeeRuntime<Config>, triggerKind: "log" | "cron"): string {
  const cfg = runtime.config
  const dbg = (m: string) => { if (cfg.debugLogs) runtime.log(m) }   // codes/counts only

  // 1) Secrets — decrypted only inside the enclave.
  const s = runtime.getSecrets([{ id: "ENCLAVE_SK" }, { id: "SERVER_API_KEY" }]).result()
  const enclaveSk = s["ENCLAVE_SK"].value
  const apiKey = s["SERVER_API_KEY"].value

  // 2) Public chain reads via the DON runtime.
  const don = runtime.usingTheDons()
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName })
  if (!net) throw new TervaneError("E_CHAIN", cfg.chainName)
  const evm = new EVMClient(net.chainSelector.selector)
  const read = (to: string, abi: any, fn: string, args: unknown[] = []) => {
    const data = encodeFunctionData({ abi, functionName: fn, args })
    const r = evm.callContract(don, {
      call: encodeCallMsg({ from: zeroAddress, to: to as `0x${string}`, data }),
      blockNumber: LATEST_BLOCK_NUMBER,
    }).result()
    return decodeFunctionResult({ abi, functionName: fn, data: bytesToHex(r.data) })
  }
  const st = read(cfg.coreAddress, coreAbi, "settlementState")   // stateRoot,lastEpoch,cursor,inboxCount,lastSettleAt,escaped,lastAsOf,lastPriceRoundId
  if (st.escaped) return "escaped"
  const params = read(cfg.coreAddress, coreAbi, "params")         // grace, escapeDelay, maxSkew, maxPriceAge
  const accCursor = read(cfg.coreAddress, coreAbi, "inboxAcc", [st.cursor])

  // 3) Pull prior state + inbox window from the server, from inside the enclave.
  const http = new HTTPClient()
  const res = http.sendRequest(runtime, {
    url: `${cfg.serverUrl}/internal/epoch-input?cursor=${st.cursor}&limit=${cfg.maxInboxPerEpoch}`,
    method: "GET",
    multiHeaders: { authorization: { values: [`Bearer ${apiKey}`] } },   // `headers` is deprecated in SDK 1.23
  }).result()
  if (res.statusCode !== 200) throw new TervaneError("E_SERVER", String(res.statusCode))
  const input = decodeEpochInput(new TextDecoder().decode(res.body))

  // 4) Public price + solvency inputs.
  const to = input.inboxTo
  const accTo = read(cfg.coreAddress, coreAbi, "inboxAcc", [to])
  const [roundId, answer, , updatedAt] = read(cfg.priceFeedAddress, feedAbi, "latestRoundData")
  const asOf = BigInt(Math.floor(runtime.now().getTime() / 1000))   // now(): Date (verified, SDK 1.23)
  if (answer <= 0n || asOf - updatedAt > params.maxPriceAge) throw new TervaneError("E_PRICE", "stale")
  const balUsd = read(cfg.usdTokenAddress, erc20Abi, "balanceOf", [cfg.coreAddress])
  const balEth = read(cfg.ethTokenAddress, erc20Abi, "balanceOf", [cfg.coreAddress])

  // 5–6) Pure, deterministic transition. runEpoch verifies root, cursor, accumulator and blob hashes
  //      itself (§12 step 1; D-19) and decrypts through the injected Decryptor; plaintext never escapes.
  const out = runEpoch({
    prev: input.prev, inboxTo: to, messages: input.messages, openOrderBlobs: input.openOrderBlobs,
    onchain: { stateRoot: st.stateRoot, cursor: st.cursor, accCursor, accTo },
    decrypt: makeDecryptor(enclaveSk, 10143n, cfg.coreAddress),
    price: answer, priceRoundId: roundId, asOf, params: { grace: params.grace },
    treasury: cfg.treasuryAddress, demoMode: cfg.demoMode,
    onchainBalances: { usd: balUsd, eth: balEth },
  })   // returns { state, diff, report, stats }; throws TervaneError (E_ROOT_MISMATCH, E_INBOX_MISMATCH, E_INVARIANT, …)

  // 7) Persist the diff BEFORE writing the report (ARCHITECTURE §4.3).
  const post = http.sendRequest(runtime, {
    url: `${cfg.serverUrl}/internal/epoch-output`,
    method: "POST",
    multiHeaders: { authorization: { values: [`Bearer ${apiKey}`] }, "content-type": { values: ["application/json"] } },
    body: Buffer.from(encodeEpochDiff(out.diff)).toString("base64"),
  }).result()
  if (post.statusCode !== 200) throw new TervaneError("E_SERVER_POST", String(post.statusCode))

  // 8) Report + write through the DON.
  const report = don.report({
    encodedPayload: hexToBase64(encodeReport(out.report)),
    encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256",
  }).result()
  const w = evm.writeReport(don, {
    receiver: cfg.coreAddress, report, gasConfig: { gasLimit: writeGasLimit(out.report, reportBytes, cfg.writeGas).toString() },   // D-22
  }).result()
  // the forwarder can succeed while the receiver reverted (O-13): check both
  if (w.txStatus !== TxStatus.SUCCESS || (w.receiverContractExecutionStatus ?? 0) !== 0) throw new TervaneError("E_WRITE", String(w.txStatus))
  dbg(`epoch=${out.report.epoch} msgs=${out.stats.ingested} fills=${out.stats.fills} liq=${out.stats.liquidations}`)
  return w.txHash ? bytesToHex(w.txHash) : "no-tx"   // dry-run simulation returns SUCCESS without a hash; never fabricate one
}

const initWorkflow = (cfg: Config) => {
  const net = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName })!
  const evm = new EVMClient(net.chainSelector.selector)
  return [
    handlerInTee(
      evm.logTrigger({
        addresses: [hexToBase64(cfg.coreAddress)],
        topics: [{ values: [hexToBase64(INBOX_TOPIC0)] }, { values: [] }, { values: [hexToBase64(KIND_INTENT_TOPIC)] }],
      }),
      (rt: TeeRuntime<Config>, _log: EVMLog) => settle(rt, "log"),
      {},
    ),
    handlerInTee(
      new CronCapability().trigger({ schedule: cfg.cronSchedule }),
      (rt: TeeRuntime<Config>, _p: CronPayload) => settle(rt, "cron"),
      {},
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
await main()
```

Notes on the skeleton:
- Topic layout: `InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender, …)` → topic1 = index, topic2 = kind, topic3 = sender. Filter on topic2. Topic values must be 32-byte padded and base64-encoded.
- `Buffer` appears only at the SDK edge (the templates use it); `packages/core` must not depend on it.
- `runtime.now()` return type: confirm from the installed SDK (Date vs Timestamp). Whatever it is, convert once to `bigint` seconds.
- Chain reads used: `settlementState`, `params`, `inboxAcc(cursor)`, `inboxAcc(to)`, `latestRoundData`, 2× `balanceOf` = **7 of 15** allowed. HTTP calls: **2 of 15**. Secret calls: **1 of 5**. Consensus calls: report generation only.
- `TervaneCore.settlementState()` and `params()` are single views returning tuples specifically to save reads.

---

## 5. Server contract for the enclave (wire format)

`GET /internal/epoch-input?cursor=C&limit=N` →
```jsonc
{
  "prev": { "meta": {...}, "accounts": [...], "orders": [...], "loans": [...] },   // state at onchain stateRoot
  "inboxTo": "C+k",                                     // ≤ C+N, ≤ indexed head
  "messages": [ { "index": "C+1", "kind": 2, "sender": "0x..", "asset": 0, "amount": "0",
                  "blobHash": "0x..", "blob": "0x.." }, ... ],
  "openOrderBlobs": { "<orderId>": "0x<350-byte blob>" }  // for every open order in prev
}
```
`POST /internal/epoch-output` body: `EpochDiff` (PROTOCOL-SPEC §7.4). Response 200 only after the server recomputed `newRoot` from `prevRoot` + diff and stored it as pending.

Size budget: response ≤ 250 KB, request ≤ 120 KB. At ~350 B per blob + ~300 B per state object, the demo scale is far below. If a real deployment approaches the limits, page the inbox (smaller `limit`) and move `prev` to a root-addressed snapshot fetched in chunks; the protocol doesn't change.

---

## 6. Failure semantics (every path is safe to retry)

| Failure | Behavior | Why it's safe |
|---|---|---|
| Server down / non-200 | throw before any write | onchain state unchanged; next trigger retries |
| `E_ROOT_MISMATCH` | throw | server is out of sync or lying; nothing written; alert |
| `E_INBOX_MISMATCH` | throw | withholding/altering a message halts settlement → escape hatch eventually |
| `E_PRICE_STALE` | throw | no settlement on bad prices; heartbeat stops → visible |
| `E_INVARIANT` | throw | a bug; never commit a broken state |
| POST ok, write reverts (e.g. concurrent epoch) | pending state orphaned; server GCs pending roots older than N epochs | onchain root unchanged |
| Write succeeds, server misses the event | server's indexer promotes on next poll; enclave's next GET verifies root anyway | pending stored before write |

Never catch-and-continue inside `runEpoch`. A partial epoch is worse than no epoch.

---

## 7. Simulation (the bounty deliverable)

Prerequisites: `cre login`; `CRE_ETH_PRIVATE_KEY` funded with testnet MON; `TervaneCore` deployed with the **mock forwarder** `0xB9F79d863261869B234c481D1f9A7af84AeAd192` (confirm via `cre workflow supported-chains`); no workflow-id/author/name checks configured (the mock forwarder supplies no metadata).

```bash
cd settler
# Cron handler (index 1): one full epoch, real tx on Monad testnet
cre workflow simulate settle --target staging-settings --non-interactive --trigger-index 1 --broadcast

# Log handler (index 0): replay the IntentSubmitted log from a specific tx
cre workflow simulate settle --target staging-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash 0x<submitIntent tx> --evm-event-index 0 --broadcast

# Live mode while developing: re-run on each matching log
cre workflow simulate settle --target staging-settings --listen --broadcast

# Engine internals when debugging
cre workflow simulate settle --target staging-settings --engine-logs -v
```

Without `--broadcast` the write is a dry run; useful for CI. With it, the report really lands and `EpochSettled` appears on the Monad explorer — show this in the video.

---

## 8. Testing strategy for the workflow

1. **Pure core tests** (`bun test` in `packages/core`): `runEpoch` with fixtures; golden vectors; property tests for I1–I4 and I8 using random books and random message sequences (fast-check is fine in tests; it never ships into the WASM).
2. **Workflow unit test** (`settle/main.test.ts`, pattern from templates): mock HTTP + EVM responses, assert the encoded report bytes for a fixed scenario equal `report.json`.
3. **Simulation smoke** (`scripts/sim-smoke.ts`): deploy fresh contracts, seed the demo book, run H0 and H1 with `--broadcast`, assert onchain `stateRoot` equals the server's committed root and the demo clear rate is 527 bps.
4. **Leak audit** (`scripts/audit-leaks.ts`): collect simulator stdout (with `-v` and `--engine-logs`), server DB dump, HTTP captures, tx calldata and logs; grep for every plaintext rate used in the run in the formats `525`, `0x20d`, `5.25`, and the uint32 big-endian bytes. The only allowed hits are the clearing rate inside `EpochSettled`/`Cleared` and the client's local storage.

---

## 9. Production deployment notes (beyond the hackathon)

- Requires Confidential Workflows beta enrollment (separate from regular deploy access). Request it early; simulation needs nothing.
- Re-point `TervaneCore` forwarder to `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (Monad testnet KeystoneForwarder) and set `setExpectedWorkflowId`.
- Move secrets to the Vault DON; set `debugLogs: false`.
- Private registry allows 3 workflows per org; Tervane uses 1.
