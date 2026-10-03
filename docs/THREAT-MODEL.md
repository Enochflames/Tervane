# Tervane — Threat Model

Judges at this level (Paradigm, Electric, Dragonfly, Chainlink DevRel) will probe the trust model first. This document is the honest version. All README, submission, UI, and video copy must stay within §5.

---

## 1. Assets to protect

1. **Bid privacy** — each lender's minimum rate and each borrower's maximum rate.
2. **Position privacy** — who lent/borrowed how much, at what collateral, against whom.
3. **Funds** — tUSD and tETH held by `TervaneCore`.
4. **Liveness / exit** — users can always get their funds out.
5. **Integrity** — balances and loans change only according to the protocol rules.

---

## 2. What each observer learns

| Data | Public chain | Server operator | DON node operator | Enclave (during execution) |
|---|---|---|---|---|
| Lend min / borrow max rates | no | no | no | yes |
| Per-tenor clearing rate + volume | yes | yes | yes | yes |
| Intent action, tenor, amount, collateral | no (fixed-size ciphertext) | yes (ledger) | no | yes |
| Who submitted an intent (address, time) | yes | yes | yes (log trigger) | yes |
| Deposits and withdrawal requests (address, asset, amount) | yes | yes | yes | yes |
| Balances, orders, loans, lender shares, tiers | no (only Merkle root) | yes | no | yes |
| Liquidations | no | yes | no | yes |

Positions are private **from the public**, not from the server operator. Rates are private **from everyone except the enclave**. That distinction must appear wherever we describe privacy.

---

## 3. Adversaries

### A1 — Public observer / MEV searcher
- Sees blobs, deposits, withdrawals, clearing rates.
- **Can't** read intents (ECIES + AES-GCM), can't replay another user's blob (AAD binds sender), can't front-run a fill (matching happens offchain at epoch boundaries; there is nothing in a blob to trade on). Monad has no global mempool, which further reduces classic sandwiching.
- **Residual:** activity metadata (address X submitted an intent at time T; X deposited 5 tETH yesterday). Deposit sizes hint at intent sizes. Mitigation for real users: deposit once, trade many times; ledger-internal movements are invisible.

### A2 — Server operator (malicious or compromised)
- Sees the full ledger except rates.
- **Can't** forge state (enclave checks `merkleRoot(prev) == stateRoot`), drop/reorder/alter inbox messages (enclave checks the onchain accumulator and blob hashes), substitute the enclave key (clients read it from chain), or move funds (no keys).
- **Can** halt settlement by withholding data. Halting is global (the enclave needs a contiguous inbox prefix), so it can't single out a user; after `ESCAPE_DELAY` anyone activates the escape hatch.
- **Can** refuse to serve Merkle proofs → **data-availability assumption** (§4).

### A3 — DON node operators
- Execute triggers, chain reads, report signing; see the report and public reads.
- **Can't** see enclave memory, secrets, or decrypted intents (Confidential Workflows run the handler in a TEE; secrets are released by the Vault DON into the enclave).
- **Can** refuse to execute (liveness → escape hatch). Report forgery requires breaking DON signing, out of scope.

### A4 — Enclave compromise (TEE break, side channel, co-tenant leak)
- CRE docs state that multiple confidential workflows may share an enclave, isolated by Wasmtime, and that side-channel and speculative-execution attacks may leak information. A successful attack reveals bids and the enclave key.
- **What onchain checks still enforce:** payouts only to addresses with an onchain withdrawal request and only up to the requested amount; no skipped or reordered inbox messages; no fabricated price (round verified against the feed); strict epoch/root sequencing. These stop a buggy or partially compromised enclave from paying arbitrary addresses silently, and they make any theft **attributable** (the thief must request withdrawals from an onchain address).
- **What they do not stop:** an attacker who controls the enclave can commit a dishonest ledger that credits an address they own, then request a withdrawal from it. TEE compromise can therefore lead to loss of funds. This is the honest residual risk of any TEE-sequenced validium, and we state it.
- Planned mitigation (P1, `DECISIONS.md` D-12): a per-epoch outflow cap per asset (e.g. 10% of holdings), which turns an instant drain into a slow, visible one and gives users time to act.
- Mitigations in scope: no logging in the handler; minimal secret surface; deterministic code that the server re-executes for the root (it can't re-execute the decryption, but it does re-derive the root from the diff).

### A5 — Key custodian (whoever generated `ENCLAVE_SK`)
- **Important and easy to miss.** In the current CRE model, workflows are stateless and secrets come from the Vault DON, so the enclave key is generated **outside** the enclave and uploaded. Whoever generated it could decrypt every blob ever submitted.
- Hackathon posture: generate on an offline machine, upload to the Vault DON (or `.env` for simulation), destroy the local copy, and **say plainly** that key generation is a trusted setup step.
- Roadmap: enclave-generated keys with attestation-bound publication of the public key, plus per-epoch key rotation, once CRE supports persistent enclave state or attested key generation.

### A6 — Contract owner
- Can change `enclavePubKey`, `priceFeed`, `treasury`, forwarder, and workflow-id expectations.
- A malicious key change makes future intents readable to the owner; a malicious feed change could trigger unfair liquidations.
- Production mitigation: timelock on all setters (≥ `ESCAPE_DELAY`), so users can exit before a change lands. Hackathon: owner is the deployer; disclose it.

### A7 — Users
- **Garbage blobs**: consumed as invalid; can't stall (the inbox cursor advances).
- **Sybil / wash-farming tiers**: a user can lend to their own borrow to build `repaidVolume` at the cost of interest paid to themselves. Tiers stay overcollateralized (Platinum opens at 1.3×), and the outstanding-principal cap grows only with repaid volume, so farming buys capital efficiency, not the ability to steal. Disclose it; optional future fee on interest raises the cost.
- **Probing the rate curve**: a borrower who submits a small borrow at max rate `x` learns whether the book clears at ≤ `x`, but only by actually taking a binding loan with locked collateral. There is no free accept/reject option to exploit.
- **Griefing the auction with huge cheap lends then cancelling**: cancels apply at the next epoch's ingest, before matching, so a lend that is live at matching time is binding. Same for borrows.

### A8 — Price oracle
- Demo uses `MockV3Aggregator` controlled by the deployer, which is why the demo can crash the price. Say so. Production points at a Chainlink ETH/USD feed. The contract verifies that the report's price equals the feed's answer for the stated round and is fresh, and that round ids never go backwards, so the enclave cannot cherry-pick a stale favorable price.

---

## 4. Explicit assumptions

1. **TEE confidentiality** (A4). Bid privacy rests on it.
2. **Trusted key generation** (A5).
3. **Data availability for escape:** exiting requires your leaf + proof from the server or your client's cached copy. If both the server and your cache are gone, you can't exit until someone serves the data. (Same assumption as any validium.)
4. **Liveness:** settlement needs the server, the DON, and the enclave. Failure of any one triggers the escape hatch after `ESCAPE_DELAY`; it never risks funds that the last root already accounted for.
5. **Owner honesty** for configuration, mitigated by timelocks in production.

---

## 5. Claims we may and may not make

| Allowed | Not allowed |
|---|---|
| "Rates are visible only to you and a Chainlink CRE enclave." | "No one can ever see your rate." / "Trustless privacy." |
| "The server stores your intent but can't read your rate, and can't alter or drop it." | "The server knows nothing." (it knows balances and positions) |
| "Positions are hidden from the public chain; only a Merkle root is published." | "Fully private positions." |
| "Only the clearing rate is published; losing bids are never revealed." | "Individual rates are never exposed." (the clearing rate equals the marginal bid) |
| "Inframarginal lenders can't gain by misreporting; only the marginal lender can move the price." | "Truthful bidding is the dominant strategy." |
| "If settlement stops, everyone can exit with a Merkle proof." | "Funds are always instantly withdrawable." |
| "Every payout needs an onchain withdrawal request and is capped by it, so the enclave can't silently pay arbitrary addresses." | "Funds are safe even if the enclave is compromised." |
| "Simulated with the CRE CLI against Monad testnet; reports land onchain." | "Running on the CRE network." (unless actually deployed with beta access) |

Update the public write-up to match (see `DECISIONS.md` D-11).
