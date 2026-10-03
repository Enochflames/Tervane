# Tervane — Server (`server/`)

Bun + Hono + `bun:sqlite`. The server is **untrusted for integrity and blind to rates**. It exists for availability: indexing the chain, storing the plaintext ledger the enclave produces, serving the enclave its inputs, and serving users authenticated views and Merkle proofs.

What it sees: every account's balances, open order sizes and collateral, loans and lender shares, and every ciphertext blob. What it never sees: any lend minimum or borrow maximum, except the public clearing rates.

What it can't do: forge state (the enclave verifies `merkleRoot(prev) == stateRoot`; the server verifies `newRoot` from the diff), drop or reorder an intent (the enclave verifies the onchain accumulator), or censor a single user without halting all settlement (which triggers the escape hatch).

---

## 1. Modules

```
server/src/
├── index.ts          # Hono app, routes, error middleware
├── env.ts            # zod-validated env: RPC, deployment file, INTERNAL_API_KEY, PORT, DB_PATH
├── db.ts             # sqlite schema + migrations + typed queries
├── indexer.ts        # log follower (InboxMessage, EpochSettled, escape events)
├── state.ts          # committed/pending ledger store keyed by root; apply diff; GC
├── routes/internal.ts
├── routes/public.ts
├── auth.ts           # EIP-712 verification for account views
└── proofs.ts         # Merkle proof generation via @tervane/core
```

---

## 2. Database schema

```sql
CREATE TABLE inbox (
  idx        INTEGER PRIMARY KEY,         -- chain index, contiguous from 1
  kind       INTEGER NOT NULL,
  sender     TEXT NOT NULL,
  asset      INTEGER NOT NULL,
  amount     TEXT NOT NULL,               -- decimal string
  blob_hash  TEXT NOT NULL,
  blob       BLOB,                        -- 350 bytes for INTENT, NULL otherwise
  tx_hash    TEXT NOT NULL,
  log_index  INTEGER NOT NULL,
  block      INTEGER NOT NULL
);
CREATE TABLE states (
  root       TEXT PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending','committed','orphaned')),
  parent     TEXT,                        -- prevRoot
  snapshot   TEXT NOT NULL,               -- full ledger JSON (bigints as strings)
  created_at INTEGER NOT NULL
);
CREATE TABLE epochs (
  epoch      INTEGER PRIMARY KEY,
  root       TEXT NOT NULL,
  inbox_to   INTEGER NOT NULL,
  as_of      INTEGER NOT NULL,
  price      TEXT NOT NULL,
  tx_hash    TEXT NOT NULL,
  block      INTEGER NOT NULL
);
CREATE TABLE clears (epoch INTEGER, tenor_id INTEGER, rate_bps INTEGER, volume TEXT,
                     PRIMARY KEY (epoch, tenor_id));
CREATE TABLE cursor (k TEXT PRIMARY KEY, v TEXT);   -- indexer progress: last block
```

Full snapshots per root are fine at hackathon scale and make proofs trivial. Note in code where a production version would store a persistent Merkle structure instead.

**No column anywhere may hold a rate other than `clears.rate_bps`.** `scripts/audit-leaks.ts` dumps the DB and greps for bid values.

---

## 3. Indexer

- Read `deployments/monad-testnet.json` for addresses and the deploy block.
- Poll `eth_getLogs` in bounded block ranges (respect the RPC provider's range limit; start with 100–500 blocks and adapt on error). Monad blocks are ~300 ms, so poll every 1–2 s with small ranges rather than huge ranges rarely.
- Monad full nodes don't serve arbitrary historical **state**; logs over ranges are fine, but never depend on `eth_call` at old blocks.
- `InboxMessage`: insert; assert `idx == last_idx + 1` (gap → re-fetch range; never skip). Recompute `msgHash` and the accumulator locally and compare to `inboxAcc(idx)` periodically (catches indexing bugs before the enclave does).
- `EpochSettled(epoch, newRoot, …)`: mark `states[newRoot]` committed (must exist as pending; if not, log `E_MISSING_PENDING` loudly — that indicates a bug in the ordering contract), mark sibling pendings for the same parent `orphaned`, insert `epochs` + `clears`.
- Reorg handling: Monad finality is ~2 slots; index only finalized blocks (`finalized` tag) to avoid rollback logic.

---

## 4. Internal API (enclave only)

Auth: `Authorization: Bearer <INTERNAL_API_KEY>` compared with `timingSafeEqual`. This key lives in the Vault DON (or settler `.env` in simulation). It protects availability and data minimization, not integrity.

### `GET /internal/epoch-input?cursor=C&limit=N`
1. Load the committed state whose root equals the latest `EpochSettled.newRoot` (or genesis). If the caller's `C` disagrees with that state's `meta.cursor`, return `409` with the server's view (the enclave will throw `E_ROOT_MISMATCH` anyway).
2. `to = min(C + N, last indexed idx)`. Return messages `C+1..to` with blobs.
3. `openOrderBlobs`: for each open order in the state, the blob at inbox index `order.id`.
4. Response shape: CRE-WORKFLOW §5. Keep it under 250 KB; if it would exceed, shrink `to`.

### `POST /internal/epoch-output`
Body: `EpochDiff` (PROTOCOL-SPEC §7.4).
1. Load committed state for `prevRoot`; `409` if unknown.
2. Apply diff using `@tervane/core` (`applyDiff`), recompute root.
3. If root ≠ `newRoot` → `422 E_DIFF_ROOT` (log loudly; this means enclave and server code diverged).
4. Upsert `states(root=newRoot, status='pending', parent=prevRoot)`. Idempotent on repeat.
5. `200`.

GC: delete `orphaned` and `pending` states older than 20 epochs.

---

## 5. Public API

### `GET /v1/market`
Latest clears per tenor (rate, volume, epoch), `lastSettleAt`, `escaped`, current epoch, enclave pubkey **as read from chain** (convenience only — the client must read the chain itself, see CLIENT.md).

### `POST /v1/account`
Body: `{ account, issuedAt, signature }`, where `signature` is EIP-712 over
```
domain  = { name: "Tervane", version: "1", chainId: 10143, verifyingContract: core }
types   = { ViewAccount: [ { name: "account", type: "address" }, { name: "issuedAt", type: "uint64" } ] }
```
Reject if `|now − issuedAt| > 300` or signer ≠ `account`. Returns the account's balances, open orders (sizes, tenor, collateral, **no rates** — the server doesn't have them), active loans (principal, clearing rate, owed, maturity, collateral, health at last price), tier, repaid volume.

### `POST /v1/proof`
Same EIP-712 auth. Returns the account leaf + proof and, for each loan where the account is borrower or lender, the loan leaf + lender shares + proof, all against the latest committed root. The client caches this response (see CLIENT.md) so the escape hatch still works if the server later disappears.

### `GET /v1/health`
Indexer lag (blocks), last committed epoch, pending count.

---

## 6. Operational rules

- All bigints serialize as decimal strings; parse with `BigInt`. Never `Number()` an amount.
- Every handler returns typed errors `{ code, message }` with stable codes.
- The server is not in the settlement trust path, so it never signs anything and holds no private keys.
- CORS: allow the web origin only.
- Log request ids, codes, and counts. Never log request bodies on `/internal/*` (they contain blobs; harmless but noisy) or `/v1/account` responses.
