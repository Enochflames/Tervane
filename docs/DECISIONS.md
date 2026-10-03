# Tervane — Decisions (ADR log)

Format: context → decision → consequences. "Deviation" marks a change from the public write-up drafted earlier; those require the write-up to be updated (D-11). Append new decisions; never rewrite old ones (supersede them).

---

## Accepted

### D-1 Custody is our own contract on Monad, not the Compliant Private Transfer vault
**Context.** The Chainlink Compliant Private Transfer demo vault lives on Ethereum Sepolia and is driven by an external Chainlink-hosted API. Metropolis requires building on Monad. **Decision.** `TervaneCore` on Monad testnet holds funds; privacy of ledger movements comes from the offchain Merkle-committed ledger (D-6) instead of the vault's shielded balances. **Consequences.** Deposits and withdrawals are public (an ERC-20 into a public contract always is); everything between them is private. No dependency on a Sepolia-only service. *Deviation.*

### D-2 One workflow, two confidential handlers (log + 30 s cron)
**Context.** The write-up had three cron workflows at 30 s / 15 s / 60 s. CRE's fastest cron interval is 30 s, so 15 s is not possible; the private registry allows 3 workflows per org; three workflows writing to one contract means three identities and three ways to race. **Decision.** One `settle` workflow, `handlerInTee` on an `InboxMessage(kind=INTENT)` log trigger and on a 30 s cron, both running the full epoch transition. **Consequences.** One workflow id to pin onchain; a single state machine; matching happens within seconds of an intent instead of waiting for the next tick. *Deviation.*

### D-3 Outbound HTTP inside the enclave uses `HTTPClient` with the `TeeRuntime`
**Context.** `ConfidentialHTTPClient` has no `TeeRuntime` overload; the docs direct confidential handlers to `HTTPClient.sendRequest(teeRuntime, …)`, which executes inside the enclave. **Decision.** Use that. Secrets come from `runtime.getSecrets` inside the enclave. **Consequences.** Submission copy must stop saying "ConfidentialHTTPClient"; say "outbound requests and the server API key stay inside the enclave". *Deviation (wording).*

### D-4 Encrypt the whole intent, not only the rate
**Decision.** `IntentPayload` (action, tenor, rate, nonce, refs, amount, collateral) is fully encrypted; blobs are a fixed 350 bytes for every action. **Consequences.** The public chain learns only "address X submitted an intent". The server learns sizes only after the enclave writes them into the ledger.

### D-5 Onchain inbox with a hash-chained accumulator
**Decision.** All deposits, intents, and withdrawal requests are appended onchain; the enclave must ingest a contiguous prefix verified against `inboxAcc`. **Consequences.** The server can't censor one user or reorder; withholding halts everyone and triggers the escape hatch. Garbage intents are consumed as invalid, so they can't stall the system.

### D-6 Merkle-committed offchain ledger (validium-style)
**Decision.** Ledger = META + accounts + orders + loans; root committed every epoch; escape hatch exits by proof. **Consequences.** Server untrusted for integrity; users get exits; tier becomes a selectively disclosable credit attestation (`verifyAccount`). Costs: Merkle code in TS + Solidity, a data-availability assumption for exits.

### D-7 Sealed-bid uniform-price call auction; no proposals; no rejection penalty
**Context.** The write-up kept a match-proposal step with accept/reject and a 5% collateral penalty to stop probing. **Decision.** Borrowers submit a sealed, binding maximum rate. Each epoch, per tenor, borrows (whole-or-nothing, highest max first) fill from the cheapest lend slices; everyone matched trades at the marginal lend rate `r*`. **Consequences.** No free option exists, so the penalty is unnecessary; fewer user steps; simpler state machine. *Deviation — confirm with Lycantho (O-2).*

### D-8 Price via the AggregatorV3 interface; mock feed for the demo
**Context.** Data Streams needs separate credentials and a verifier flow; the demo must crash the price on command. **Decision.** The contract and enclave use `latestRoundData`/`getRoundData`; the demo deploys `MockV3Aggregator`; production points at a Chainlink ETH/USD feed on Monad. The contract verifies the report's price against `getRoundData(roundId)`. **Consequences.** Remove "Data Streams" from submission copy unless it is actually integrated. *Deviation.*

### D-9 Liquidation seizes at most owed + 10%
**Context.** The write-up gave lenders 95% of all seized collateral, which over-penalizes a maturity default with healthy collateral. **Decision.** `seized = min(collateral, owed × 1.10 / price)`; 5% of seized to treasury, 95% to lenders pro rata, remainder back to the borrower. **Consequences.** Lenders recover ~104.5% of owed when collateral suffices; borrowers aren't wiped out for being late. *Deviation (refinement).*

### D-10 Tier parameters
Open/liquidation ratios: Bronze 2.0/1.6, Silver 1.8/1.45, Gold 1.5/1.25, Platinum 1.3/1.15; progression by repaid **volume** (1k / 5k / 20k tUSD); outstanding cap grows with repaid volume; liquidation drops one tier and resets volume to the tier floor. `tierAtOpen` governs an open loan's liquidation threshold.

### D-11 Public write-up must change (do before submission)
Replace: "ConfidentialHTTPClient" → enclave-side HTTP (D-3); "three workflows on 30/15/60 s loops" → one workflow, event-triggered + 30 s heartbeat (D-2); "Chainlink Compliant Private Transfer Vault on Sepolia" → `TervaneCore` on Monad (D-1); "Data Streams" → price feed (D-8) unless integrated; "match proposals + 5% rejection penalty" → binding sealed max rate (D-7, if confirmed); "95% of seized" → D-9; "financial privacy shouldn't require trusting anyone" → THREAT-MODEL §5 language. Add: inbox accumulator, Merkle-committed ledger, escape hatch, selective-disclosure credit proofs.

### D-13 Enclave key generation is a trusted setup step
Workflows are stateless and secrets come from the Vault DON, so `ENCLAVE_SK` is generated outside the enclave. We disclose this and generate it offline. Roadmap: attested in-enclave key generation and rotation.

### D-14 Demo timing parameters
`GRACE = 60 s`, `ESCAPE_DELAY = 600 s`, demo tenor 10 min, `MAX_PRICE_AGE = 1 day` (mock feed updates only on demand). Production values in PROTOCOL-SPEC §2.

### D-16 Submit to Track 01 — Onchain Finance & Trading (supersedes the earlier Track 04 choice)
**Context.** Track 01 asks for new market structures and lists "lending priced on onchain credit history"; Tervane is a sealed-bid fixed-rate term market with credit tiers committed onchain. Track 04's examples (passkeys, ERC-8004, media provenance) would make Tervane's product a side story. **Decision.** Track 01 plus the Chainlink CRE bounty. **Consequences / pitch rules:**
- Lead with the market structure: sealed-bid uniform-price call auction for fixed-rate term loans, with a public per-tenor clearing rate (`Cleared`) as an onchain fixed-rate benchmark.
- Meet the "fully onchain order book" example head-on: an onchain book publishes every bid; Tervane matches offchain in an enclave and the chain enforces the result (accumulator, root, price round, payout ceilings).
- Say "credit history lowers collateral", never "undercollateralised" (Platinum still opens at 1.3×).
- Monad angles that are true: every intent is a cheap onchain write, which makes a censorship-resistant inbox affordable; each epoch settles in one transaction with sub-second finality; gas-limit charging is handled explicitly. Don't claim the 30 s epoch showcases Monad's speed.

### D-17 Demo bids use distinctive values
Rates 413 / 527 / 611 / 552 bps replace 410 / 525 / 600 / 550, because 600 collided with the demo tenor (600 s) and the 600 tUSD deposits, which would cause false hits in the leak audit.

### D-15 Interest is fixed for the full term; no protocol fee on interest
Term-loan semantics; early repayment pays full `owed`. Revenue comes only from the 5% liquidation fee. Revisit if tier farming (THREAT-MODEL A7) needs a cost.

---

## Proposed (P1)

### D-12 Per-epoch outflow cap
Cap total `paid` per asset per epoch at a fraction of holdings (e.g. 10%). Slows a drain after a TEE compromise (THREAT-MODEL A4). Requires one more check in `_processReport` and a queueing rule in the enclave (excess requests stay pending to the next epoch).

---

### D-18 `settler/settle` is a Bun workspace member; core uses extensionless relative imports (from S6)
**Context.** S6 showed `cre-compile` bundles `@tervane/core` through a Bun workspace link, but it typechecks core's sources with the settler's tsconfig (`moduleResolution: bundler`, no `allowImportingTsExtensions`). **Decision.** Add `settler/settle` to the root `workspaces` and depend on `"@tervane/core": "workspace:*"`; relative imports inside `packages/core` omit the `.ts` suffix (package subpath imports such as `@noble/curves/secp256k1.js` keep `.js`). **Consequences.** One install at the root; no relative-path import into core; CRE-WORKFLOW §3.5's fallback is not needed. *Accepted 2026-10-03 (go-ahead for Phase 1).*

### D-19 `packages/core` implementation choices (Phase 1)
**Context.** Places where PROTOCOL-SPEC is silent and the code had to pick. **Decision.**
- `runEpoch` takes a `Decryptor` (`makeDecryptor(enclaveSk, chainId, core)`), not the raw `ENCLAVE_SK`, and performs §12 step 1 itself (root, cursor, accumulator, INTENT blob hashes, open-order blob hashes). The settler passes `onchain = {stateRoot, cursor, inboxAcc[cursor], inboxAcc[to]}`; CRE-WORKFLOW §4's separate `merkleRoot`/`verifyInbox` calls in `main.ts` become redundant (kept exported for the server).
- Fatal codes: `E_ROOT_MISMATCH`, `E_INBOX_MISMATCH`, `E_BLOB_MISMATCH` (open-order blob missing or hash differs), `E_PRICE` (price ≤ 0), `E_INVARIANT`, `E_DECODE` (wire JSON). Intent-level codes are counted in `stats.rejected` only.
- Accounts are created by a DEPOSIT, by an intent that passes decryption + version/action + nonce (the nonce must persist), and for the treasury on its first fee. A WITHDRAW from an unknown address yields a `paid = 0` payout without creating an account.
- DEPOSIT/WITHDRAW with an asset outside {0, 1} credit nothing / pay 0; `TervaneCore` must reject such assets onchain (Phase 2).
- Loans opened in an epoch are liquidation-checked in the same epoch's step 5 (they always pass, since every open ratio exceeds its liquidation ratio).
- Property tests use a test-only cipher with the same blob shape and sender binding (keccak tag instead of AES-GCM) so 10,000-case runs are fast; ECIES itself is covered by unit tests, `ecies.json`, and the demo-book tests, which run on real ECIES.
- Core was re-proven in `cre workflow simulate`: the real `@tervane/core` compiled by `cre-compile` ran a full `runEpoch` (deposit + ECIES intent) in a TEE handler and produced root `0x2a6ea56b…49ebb4`, identical to Bun (38 ms in WASM).
**Consequences.** CRE-WORKFLOW §4 should call `runEpoch({ …, decrypt: makeDecryptor(enclaveSk, 10143n, core), onchain: {…} })`.

---

## Open (need Lycantho)

- **O-2 Confirm D-7** (drop proposals and the rejection penalty).
- **O-3 Price feed on Monad testnet.** Check Chainlink's feed directory for a Monad testnet ETH/USD feed. If one exists, show it in config as the production feed while the demo uses the mock.
- **O-4 Confidential Workflows beta access.** Submit the access request form now; the build does not depend on it.
- **O-6 `supported-chains` JSON shape (installed CLI wins).** CLI v1.36.0 returns `{chainName, chainSelector, address, mockAddress}` where `address` is the production KeystoneForwarder and `mockAddress` the MockKeystoneForwarder. The CRE changelog says the JSON has `chainName`, `chainSelector`, `address` (implying `address` = mock). Scripts must read `mockAddress` for simulation.
- **O-7 Monad Foundry install (installed tool wins).** `foundryup --network monad` is now "Deprecated and ignored; installs the regular Foundry release" (foundryup 1.9.3). Mainline Foundry ≥ 1.8 (installed: forge 1.8.4) has a `monad` network family: `network = "monad"` in `foundry.toml`, or `--network monad` on `forge test`/`forge script` (`forge build`/`forge create` don't take the flag). Forge 1.7.1 lacked it. CLAUDE.md §4 and §6 should say "Foundry ≥ 1.8 with `network = "monad"`". The default `evm_version` is `osaka`; spikes pinned `prague` — confirm Monad testnet's EVM level in Phase 2.
- **O-8 HTTP request `headers` is deprecated (installed SDK wins).** `@chainlink/cre-sdk@1.23.0` marks `headers` deprecated ("use multi_headers"). CRE-WORKFLOW §4 should use `multiHeaders: { authorization: { values: [\`Bearer ${apiKey}\`] } }`.
- **O-9 `writeReport` without `--broadcast` returns `TX_STATUS_SUCCESS` with no `txHash`.** CRE-WORKFLOW §4 ends with `bytesToHex(w.txHash ?? new Uint8Array(32))`, which fabricates a zero hash. Return an explicit `"no-tx"` marker instead, and never treat a missing hash as a real write.
- **O-10 `cre init` template drift.** `hello-confidential-workflows-ts` pins `@chainlink/cre-sdk@1.18.0` / `viem@2.34.0` and ignores `--rpc-url`. Always re-pin to CLAUDE.md §4 versions and hand-write `project.yaml`.
- **O-11 §5.2 nonce on E_BAD_ACTION.** §5.2 says "nonce still consumed if decryption succeeded", but the version/action check (step 2) runs before the nonce check (step 3), and an unknown version means the payload layout is unknown. Implemented: a step-2 failure consumes nothing (no nonce change, no account created); the nonce is consumed from step 3 onward. Confirm.
- **O-12 Intents already expired on arrival.** A LEND/BORROW with `expiresAtEpoch != 0 && expiresAtEpoch < newEpoch` would otherwise join this epoch's auction and only be deleted next epoch. Implemented: rejected with `E_EXPIRED` (nonce consumed). Confirm.
- **O-5 Provenance.** Ghost Finance (`snehendu098/ghost`) is public prior art with the same concept and near-identical write-up text. Confirm the relationship. If it isn't Lycantho's, the README must cite it as prior art, and the write-up text must be original.

---

## Spike log (fill in during Phase 0)

| Spike | Result | Date | Notes |
|---|---|---|---|
| S1 TEE handler simulates on monad-testnet | **PASS** | 2026-10-03 | `cre init --non-interactive -t hello-confidential-workflows-ts --deployment-registry private`, SDK bumped 1.18.0→1.23.0, `project.yaml` RPC `monad-testnet`. `handlerInTee(cron, fn, {})`; `runtime.getSecrets([{id:'S1_SECRET'}]).result()['S1_SECRET'].value` read from `.env` via `secrets.yaml`. `cre workflow simulate tee --target staging-settings --non-interactive --trigger-index 0` → `[USER LOG] S1 secretLength=40`, result `"secretLength=40"`. Installed types confirm `handlerInTee(trigger, fn, tees, hooks?)`, `getSecrets(): Record<string, Secret>`, `now(): Date`, `usingTheDons(): Runtime<C>`, `reportFromDon(req)`. Surprises: (a) template pins `cre-sdk@1.18.0` (pre-Monad constants); (b) `cre init --rpc-url monad-testnet=…` is ignored by this template (project.yaml had only Sepolia RPCs) — write project.yaml by hand; (c) simulator banner: "During real execution, user logs for this trigger will not be visible, and will not leave the TEE" — keeps non-negotiable #2 as defence in depth. |
| S2 noble ECIES decrypt inside WASM | **PASS** | 2026-10-03 | SPEC §6 implemented with `@noble/curves@2.4.0` `secp256k1.js`, `@noble/hashes@2.4.0` `hkdf.js`+`sha2.js`, `@noble/ciphers@2.4.0` `aes.js` (all spec import paths exist as written). Bun encrypts a 288 B `IntentPayload` → 350 B blob (sizes match §5.1/§6.2); blob + expected `keccak(plaintext)` embedded in config, `ENCLAVE_SK` via `getSecrets` from `.env`. In `handlerInTee`: `[USER LOG] S2 iterations=1 match=true`. Timing, 200 decryptions of the same blob (200 distinct blobs = 140 KB hex > 50 KB config limit), 3 runs: `runtime.now()` delta **2745 / 2702 / 2712 ms** (≈13.6 ms per decrypt); wall-clock 8.3–9.1 s vs 5.8–6.1 s for N=0. Measured in the local simulator (Apple Silicon); Nitro may differ, but 200 open orders/epoch is ~1% of the 5 min execution limit. Only booleans/timings logged. Surprise: `runtime.now()` advances in real time inside one simulated execution (not frozen per execution). No Rust plugin needed. |
| S3 `--broadcast` write via mock forwarder on Monad | **PASS** | 2026-10-03 | Throwaway deployer `0x074807ac37c5191CDf7815f8eb65042C1487A81f` (fresh key in `settler/.env`, never printed). `SpikeConsumer` (vendored, unmodified `ReceiverTemplate`, stores `bytes32`) at `0xE6E4E281E3eE34f131358516455954dDDB6010BA`, forwarder = mock `0xB9F7…d192` (deploy tx `0x9518b92f…4f4155`). TEE cron handler → `usingTheDons().report(abi.encode(bytes32))` → `EVMClient.writeReport(don, {receiver, report, gasConfig:{gasLimit:"300000"}})`; `cre workflow simulate write --target staging-settings --non-interactive --trigger-index 0 --broadcast -e ../../settler/.env` → `txStatus=SUCCESS tx=0x460adf7283ab2ddabf095a75b003c7eb33524b1829c7c5a818918299c0fe859b` (block 67792358, status 1, from deployer → mock forwarder). `value()` = `0x1f5f24ed…fba1f4` = `keccak("tervane-s3")`. **Gas:** receipt `gasUsed = 300000` = limit (Monad charges the limit, no refund). `callTracer`: forwarder inner frame 71,508, consumer `onReport` 31,148; intrinsic + calldata (1,124 B) = 37,578 → real cost ≈ **109k of 300k charged**. Surprises: (a) the report tx is sent **from the `CRE_ETH_PRIVATE_KEY` EOA**, so that key pays Monad's limit-based gas on every simulated epoch; (b) receipts can't measure Monad gas — use `debug_traceTransaction` or `forge test --network monad` gas reports to size `writeGasLimit`; (c) calldata overhead for a 32 B payload is 1,124 B (report + signatures/metadata), so expect ≈ 1.1 KB + payload. |
| S4 log trigger replay with `--evm-tx-hash` | **PASS** | 2026-10-03 | `SpikeEmitter` (exact SPEC §4 `InboxMessage` signature) at `0xc3F0105cACbecb8F1eC6BF626d67cB30B3E2E2ef` (deploy tx `0xbbf1f1d5…887c64`). `handlerInTee(evm.logTrigger({addresses:[hexToBase64(emitter)], topics:[{values:[hexToBase64(topic0)]},{values:[]},{values:[hexToBase64(padHex('0x02',{size:32}))]}]}), …)`; handler decodes with viem `decodeEventLog` after `bytesToHex` on topics/data. INTENT tx `0xed62d0e4564a9519eecbc890536b076389764593fcbeae679c74f4f1309c1dd3`: `simulate logs … --trigger-index 0 --evm-tx-hash 0xed62… --evm-event-index 0` → `[USER LOG] S4 … index=1 kind=2 sender=0x0748…A81f blobLen=350`. DEPOSIT tx `0xbca48f2ba69c5fe070d1af6c4f1468906e158359c9c48202647a5c20bd72ea52` (kind=1) → `✗ log does not match registered filter … log topic 2 does not match any of the values in the filter`: the padded, base64 topic2 filter is enforced on replay. Surprises: (a) `--evm-event-index` is the log's position **within the tx receipt**, while `EVMLog.index` in the payload is the **block-level** log index (1 here); (b) the handler payload's byte fields (`topics`, `data`, `txHash`) are `Uint8Array`. |
| S5 HTTP from TEE runtime to local server | **PASS** | 2026-10-03 | Bun server on :8787 returns 200 only for `Bearer <S5_SERVER_API_KEY>` (48-char key from `.env`, fetched in-enclave via `getSecrets`). `new HTTPClient().sendRequest(teeRuntime, {url:'http://localhost:8787/ping', method:'GET', multiHeaders:{authorization:{values:['Bearer …']}}})` → `[USER LOG] S5 status=200 body=pong`; server log `GET /ping auth=bad -> 401` (curl without auth) then `auth=ok -> 200` (enclave). Plain `http://localhost` needed no `--allow-insecure-rpc`. Surprise: the `headers` field is **deprecated** in the installed SDK's HTTP request type ("use multi_headers"); CRE-WORKFLOW §4 uses `headers` → switch to `multiHeaders`. Simulation limits printed: HTTP req 120 kb / resp 250 kb / timeout 10 s. |
| S6 workspace package bundles via `cre-compile` | **PASS** | 2026-10-03 | Mini-monorepo mirroring the target layout: root `workspaces: ["packages/core", "settler/settle"]`; `@tervane/core` (`exports: {".": "./src/index.ts"}`, deps noble 2.4.0 + viem) holds the S2 ECIES code; `settler/settle/package.json` depends on `"@tervane/core": "workspace:*"`. Bun 1.4.2 isolated install links `settle/node_modules/@tervane/core → packages/core`. `cre workflow simulate settle --target staging-settings --non-interactive --trigger-index 0` → `✓ Workflow compiled`, `[USER LOG] … match=true`. First attempt failed only on typecheck: `cre-compile` typechecks core's sources with the **settler's** tsconfig (`moduleResolution: bundler`, no `allowImportingTsExtensions`), so `export … from './ecies.ts'` is rejected. Forces: (1) `settler/settle` must be a root workspace member (proposed D-18); (2) relative imports inside `packages/core` are extensionless (package imports such as `@noble/curves/secp256k1.js` keep their `.js`). No relative-path fallback needed. |
| S7 `cre workflow supported-chains` lists monad-testnet | **PASS** | 2026-10-03 | CLI v1.36.0, org `org_UspGxlYOcDPIg1Ae` (deploy access: not enabled). `cre workflow supported-chains --output json` → 58 chains incl. `{chainName: "monad-testnet", chainSelector: 2183018362218727504, address: 0xF8344CFd5c43616a4366C34E3EEE75af79a74482, mockAddress: 0xB9F79d863261869B234c481D1f9A7af84AeAd192}`. Both have code on chain 10143 (`cast code`: mock 4579 B, prod 8591 B). No `experimental-chains` needed. Surprise: JSON field `address` is the **production** forwarder; the mock is `mockAddress` (docs say `address`; see O-6). |
