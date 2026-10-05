# Testing Tervane end to end

Three things run on your machine: the **server**, the **auto-settler** (runs the Chainlink CRE workflow for every epoch) and the **web app**. Contracts live on Monad testnet. Everything you do in the app settles about **20 seconds** later.

---

## 1. Once

```bash
export PATH="$HOME/.bun/bin:$HOME/.cre/bin:$HOME/.foundry/bin:$PATH"
cre login
git submodule update --init --recursive
bun install
```

- `settler/.env` must have `CRE_ETH_PRIVATE_KEY`, `TERVANE_ENCLAVE_SK` and `TERVANE_SERVER_API_KEY` (never commit or share it).
- The deployer needs **≥ 2 MON**.
- The guide uses port **8797**, because port 8787 is taken by another app.

---

## 2. Start (three terminals, from the repo root)

**Terminal 1: server**
```bash
set -a; . settler/.env; set +a
export INTERNAL_API_KEY="$TERVANE_SERVER_API_KEY"; unset CRE_ETH_PRIVATE_KEY TERVANE_ENCLAVE_SK
cd server && PORT=8797 DB_PATH="$PWD/data/web-e2e.db" bun src/main.ts
```

**Terminal 2: auto-settler (Chainlink CRE)**
```bash
bun scripts/gen-settler-config.ts --server http://localhost:8797    # once per deployment
set -a; . settler/.env; set +a
TERVANE_SERVER_PORT=8797 bun scripts/demo/autosettle.ts
```
Leave it open. Each line is one epoch: `settled epoch=N … fills=… clears=… write=SUCCESS tx 0x…`.

**Terminal 3: web**
```bash
cd web
echo "VITE_SERVER_URL=http://localhost:8797" > .env.local
bun run dev
```
Open **http://localhost:5173/app**.

> **Want a clean slate?** Before step 2, deploy fresh:
> ```bash
> set -a; . settler/.env; set +a; export DEPLOYER_PK="0x${CRE_ETH_PRIVATE_KEY#0x}"
> cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --gas-estimate-multiplier 115 --broadcast --slow && cd ..
> ```
> Then use a new database in terminal 1: `DB_PATH="$PWD/data/demo-$(date +%s).db"`.

---

## 3. Wallets

Two wallets on **Monad Testnet** (chain `10143`, RPC `https://testnet-rpc.monad.xyz`): **A = lender**, **B = borrower**. Give each about 0.3 MON:

```bash
set -a; . settler/.env; set +a
cast send <ADDRESS> --value 0.3ether --rpc-url https://testnet-rpc.monad.xyz --private-key "$CRE_ETH_PRIVATE_KEY"
```

---

## 4. Test flow

Do one step, wait for the `settled` line in terminal 2 (about 20 s), then check the result.

| # | Who | Page → action | Expect after it settles |
|---|---|---|---|
| 1 | A | **Wallet** → *Get 10,000 tUSD*, then *Deposit* 600 tUSD | Sign the view message once; A shows 600 tUSD free |
| 2 | B | **Wallet** → *Get 10 tETH*, *Get 10,000 tUSD*, then *Deposit* 0.5 tETH and 5 tUSD | B shows 0.5 tETH and 5 tUSD free |
| 3 | A | **Lend** → 500 tUSD, tenor **10 min (demo)**, min rate 4% → *Seal and submit* | A's order rests in the book (no rate shown anywhere but A's own screen) |
| 4 | B | **Borrow** → 500 tUSD, tenor **10 min (demo)**, max rate 5.5%, collateral 0.5 tETH → *Seal and submit* | Terminal 2: `fills=1 clears=1`. **Positions** shows the loan for A and B; **Market** shows the clearing rate |
| 5 | B | **Positions** → *Repay* (within 10 min) | A is credited principal + interest; B's 0.5 tETH unlocks |
| 6 | A | **Wallet** → *Request withdrawal* 100 tUSD | 100 tUSD arrives in A's wallet |
| 7 | A | **Credit** → *Prove my tier onchain* | `verifyAccount → true` |

**Rules that matter:**
- **Same tenor for both sides.** Each tenor has its own auction, so a 7-day lend never matches a 10-minute borrow.
- **Borrower's max rate ≥ lender's min rate**, or both orders just rest.
- **Collateral ≥ 200% of the loan** to open (Bronze tier). 0.5 tETH at $2,500 covers 500 tUSD.

### Liquidation instead of repay (replaces step 5)
Either:
- **Crash the price:**
  ```bash
  set -a; . settler/.env; set +a; bun scripts/demo/03-crash-price.ts 1500
  ```
- **or just don't repay:** after the 10-minute tenor plus 60 s grace, the loan is liquidated as overdue.

Terminal 2 shows `liq=1`. A receives tETH, the treasury gets 5%, and B keeps the rest of the collateral. Reset the price afterwards with `bun scripts/demo/03-crash-price.ts 2500`.

---

## 5. What to show

- **Explorer:** an intent transaction is an opaque 350-byte blob, with no amount, side or rate visible.
- **Market:** only the clearing rate is public.
- **Terminal 2:** one CRE epoch per line, each a real Monad testnet transaction.

---

## 6. Escape hatch (don't use on this deployment)

Escape is **permanent**. Test it only with the scripted run, which uses its own deployment:

```bash
set -a; . settler/.env; set +a
TERVANE_SERVER_PORT=8797 bun scripts/demo/run-gate7.ts     # ~15 min, needs ≥ 1.5 MON
```

---

## 7. Stop

Press Ctrl-C in each terminal. Stop the auto-settler when you're not testing: its heartbeat costs about 0.25 MON per hour. Before committing, run `bun scripts/gen-settler-config.ts` to point the settler config back at port 8787.

---

## 8. If something's wrong

| You see | Fix |
|---|---|
| CORS / 404 errors on `localhost:8787` | `web/.env.local` must point at `http://localhost:8797`; restart `bun run dev` |
| Balances don't change | Is terminal 2 running? Wait for a `settled` line |
| Terminal 2: `waiting for the server to index…` | The server is catching up after downtime; it settles automatically when done |
| Terminal 2: `FAILED: E_PRICE` | `bun scripts/demo/03-crash-price.ts 2500` (refreshes the feed) |
| Market: *Settlement has stalled* | Start terminal 2. **Never** activate escape here |
| Lend and borrow don't match | Different tenors, or max rate < min rate |
| "Insufficient balance" on a write | Top up MON for that wallet or the deployer |
