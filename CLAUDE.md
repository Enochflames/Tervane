# CLAUDE.md — Tervane

You are building **Tervane**: a private fixed-rate lending market on **Monad**, settled by a **Chainlink CRE Confidential Workflow**. Lenders and borrowers submit **fully encrypted intents**; a TEE-hosted settlement engine decrypts them, runs a **sealed-bid uniform-price call auction** per tenor, maintains an **offchain ledger committed onchain as a Merkle root**, and writes one signed **settlement report** per epoch to the `TervaneCore` contract. If CRE stops settling, an **escape hatch** lets everyone exit against the last committed root.

Targets: Monad Metropolis (Track 01 — Onchain Finance & Trading) + Chainlink sponsor bounty "Best workflow with CRE". The CRE bounty accepts a **CLI simulation** (`cre workflow simulate`) as proof; we simulate with `--broadcast` so reports land on Monad testnet for real.

Read this file fully before touching code. Then read the doc for the layer you are working on. The docs are the spec; code that disagrees with `docs/PROTOCOL-SPEC.md` is wrong, not the doc. If you believe the spec is wrong, stop, write the problem into `docs/DECISIONS.md` under "Open", and ask.

---

## 1. Doc map (read order)

| Doc | Purpose | Read when |
|---|---|---|
| `docs/ARCHITECTURE.md` | Trust domains, components, every data flow end-to-end, state machine | Always, first |
| `docs/PROTOCOL-SPEC.md` | **Byte-exact source of truth**: encodings, crypto, ledger, Merkle, auction, interest, tiers, liquidation, report ABI, invariants | Before writing any TS/Solidity that touches protocol data |
| `docs/CRE-WORKFLOW.md` | The settler workflow: CRE SDK APIs, TEE rules, config, secrets, quotas, simulation commands | Working in `settler/` |
| `docs/CONTRACTS.md` | `TervaneCore`, tokens, mock feed, storage, checks, escape hatch, Foundry tests | Working in `contracts/` |
| `docs/SERVER.md` | Hono/Bun indexer + state store + proof service + auth | Working in `server/` |
| `docs/CLIENT.md` | Web app flows, client-side encryption, local rate memory | Working in `web/` |
| `docs/THREAT-MODEL.md` | Adversaries, trust assumptions, claims we may and may not make | Before writing any user-facing copy, README, or submission text |
| `docs/BUILD-PLAN.md` | Phases, spikes, acceptance gates, cut lines | Choosing what to do next |
| `docs/DECISIONS.md` | ADRs, deviations from the public write-up, open questions | When something feels arbitrary |
| `docs/DEMO-SCRIPT.md` | 2-minute video script + extended judge walkthrough + preflight + Track 01 positioning | Building demo tooling, before recording, writing submission copy |

---

## 2. Repository layout (target)

```
tervane/
├── CLAUDE.md
├── docs/                         # specs (this set)
├── packages/core/                # PURE TS shared by settler, server, web, tests
│   ├── src/abi.ts                # Solidity ABIs + viem encode/decode for every struct
│   ├── src/crypto.ts             # ECIES (noble) encrypt/decrypt, AAD builder
│   ├── src/ledger.ts             # ledger types + state transition (ingest/match/accrue/liquidate/withdraw)
│   ├── src/auction.ts            # uniform-price call auction (pure)
│   ├── src/merkle.ts             # leaf encoding + OZ-compatible tree + proofs
│   ├── src/math.ts               # bigint fixed-point helpers, rounding rules
│   ├── src/params.ts             # tiers, tenors, ratios (mirrors contract constants)
│   └── test/                     # bun test: golden vectors, property tests
├── contracts/                    # Foundry (Monad Foundry)
│   ├── src/TervaneCore.sol
│   ├── src/TestToken.sol
│   ├── src/MockV3Aggregator.sol
│   ├── src/cre/ReceiverTemplate.sol  # vendored from Chainlink docs, unmodified
│   ├── test/                     # unit, fuzz, invariant, golden-vector parity
│   └── script/Deploy.s.sol
├── settler/                      # CRE project (cre CLI root)
│   ├── project.yaml
│   ├── secrets.yaml
│   ├── .env.example
│   └── settle/                   # the single workflow
│       ├── main.ts
│       ├── workflow.yaml
│       ├── config.staging.json
│       ├── config.production.json
│       └── package.json
├── server/                       # Bun + Hono + bun:sqlite
├── web/                          # Vite + React + wagmi/viem
└── scripts/                      # demo + ops scripts (bun)
```

`packages/core` is the heart. The settler, the server, and the tests import the **same** transition and Merkle code. This is what makes the server's root check and the contract's proof checks agree with the enclave byte-for-byte.

---

## 3. Non-negotiables (violating any of these is a bug)

1. **No plaintext rate ever leaves the enclave.** Not in logs, reports, HTTP bodies, state diffs, errors, or metrics. Rates exist in plaintext only inside the `handlerInTee` callback's memory. The only rate that leaves is the per-tenor **clearing rate**, by design.
2. **No `runtime.log` inside the TEE handler in production config.** Gate every log behind `config.debugLogs === true`, and never log decrypted payloads even in debug. The CRE docs explicitly warn that anything logged inside a confidential handler can leak.
3. **Determinism.** The state transition is a pure function `(prevState, inbox, payloads, price, asOf, params) → (newState, report)`. No `Date.now()`, no `Math.random()`, no floats in money math, no iteration over unordered maps without sorting. Use `runtime.now()` once and pass it down. All amounts are `bigint`.
4. **One rounding policy** (see `PROTOCOL-SPEC.md §9`): amounts owed round **up**, amounts paid out round **down**, dust goes to a deterministic recipient. Never improvise rounding locally.
5. **The enclave public key comes from the chain**, never from the server. Clients read `TervaneCore.enclavePubKey()`. A server that could serve its own key could decrypt every bid.
6. **Every report is guarded onchain** by: forwarder check (ReceiverTemplate), epoch sequencing, `prevRoot == stateRoot`, inbox accumulator match, price-round verification against the feed, `asOf` skew window, and per-recipient withdrawal ceilings. Do not "temporarily" disable any of them.
7. **`packages/core` is QuickJS-safe.** No `node:*` imports, no `Buffer` reliance in core logic (convert at the edges), no WebCrypto. Use `@noble/*` v2 (`.js` import suffixes) and `viem` for ABI/keccak. If a dependency is not proven in `cre workflow simulate`, it does not go into core.
8. **Solidity mirrors TS constants exactly.** Any change to `params.ts` requires the same change in `TervaneCore.sol` and a passing parity test.
9. **No secrets in git.** `.env`, `secrets.yaml` values, private keys, API keys stay out. `.env.example` lists names only.
10. **Clean-room.** Ghost Finance (`snehendu098/ghost`, Apache-2.0) is public prior art with the same core concept. Do not copy code, text, or docs from it. Cite it in the README as prior art. Hackathon rules require that submitted work was built during the build window.

---

## 4. Stack and versions (pin these; verify before upgrading)

| Thing | Version / value | Note |
|---|---|---|
| CRE CLI | ≥ 1.30.0 (latest 1.36.0 as of 2026-10-01) | 1.30.0 added Monad testnet simulation |
| `@chainlink/cre-sdk` | 1.23.0 | Monad testnet chain constants landed in 1.19.0 |
| Bun | latest | runtime for server, scripts, tests, CRE TS build |
| `@noble/curves`, `@noble/hashes`, `@noble/ciphers` | 2.4.0 | v2 is ESM-only; import paths end in `.js` |
| viem | 2.57.x | ABI encode/decode, keccak, chain defs |
| hono | 4.13.x | server |
| Foundry | ≥ 1.8 (mainline; verified 1.8.4) with `network = "monad"` in `foundry.toml` | applies Monad gas model locally; `foundryup --network monad` is deprecated and ignored (S7/O-7). `--network monad` works on `forge test`/`forge script`, not `forge build`/`forge create` |
| Solidity | ^0.8.26 | OpenZeppelin v5 (`Ownable`, `MerkleProof`, `SafeERC20`) |
| Chain | Monad Testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz` | CRE chain name `monad-testnet` |
| CRE simulation forwarder (Monad testnet) | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` (MockKeystoneForwarder) | verify with `cre workflow supported-chains` |
| CRE production forwarder (Monad testnet) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (KeystoneForwarder) | only for real deployment |

Install the official CRE agent skill once, then reference it when writing workflow code:

```bash
npx skills add https://github.com/smartcontractkit/chainlink-agent-skills --skill chainlink-cre-skill
```

Use it as `/chainlink-cre-skill` for SDK questions. The CRE docs also ship a single-file TS reference at `https://docs.chain.link/cre/ts/llms-full.txt`; grep it before guessing an API.

---

## 5. How to work in this repo

**Spike before build.** `docs/BUILD-PLAN.md` Phase 0 lists seven spikes (TEE handler on Monad testnet, noble ECIES in WASM, broadcast write through the mock forwarder, log trigger replay, HTTP from TEE to local server, workspace bundling, chain availability). Do them first, each in a throwaway folder, and record the outcome in `docs/DECISIONS.md`. Do not build features on an assumption a spike can settle in minutes.

**Verify, don't recall.** CRE is moving fast (the CLI shipped seven minor versions in two months). When an SDK name, flag, or limit matters, check the docs or the installed package's types. If the docs and the types disagree, the installed types win; note the discrepancy.

**Golden vectors are the contract between languages.** Every encoding (`IntentPayload`, leaves, `SettlementReport`, accumulator steps, ECIES with a fixed ephemeral key) has a fixture under `packages/core/test/vectors/*.json`, generated by TS and consumed by Foundry tests via `vm.readFile` + `vm.parseJson`. If TS and Solidity disagree, the vector test fails before the demo does.

**Commit in layers.** core → contracts → settler → server → web → scripts. Never let a higher layer paper over a lower-layer bug.

**Error handling is not optional.** Every external call (HTTP, EVM read, write) checks status and throws a typed error with a stable code (`E_ROOT_MISMATCH`, `E_INBOX_GAP`, `E_PRICE_STALE`, ...). Any failure in the settler aborts the epoch without writing; the next trigger retries from the same onchain state. That is safe because every transition is idempotent against `prevRoot`.

---

## 6. Commands (fill in as they are verified)

```bash
# core
cd packages/core && bun install && bun test

# contracts
cd contracts && forge build && forge test -vvv
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast

# server
cd server && bun install && bun run dev          # :8787

# settler — simulate a single epoch from the cron handler, broadcasting to Monad testnet
cd settler && cre workflow simulate settle --target staging-settings \
  --non-interactive --trigger-index 1 --broadcast

# settler — replay a specific IntentSubmitted log (log-trigger handler)
cre workflow simulate settle --target staging-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash 0x<tx> --evm-event-index 0 --broadcast

# web
cd web && bun install && bun run dev

# demo
bun scripts/demo/00-preflight.ts
```

---

## 7. Definition of done (per feature)

A feature is done when: the spec section it implements is cited in the PR/commit message; unit tests and golden vectors pass in both TS and Solidity; the feature works in `cre workflow simulate --broadcast` against Monad testnet; no plaintext rate appears in any captured output (`scripts/audit-leaks.ts` greps logs, DB, and HTTP captures for every bid rate used in the run); and `docs/` reflects any decision you made.

---

## 8. Things that will bite you (known sharp edges)

- **Cron minimum interval is 30 s.** Anything faster is rejected. The epoch is therefore ≥ 30 s; the log trigger exists to settle sooner after an intent.
- **Monad charges gas on `gas_limit`, not gas used, and has no refunds.** Set `gasConfig.gasLimit` in `writeReport` deliberately (measure with Monad Foundry, add ~20%), not to a huge default. Receipts report `gasUsed == gasLimit`, so measure real usage with `debug_traceTransaction` (callTracer) or forge gas reports (S3: ≈109k used vs 300k charged). In simulation the report tx is sent and paid by the `CRE_ETH_PRIVATE_KEY` EOA.
- **`writeReport` without `--broadcast` returns `TX_STATUS_SUCCESS` and no `txHash`.** Never substitute a zero hash; treat a missing hash as "no transaction".
- **Log replay indices differ.** `--evm-event-index` is the log's position within the tx receipt; `EVMLog.index` in the payload is the block-level log index.
- **Workspace imports.** `settler/settle` is a root workspace member and imports `@tervane/core` via `workspace:*`; `cre-compile` typechecks core with the settler's tsconfig, so relative imports inside core are extensionless (D-18).
- **`MockKeystoneForwarder` delivers no workflow metadata.** In simulation, do not configure `setExpectedWorkflowId/Author/Name` on `TervaneCore`, or every report reverts. Production deploy re-points the forwarder and sets the workflow id.
- **Inside `handlerInTee`, use `new HTTPClient().sendRequest(teeRuntime, …)`.** `ConfidentialHTTPClient` has no `TeeRuntime` overload. Chain reads and writes go through `runtime.usingTheDons()` and are not confidential (they don't need to be).
- **Log-trigger addresses and topics must be base64** via `hexToBase64()`; indexed topic values must be padded to 32 bytes first.
- **Quotas that shape the design:** 15 HTTP calls, 15 chain reads, 5 secret fetches per execution; HTTP request ≤ 120 KB and response ≤ 250 KB; report ≤ 50 KB; execution ≤ 5 min; WASM memory 100 MB; log event ≤ 5 KB. The state-diff protocol and the inbox page size exist because of these.
- **Monad nodes don't serve arbitrary historical state.** The server indexes logs forward from the deploy block and keeps its own copy; never design a flow that needs `eth_call` at an old block.
- **Confidential Workflows is a private beta.** Simulation works without enrollment; production deploy needs it. Request access early (form linked from the CRE docs) but never block on it.
