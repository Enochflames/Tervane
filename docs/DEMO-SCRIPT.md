# Tervane — Demo Script

Three deliverables, all on the same deterministic demo book (§2), so every number on screen is predictable and matches the golden vectors:
- **(1)** the **~5-minute live video**: the landing page plus the web app working live, with the CRE settler visibly running (§1);
- **(1b)** a **≤ 2-minute terminal cut**, if a submission form caps video length;
- **(2)** a longer live walkthrough for judges who want depth (§4).

Every video must prove three things, in this order of importance:
1. **CRE is the only path to state change** (orchestration layer, bounty criterion).
2. **Bids stay inside the enclave**; only the clearing rate comes out.
3. **The chain checks the enclave**: forged reports, tampered server state, and stale prices are rejected.

Copy spoken on camera follows THREAT-MODEL §5. Say "visible only to you and a Chainlink CRE enclave", never "no one can ever see". Say "simulated with the CRE CLI against Monad testnet; reports land onchain", never "running on the CRE network".

---

## 1. The live video (~5:00)

A shot-by-shot script for the landing page plus the live app. Your two browser wallets play **Ada** (lender) and **Dayo** (borrower) from the demo book (§2). Bola and Chidi, the other two lenders, are seeded from a script before recording, so the epoch clears at **5.27%** and Chidi's 6.11% never fills.

### 1.0 Before you hit record (about 30 min of prep)

**Stack (four terminals, from the repo root; userflow.md §2)**
1. **Fresh deploy.** No indexer catch-up, a clean book, the feed at $2,500:
   ```bash
   set -a; . settler/.env; set +a; export DEPLOYER_PK="0x${CRE_ETH_PRIVATE_KEY#0x}"
   cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --gas-estimate-multiplier 115 --broadcast --slow && cd ..
   bun scripts/gen-settler-config.ts --server http://localhost:8797
   ```
2. **Server** on a new database (`PORT=8797 DB_PATH="$PWD/data/video-$(date +%s).db" bun src/main.ts`).
3. **Auto-settler:** `TERVANE_SERVER_PORT=8797 bun scripts/demo/autosettle.ts`. **This terminal is on camera.** Each line is one `cre workflow simulate --broadcast` epoch with its Monad tx.
4. **Web:** `cd web && bun run dev`, with `web/.env.local` pointing at `http://localhost:8797`.
5. **Seed the background lenders:** `TERVANE_SERVER_PORT=8797 bun scripts/demo/seed-lenders.ts`. Wait for its `settled … intents=2` line in the auto-settler.

**Wallets (two browser profiles, each with its own wallet, on Monad Testnet 10143, about 0.3 MON each)**
- **Profile A = Ada:** *Get 10,000 tUSD* → *Deposit* **600 tUSD**.
- **Profile B = Dayo:** *Get 10 tETH* → *Deposit* **0.85 tETH**.
- Wait for the auto-settler's `settled` line. Sign the view message once in each profile, so no signature prompt appears on camera.
- Run `00-preflight.ts` checks by hand: feed $2,500, server lag < 5 blocks, deployer ≥ 1 MON.

**Screen**
- Record at **1920×1080**, 30 fps (OBS scenes or whole screen + `Cmd-Tab`).
- Windows: **Browser A**, **Browser B**, the **auto-settler terminal** (font ≥ 18 pt, dark), and a **Monadscan** tab on TervaneCore.
- Browser zoom **110–125%**. Close other tabs; Do Not Disturb on.
- **Never** show or run the simulator with `--engine-logs` (O-16).

**Timing:** a transaction confirms in about 1 s and its epoch settles about 15–25 s later. Narrate the value while it settles; don't wait in silence. If the live run goes long, cut the wait in editing, never the settled line.

### 1.1 The script

> Cut points are marked ✂️. Voiceover is in quotes; adapt it to your voice.

**0:00 – 0:20 · Landing: Hero** ✂️ browser on `/`
> "This is **Tervane**: fixed-rate credit on Monad, priced by sealed bids. Your rate is visible only to you and a Chainlink CRE enclave."

**0:20 – 0:50 · Landing: Problem → How it works** (scroll)
> "Onchain order books publish every bid, so lenders leak their cost of capital the moment they post. Here, every intent is encrypted in your browser to an enclave key published on the contract, and lands on Monad as the same 350 bytes of ciphertext."

Scroll to *How it works*, point at step 3.
> "A confidential CRE workflow checks our server's ledger against the onchain Merkle root, decrypts the book inside the enclave, runs one uniform-price auction per tenor, and writes one signed report. That report is the only thing that can change state."

**0:50 – 1:00 · Cut to the auto-settler terminal**
> "This is the settler, running the CRE workflow with `cre workflow simulate --broadcast` against Monad testnet. Every line is one epoch, and every epoch is a real transaction."

**1:00 – 3:40 · LIVE APP (spend the most time here)** ✂️ cut to Browser A (`/app`)

**(1:00) Market**
> "The market already has lenders in it, two other wallets with sealed bids. Their rates aren't on this page, in the contract, or in our server's database."

**(1:15) Lend, as Ada (Browser A)**
- 600 tUSD, tenor **10 min (demo)**, min rate **4.13%** → *Seal and submit* → confirm.
> "I'm lending 600 at a minimum of 4.13 percent. Watch: the app encrypts this before my wallet even sees it."
- Open the tx on **Monadscan**, show the input data.
> "Onchain it's 350 bytes of ciphertext: no amount, no side, no rate."
- Cut to the terminal as the `settled … intents=1` line lands.
> "The enclave took it in. It's resting in the book, still sealed."

**(1:50) Borrow, as Dayo (Browser B)**
- 1,000 tUSD, tenor **10 min (demo)**, max rate **5.52%**, collateral **0.85 tETH** → *Seal and submit*.
> "Now a borrower: 1,000 at no more than 5.52 percent, with 0.85 ETH of collateral. The app checks the collateral ratio before spending any gas."

**(2:10) The match** ✂️ terminal
- Wait for `settled … fills=… clears=1`.
> "One epoch. Inside the enclave the book clears at a single rate."

✂️ Browser B → **Positions**
> "Dayo borrowed 1,000 at **5.27 percent**: owed 1,000.001003 after the 10-minute demo tenor."

✂️ Browser A → **Positions**, then **Market**
> "Ada's 600 filled at that same rate: everyone pays and earns the clearing rate, not their own bid. The Market shows only that one number. The 6.11 percent lender didn't fill, and that bid has never left the enclave."
- On Monadscan, show the `Cleared` event: tenor 2, rate 527, volume 1,000.

**(2:55) Price crash → liquidation** ✂️ terminal
```bash
bun scripts/demo/03-crash-price.ts 1800
```
> "ETH drops to 1,800. The settler sees the new price round and runs an epoch right away."
- Wait for `settled … liq=1`.
> "The enclave read the price, verified the round onchain, and liquidated: it seized what's owed plus ten percent, sent five percent to the treasury and the rest to the lenders pro rata, and Dayo gets the remainder back."
- Browser A → **Positions/Wallet:** Ada **+0.348333682711666668 tETH**. Browser B: Dayo gets back **0.238888275944444444 tETH** and keeps the 1,000 tUSD.

**(3:25) Credit proof** (Browser A → **Credit** → *Prove my tier onchain*)
> "And because the ledger is committed onchain as a Merkle root, Ada can prove her tier to anyone (`verifyAccount` returns true) without revealing anything else in her book."

**3:40 – 4:20 · Why the chain can trust this** ✂️ terminal + landing *Trust*
- **Pre-recorded inserts, from a separate `run-all.ts` (Gate 5) run, never against the video stack.** `06-tamper-server.ts` stops and restarts its own server.
  - `bun scripts/demo/05-forge-report.ts` → `InvalidSender`
  - `bun scripts/demo/06-tamper-server.ts` → `E_ROOT_MISMATCH`, no tx
> "The chain doesn't trust the enclave blindly, and the enclave doesn't trust our server. A report from anywhere but the Chainlink forwarder reverts. A tampered server database fails the root check, and nothing is written."
- Scroll the landing to *Know exactly who sees what*.
> "And we're explicit about trust: positions are private from the public chain, not from our server; rates are private from everyone except you and the enclave."

**4:20 – 4:45 · Escape hatch** (landing *Testnet* section, or the Gate 7 result)
> "If settlement ever stops, everyone exits with a Merkle proof against the last root. We ran that end to end on Monad testnet: exits, an escape repay, a third-party liquidation, every claim paid, and the contract ended holding exactly zero."

**4:45 – 5:00 · Landing: Closing** ✂️
> "Tervane: bid without showing your hand. Thanks for watching."

### 1.2 Shot list (for editing)

| Time | Source | Content |
|---|---|---|
| 0:00 | Landing | Hero |
| 0:20 | Landing | Problem → How it works |
| 0:50 | Terminal | Auto-settler: CRE simulate, one epoch per line |
| 1:00 | App A | Market (sealed lenders already in the book) |
| 1:15 | App A + Monadscan | Sealed lend, 350-byte calldata |
| 1:50 | App B | Sealed borrow |
| 2:10 | Terminal → App A/B → Monadscan | Match at 5.27%, `Cleared` event |
| 2:55 | Terminal → App A/B | Crash to $1,800 → `liq=1`, tETH to lenders |
| 3:25 | App A | Credit proof |
| 3:40 | Terminal + Landing | Forged report / tampered server rejected; trust table |
| 4:20 | Landing | Escape hatch (Gate 7) |
| 4:45 | Landing | Closing |

### 1.3 Pro tips

- **Rehearse on a throwaway deployment**, then deploy fresh for the take. A recorded deployment can't be reused cleanly: the book and loans persist.
- **Keep the auto-settler visible**, docked bottom-right if you can. The `settled … write=SUCCESS tx 0x…` lines are the CRE proof the bounty asks for.
- **Say "simulated with the CRE CLI against Monad testnet"** once, out loud.
- If an epoch is slow, keep talking ("while the enclave clears the book…"). Never cut away before the `settled` line.
- Show the wallet network = **Monad Testnet** at least once.
- Export **1080p H.264**, under about 200 MB. Add a lower-third with the repo URL.

---

## 1b. The ≤ 2-minute terminal cut (fallback if a submission caps length)

Record each segment separately and cut; WASM compile time in the simulator would otherwise eat the budget. Terminal font ≥ 18 pt, dark theme, explorer in a second window. Voiceover is written to be read at a calm pace; trim words, not segments.

| Time | Screen | Voiceover |
|---|---|---|
| **0:00–0:12** | Title card: "Tervane — a sealed-bid fixed-rate credit market on Monad, settled by a Chainlink CRE enclave" | "Onchain order books publish every bid, so lenders leak their cost of capital. Tervane is a new market structure: a sealed-bid auction for fixed-rate loans, where your bid is visible only to you and a Chainlink CRE enclave." |
| **0:12–0:25** | Architecture diagram (ARCHITECTURE §2 mermaid, exported) with three boxes highlighted in sequence: TervaneCore → CRE enclave → server | "Users post encrypted intents to an onchain inbox on Monad. A confidential CRE workflow decrypts them inside a TEE, runs a sealed-bid auction, and writes one signed report per epoch. That report is the only thing that can change state." |
| **0:25–0:45** | `bun scripts/demo/01-seed.ts` output table (wallet, action, amount — the rates column shows only on the *local* side, labeled "client-side only"). Cut to Monadscan: a `submitIntent` tx, input data = 350-byte blob. Cut to `sqlite3 tervane.db "select idx,kind,length(blob) from inbox"` → every intent is 350 bytes. | "Three lenders bid 4.13, 5.27 and 6.11 percent. One borrower will pay at most 5.52. Onchain, every intent is the same 350 bytes of ciphertext. Our own server stores them, and can't read a single rate." |
| **0:45–1:12** | Terminal (never with `--engine-logs` on screen, O-16): `cre workflow simulate settle --target staging-settings --non-interactive --trigger-index 0 --evm-tx-hash $DAYO_TX --evm-event-index 0 --broadcast`. Highlight output lines: root verified, inbox accumulator verified, `fills=1`, tx hash. Cut to Monadscan: `Cleared(epoch=1, tenor=2, rate=527, volume=1000)`. Cut to `bun scripts/audit-leaks.ts` → `611 bps: 0 occurrences outside client storage`. | "The borrower's intent fires the workflow's log trigger. Inside the enclave it checks the server's state against the onchain Merkle root and the inbox against an onchain hash chain, then clears the book. Everyone matched trades at 5.27. The 6.11% bid didn't fill, and it never left the enclave. Our leak audit finds it nowhere: not in logs, the database, calldata, or events." |
| **1:12–1:35** | `bun scripts/demo/03-crash-price.ts 1800` → mock feed round 2. Then `cre workflow simulate settle … --trigger-index 1 --broadcast` → `liquidations=1`. Cut to `bun scripts/demo/show-accounts.ts`: Dayo `ethFree +0.2389`, Ada `ethFree +0.3483`, Bola `ethFree +0.2322`, treasury `+0.0306`. | "ETH drops to 1,800. On the next 30-second heartbeat the enclave reads the price, verifies the round onchain, and liquidates: owed plus ten percent is seized, five percent goes to the treasury, the rest to the lenders pro rata, and the borrower gets the remainder back." |
| **1:35–1:52** | Split screen. Left: `bun scripts/demo/05-forge-report.ts` → `revert InvalidSender`. Right: `bun scripts/demo/06-tamper-server.ts` (edits Ada's balance in SQLite) → simulate → `E_ROOT_MISMATCH`, no tx. | "The chain doesn't trust the enclave blindly, and the enclave doesn't trust our server. A report from anywhere but the Chainlink forwarder reverts. A tampered server database fails the root check, and nothing is written." |
| **1:52–2:00** | Closing card: three lines — "CRE: the only path to state change" · "Bids: enclave-only" · "If settlement stops: exit with a Merkle proof" | "If settlement ever stops, everyone exits with a Merkle proof against the last root. Tervane." |

**Must-show artifacts** (bounty asks for a successful simulation): the `cre workflow simulate` command line and its success output, plus the resulting transaction on Monad testnet. Both appear twice above.

---

## 2. The demo book (deterministic)

Price at start: **$2,500.00** (`2500e8`, mock feed round 1). Tenor: **2 (DEMO-10m)**. Demo params per PROTOCOL-SPEC §2.

| Wallet | Role | Deposit | Intent |
|---|---|---|---|
| Ada | Lender | 600 tUSD | LEND 600 @ min **413** bps |
| Bola | Lender | 600 tUSD | LEND 600 @ min **527** bps |
| Chidi | Lender | 1,000 tUSD | LEND 1,000 @ min **611** bps |
| Dayo | Borrower (Bronze) | 0.85 tETH | BORROW 1,000 @ max **552** bps, collateral 0.85 tETH |

Expected epoch 1 (all numbers are what the golden vectors must produce):
- Dayo's collateral value at $2,500 = **$2,125.00** ≥ 2.0× → eligible.
- Lend slices with min ≤ 552: Ada 600 + Bola 600 = 1,200 ≥ 1,000 → fill. Consumed: **Ada 600 @ 413, Bola 400 @ 527** → `r* = 527`.
- Loan #1: principal **1,000.000000**, rate **527**, interest `⌈1000e6 × 527 × 600 / (10⁴ × 31,536,000)⌉ = 1,003` units → owed **1,000.001003 tUSD** (tiny because the demo tenor is 10 minutes; say so if asked).
- Open after epoch: Bola 200 @ 527 (rate still encrypted), Chidi 1,000 @ 611 (never touched).
- Public output: `Cleared(1, 2, 527, 1000e6)`. Nothing else about the book.

Liquidation threshold for this loan (Bronze, 1.6×): price below **≈ $1,882.35**.

Expected epoch after the crash to **$1,800** (mock round 2):
- Value = **$1,530.00** < owed × 1.6 → liquidate.
- `seized = min(0.85, ⌈owed × 1.10 / 1800⌉)` = **0.611111724055555556 tETH**
- fee (5%) = **0.030555586202777777 tETH** → treasury
- pot = **0.580556137852777779 tETH** → Ada (600/1000) **0.348333682711666668** (includes 1 wei dust: largest share), Bola (400/1000) **0.232222455141111111**
- Dayo gets back **0.238888275944444444 tETH**; keeps the 1,000 tUSD; tier stays Bronze (floor).
- Ada's seized collateral is worth ≈ $627.00 at $1,800 against her 600 tUSD principal.

`packages/core/test/vectors/auction.json` and `liquidation.json` must contain exactly these numbers.

---

## 3. Demo tooling (`scripts/demo/`)

All scripts read `deployments/monad-testnet.json` and `scripts/demo/wallets.json` (4 throwaway test keys generated locally on first run; **gitignored**, never committed or printed). The deployer key comes from `settler/.env`. Each prints a compact table and exits non-zero on any mismatch with §2.

**One command (Gate 5):** `set -a; . settler/.env; set +a; bun scripts/demo/run-all.ts` deploys fresh, regenerates the settler config, starts the server on a fresh DB, funds the wallets, runs scenarios 1–8 (`scripts/demo/scenarios.ts`) and the leak audit. As built, the `.sh` steps below are `.ts` (`02-settle-intents.ts`, `04-settle-cron.ts`), and the shared logic lives in `scripts/demo/steps.ts`.

| Script | Does |
|---|---|
| `00-preflight.ts` | Checks everything in §5; prints a green/red checklist |
| `autosettle.ts` | Live video (§1): one `cre workflow simulate --broadcast` epoch within seconds of every indexed inbox message or new price round, a 5-min heartbeat (keeps `ESCAPE_DELAY` closed), and a feed refresh before `MAX_PRICE_AGE`. Needs the server running and the settler config pointing at it |
| `seed-lenders.ts` | Live video (§1): Bola LEND 600 and Chidi LEND 1,000 (tenor 2) from the demo wallets, so the browser wallets can play Ada and Dayo; rates are encrypted and never printed |
| `01-seed.ts` | Faucet → approve → deposit → encrypt + `submitIntent` for the four wallets in inbox order: Ada dep, Bola dep, Chidi dep, Dayo dep, Ada lend, Bola lend, Chidi lend, Dayo borrow. Saves `DAYO_TX` to `.demo-state.json`. Shows rates only in a column labeled "client-side only" |
| `02-settle-intents.sh` | Runs the H0 simulate command with `DAYO_TX`, `--broadcast`; then asserts the onchain `Cleared` event equals 527/1000e6 |
| `03-crash-price.ts <usd>` | `MockV3Aggregator.updateAnswer(usd × 1e8)` |
| `04-settle-cron.sh` | Runs the H1 simulate command with `--broadcast`; asserts `liquidations=1` via server account views |
| `show-accounts.ts` | EIP-712-signed `/v1/account` for each wallet; prints free/reserved/locked deltas since seed |
| `05-forge-report.ts` | Calls `TervaneCore.onReport(metadata, validLookingReport)` from Ada's EOA; expects `InvalidSender` |
| `06-tamper-server.ts` | Backs up the DB, increments Ada's `usdFree` in the committed snapshot, runs H1 simulate (expects failure with `E_ROOT_MISMATCH` and no tx), restores the DB |
| `07-escape.ts` | Extended walkthrough only: waits out `ESCAPE_DELAY` (10 min in demo params), `activateEscape`, Chidi `exitAccount` with proof, shows 1,000 tUSD returned |
| `08-credit-proof.ts` | Extended walkthrough only: fetches Bola's account proof, calls `verifyAccount` → `true`, prints only tier + repaid volume |
| `../audit-leaks.ts` | Greps simulator stdout (captured with `-v`), the server log, the DB, tx calldata and event logs for each bid (`413`, `527`, `611`, `552`, plus `593` used by scenario 2) in decimal, hex, percent, and uint32 BE bytes; also fails if any secret value appears. Allowed hits: `527` (the public clearing rate); anything inside client storage exports. **Never capture or record with `--engine-logs`**: the simulator's fake HTTP capability logs full requests, including the server bearer key (O-16). |

Use `--broadcast` on every simulate so the chain state the video shows is real.

---

## 4. Extended judge walkthrough (≈ 6 minutes, live or recorded)

1. **Trust table** (THREAT-MODEL §2) — 30 s. State the two assumptions out loud: TEE confidentiality and trusted key generation.
2. **Seed + settle** as in the video — 90 s, but open the workflow source and point at `handlerInTee`, `getSecrets`, `HTTPClient(teeRuntime)`, `usingTheDons().report`, `writeReport`.
3. **Contract checks** — 60 s: open `_processReport` on the explorer's verified source; walk the ten checks (epoch, root, inbox accumulator, asOf skew, price round, payout ceilings).
4. **Repay path** (optional, needs a fresh borrow) — 45 s.
5. **Escape hatch** — 90 s: `07-escape.ts` (pre-waited), Chidi exits with a proof.
6. **Credit attestation** — 30 s: `08-credit-proof.ts`. "Prove your tier to anyone without revealing your book" — credit history that lowers collateral, the Track 01 credit-priced lending angle.
7. **Honest limits** — 30 s: server sees positions; key generation is a trusted step; TEE compromise risk; outflow cap is next.

---

## 5. Preflight checklist (run `00-preflight.ts`; all green before recording)

- [ ] CRE CLI ≥ 1.30 (`cre version`), `cre login` valid, `monad-testnet` in `cre workflow supported-chains`
- [ ] `CRE_ETH_PRIVATE_KEY` has ≥ 1 MON (a fresh deploy costs ≈ 0.74 MON at 102 gwei); 4 demo wallets have ≥ 0.2 MON each (measured: a full run spends < 0.15 MON per wallet)
- [ ] Contracts deployed fresh (new deploy = clean inbox, epoch 0); `TervaneCore.getForwarderAddress()` == Monad testnet **mock** forwarder; no workflow-id/author checks set
- [ ] `enclavePubKey` onchain == pubkey derived from `TERVANE_ENCLAVE_SK` in `settler/.env`
- [ ] Mock feed answer == `2500e8`, round 1, updated within `MAX_PRICE_AGE`
- [ ] Server running, indexer lag < 5 blocks, `/v1/health` green, DB backed up
- [ ] `settler/settle/config.staging.json` addresses match the deployment file (`scripts/gen-settler-config.ts` writes them)
- [ ] One dry rehearsal of the full sequence on a separate deployment; then redeploy fresh for the recording
- [ ] `debugLogs: true` only prints codes/counts; run `audit-leaks.ts` on the rehearsal output and confirm clean
- [ ] Explorer tabs pre-opened: TervaneCore (verified source), the deployer address

---

## 6. Track 01 positioning (submission summary)

> Tervane is a sealed-bid, uniform-price call auction for fixed-rate term loans on Monad. Lenders and borrowers post fully encrypted intents to an onchain inbox; a Chainlink CRE confidential workflow clears each tenor at a single rate and publishes only that rate, giving Monad a public fixed-rate benchmark without exposing anyone's cost of capital. Credit tiers, built from repaid volume and committed onchain in a Merkle-rooted ledger, lower collateral from 2.0× to 1.3×, and borrowers can prove their tier without revealing their book. Onchain order books publish every bid; Tervane matches inside an enclave while the chain enforces the result: a hash-chained inbox nobody can censor, root sequencing, feed-verified prices, and an escape hatch if settlement stops.

## 7. Submission text for the CRE bounty field ("how your project uses CRE")

> CRE is Tervane's settlement layer: no deposit, match, repayment, liquidation, or withdrawal takes effect without a report from our workflow. One confidential workflow registers two `handlerInTee` handlers: an EVM log trigger on `TervaneCore`'s `InboxMessage` (intents) for prompt settlement, and a 30-second cron as heartbeat. Inside the enclave, the workflow fetches its decryption key and server credential from the Vault DON, pulls the prior ledger and new inbox messages from our server over HTTP, and verifies both against onchain commitments (Merkle state root, hash-chained inbox accumulator). It decrypts sealed lend and borrow intents, runs a uniform-price call auction per tenor, applies repayments, liquidations at a feed-verified price, and withdrawals, then crosses to the DON to sign a single settlement report that `writeReport` delivers through the Keystone forwarder. `TervaneCore` accepts state changes only through that path and re-checks epoch, root, inbox, price round, and payout ceilings. Demonstrated with `cre workflow simulate --broadcast` against Monad testnet.
