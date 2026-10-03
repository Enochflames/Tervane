# Tervane — Build Plan

Order is dependency order. Each phase ends at a **gate**: a concrete, checkable outcome. Do not start a phase until the previous gate passes. Scope tiers at the bottom say what to cut first if needed; cut from the bottom up, never from P0.

Working posture: treat every run as if it will succeed. Before any attempt, read the relevant spec section and the CRE/Monad docs it cites, so attempts aren't thrown away. When something fails, record why in `DECISIONS.md` and fix the cause, not the symptom.

---

## Phase 0 — Spikes (de-risk the platform)

Each spike is a throwaway folder under `spikes/`, deleted after its result is logged in `DECISIONS.md`.

| ID | Question | Pass condition |
|---|---|---|
| S7 | Is `monad-testnet` enabled for our tenant? Which mock forwarder? | `cre login` then `cre workflow supported-chains --output json` lists it; record forwarder address. If missing, configure `experimental-chains` in `project.yaml` and re-test. |
| S1 | Does a `handlerInTee` cron workflow simulate against monad-testnet? | `cre init` TS project, swap `handler` → `handlerInTee`, `getSecrets` from `.env`, `cre workflow simulate --non-interactive --trigger-index 0` prints the secret length (not value). |
| S2 | Does noble ECIES (secp256k1 + HKDF + AES-GCM, v2 `.js` paths) run in the WASM runtime? | Encrypt a fixed payload in Bun; decrypt inside the S1 handler from a config-embedded blob; output matches. Measure execution time for 200 decryptions. |
| S3 | Does `--broadcast` deliver a report through the Monad testnet mock forwarder to a `ReceiverTemplate` consumer? | Deploy a 10-line consumer storing `bytes32`; write via `usingTheDons().report` + `writeReport`; value visible on the explorer. Record gas used vs limit. |
| S4 | Does the log trigger replay a Monad testnet tx? | Emit a test event; simulate with `--trigger-index`, `--evm-tx-hash`, `--evm-event-index 0`; handler receives the decoded log. Test the topic2 filter with padded, base64 values. |
| S5 | Can the TEE handler reach a local Bun server during simulation? | `HTTPClient().sendRequest(teeRuntime, GET http://localhost:8787/ping)` returns 200 with bearer auth. |
| S6 | Does `cre-compile` bundle a workspace package? | Workflow imports `@tervane/core` (Bun workspace); simulate succeeds. If not, relative import path; record decision. |

**Gate 0:** all seven logged. Any failure produces a decision before Phase 1 (e.g., S2 failing → custom Rust plugin for decryption, see CRE "Custom Rust Plugins", Lycantho writes Rust).

---

## Phase 1 — `packages/core` (pure protocol)

Tasks:
1. `math.ts`: ceil/floor div, split rule (§1), value/health, interest (§9), liquidation (§10.4).
2. `params.ts`: tiers, tenors, constants (§2, §10.1).
3. `abi.ts`: viem ABI definitions + encoders/decoders for inbox msg, `IntentPayload`, leaves, `SettlementReport`, `EpochDiff` JSON codec.
4. `crypto.ts`: `encryptIntent`, `decryptIntent`, `buildAad` (§6).
5. `merkle.ts`: leaf hashing, tree, proofs (§7).
6. `auction.ts`: §8, pure.
7. `ledger.ts`: `runEpoch` (§12), `applyDiff`, invariants (§13).
8. Vector generator `bun run vectors` → `test/vectors/*.json` (§15).
9. Tests: unit per module; property tests for I1–I4, I8 (random books, random message streams, shuffled insertion orders).

**Gate 1:** `bun test` green; vectors generated; the demo book (DEMO-SCRIPT §2) produces `r* = 527 bps` and the expected loan split; property tests run ≥ 10,000 cases each without failure.

---

## Phase 2 — Contracts

Tasks: `TestToken`, `MockV3Aggregator`, vendored `ReceiverTemplate`, `TervaneMath`, `TervaneLeaves`, `TervaneCore` (inbox, report processing, views, `exitAccount`, `activateEscape`), Foundry unit/fuzz/invariant tests, vector parity tests, gas snapshots, `Deploy.s.sol`, deployment JSON.

**Gate 2:** `forge test` green including vector parity; deployed to Monad testnet with the mock forwarder; verified on the explorer; `deployments/monad-testnet.json` written; `onReport` from an EOA reverts `InvalidSender`.

---

## Phase 3 — Settler workflow

Tasks: project/workflow/secrets/config files (CRE-WORKFLOW §3), `main.ts` (§4), config generator script reading the deployment JSON, `main.test.ts` with mocked capabilities, debug-log gating.

**Gate 3:** with a stub server returning genesis state and a hand-crafted inbox (one deposit), `cre workflow simulate … --trigger-index 1 --broadcast` advances `lastEpoch` to 1 on Monad testnet and `stateRoot` equals the root computed by `packages/core` for the same inputs.

---

## Phase 4 — Server

Tasks: schema, indexer, state store with pending/committed, internal routes, public routes with EIP-712 auth, proofs.

**Gate 4:** full loop without the web app: script deposits + submits intents → server indexes → simulate H0 with the intent tx → server promotes pending → `/v1/account` shows the order; simulate H1 → heartbeat epoch; server root == chain root at every step.

---

## Phase 5 — End-to-end scenarios (scripts)

`scripts/demo/*` (see DEMO-SCRIPT §3) and `scripts/sim-smoke.ts`, `scripts/audit-leaks.ts`.

Scenarios that must pass on Monad testnet:
1. Demo book clears at 527 bps; the 611 bps lender stays open and its rate appears nowhere.
2. Repay → lenders credited principal + interest; borrower tier progress.
3. Price crash → liquidation → split per §10.4; tier drop.
4. Withdrawal → payout executes; over-request is capped by ledger balance.
5. Garbage blob → consumed as invalid; settlement continues.
6. Server tampering (edit a balance in SQLite) → enclave `E_ROOT_MISMATCH`, nothing written.
7. Forged report from EOA → `InvalidSender`.
8. Escape: stop settling, wait `ESCAPE_DELAY`, `activateEscape`, `exitAccount` with proof.

**Gate 5:** all eight pass from a clean deployment via one command; leak audit clean.

---

## Phase 6 — Web client

CLIENT.md screens in this priority: Lend/Borrow (with encryption) → Market → Wallet → Positions → Credit proof → Escape.

**Gate 6:** the demo can be run from the browser end-to-end, with the terminal used only for the CRE simulator and the price crash.

---

## Phase 7 — Escape hatch completion

`escapeRepay`, `escapeLiquidate`, `claim`, invariant tests for post-escape behavior, UI.

**Gate 7:** scenario 8 extended: a borrower escape-repays, a third party escape-liquidates a different loan, lenders claim; token conservation invariant holds.

---

## Phase 8 — Submission

README (architecture diagram, trust table from THREAT-MODEL §2, prior-art citation, how to run the simulation), updated write-up (DECISIONS D-11), CRE bounty description (CRE-WORKFLOW §1 phrasing), demo video per DEMO-SCRIPT §1, explorer links to an `EpochSettled` tx and a `Cleared` event.

**Gate 8:** a fresh clone + README instructions reproduce scenario 1 by someone who isn't Lycantho (or by Claude Code in a clean container).

---

## Scope tiers

| Tier | Contents | Rule |
|---|---|---|
| **P0** | Phases 0–5 minus scenario 8's optional parts; `exitAccount` + `activateEscape`; scripts-driven demo | Never cut |
| **P1** | Web client (Phase 6); Phase 7; D-12 outflow cap | Cut from the bottom of this list first |
| **P2** | Credit-proof UI polish, tenor selector beyond 7d/30d/demo, metrics dashboard, mobile layout | Cut freely |

If P1 is cut, the demo stays complete: the video uses scripts and the explorer, which is acceptable for both judges and the CRE bounty (it asks for a CLI simulation).
