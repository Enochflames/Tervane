# Tervane — Protocol Specification (source of truth)

Everything here must be implemented identically in `packages/core` (TypeScript) and `contracts/src/TervaneCore.sol` (Solidity). Every section that defines an encoding has golden vectors (§15). If you change anything here, update both implementations and regenerate vectors in the same commit.

Notation: `abi.encode` / `abi.encodePacked` mean Solidity semantics (viem `encodeAbiParameters` / `encodePacked` in TS). `keccak` is keccak256. `⌈a/b⌉` is ceil-div on unsigned integers, `⌊a/b⌋` floor-div. All integers are unsigned unless typed `int`.

---

## §1 Conventions

| Quantity | Type | Decimals | Notes |
|---|---|---|---|
| tUSD amount | uint256 | 6 | lending asset |
| tETH amount | uint256 | 18 | collateral asset |
| Price | int256 → treated as uint after `> 0` check | 8 | USD per 1 ETH, AggregatorV3 `answer` |
| Ratios | uint | bps, base `BPS = 10_000` | 20_000 = 2.0x |
| Interest rate | uint32 `rateBps` | bps per year, simple interest | 525 = 5.25% APR |
| Time | uint64 | unix seconds | `asOf` from `runtime.now()` |

**No floats anywhere in protocol math.** TS uses `bigint` for every amount, rate, price, and time in the transition. Convert to `number` only for display.

**Rounding policy (global):**
- Anything a user **owes** rounds **up** (`⌈⌉`).
- Anything the protocol **pays or credits** rounds **down** (`⌊⌋`).
- When splitting an amount pro rata, compute every share with `⌊⌋`, then give the remainder ("dust") to the recipient with the **largest weight**; ties broken by **lowest address** (numeric compare of the 20-byte value). This makes every split exact and deterministic.

---

## §2 Assets and parameters

```
ASSET_USD = 0   // tUSD, 6 decimals
ASSET_ETH = 1   // tETH, 18 decimals

BPS              = 10_000
YEAR             = 31_536_000          // 365 days
MAX_RATE_BPS     = 10_000              // 100% APR cap on any bid/max
LIQ_PENALTY_BPS  = 1_000               // owed × 1.10 seized at most
LIQ_FEE_BPS      = 500                 // 5% of seized collateral to treasury
VALUE_SCALE      = 10^20               // ethWei × price8 / 10^20 = usd6
MAX_INBOX_PER_EPOCH   = 200
MAX_PAYOUTS_PER_EPOCH = 32
BLOB_LEN              = 350            // §6.4, enforced onchain
```

Tenors (`tenorId → seconds`). Tenor 2 exists only when `demoMode = true` in settler config; the contract does not need a tenor table because loan leaves carry absolute `maturity`.

| tenorId | seconds | label |
|---|---|---|
| 0 | 604_800 | 7d |
| 1 | 2_592_000 | 30d |
| 2 | 600 | DEMO-10m (demoMode only) |

Deployment-time parameters (contract constructor args; settler reads them via `TervaneCore.params()` once per epoch so they can't drift):

| Param | Prod | Demo |
|---|---|---|
| `GRACE` (after maturity before liquidation) | 3_600 | 60 |
| `ESCAPE_DELAY` (no settlement → escape allowed) | 86_400 | 600 |
| `MAX_SKEW` (\|asOf − block.timestamp\|) | 120 | 120 |
| `MAX_PRICE_AGE` | 3_600 | 86_400 |

---

## §3 Identifiers

- **Order id** = the inbox index of the `INTENT` message that created it (uint64). Unique, monotonic, chain-assigned.
- **Loan id** = `meta.nextLoanId` at creation, then incremented (uint64, starts at 1).
- **Epoch** = `meta.epoch` after the transition; onchain `lastEpoch` must equal `epoch − 1` when the report arrives. Genesis epoch is 0.

---

## §4 Inbox

Three message kinds:

```
KIND_DEPOSIT  = 1   // fields: sender, asset, amount         blobHash = 0
KIND_INTENT   = 2   // fields: sender, blobHash               asset = 0, amount = 0
KIND_WITHDRAW = 3   // fields: sender, asset, amount (requested)  blobHash = 0
```

Indices start at 1. For message `i`:

```
msgHash_i = keccak(abi.encode(
    uint64  index,
    uint8   kind,
    address sender,
    uint8   asset,
    uint256 amount,
    bytes32 blobHash))

acc_0 = bytes32(0)
acc_i = keccak(abi.encodePacked(acc_{i-1}, msgHash_i))
```

The contract stores `inboxAcc[i]` for every `i` and emits:

```solidity
event InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender,
                   uint8 asset, uint256 amount, bytes blob);
```

`blob` is empty for non-INTENT kinds. The log trigger filters `topic0 = InboxMessage` and `topic2 = pad32(2)` (INTENT only).

**Enclave verification:** given onchain `cursor` and the server's messages `cursor+1 .. to` (contiguous, no gaps, `to − cursor ≤ MAX_INBOX_PER_EPOCH`), recompute `acc` starting from the server-supplied `acc_cursor`, check that the server's `acc_cursor` equals onchain `inboxAcc[cursor]` (one chain read), and check the result equals onchain `inboxAcc[to]` (one chain read). For INTENT messages also check `keccak(blob) == blobHash`. Any mismatch → abort epoch with `E_INBOX_MISMATCH`.

---

## §5 Intent payload

### §5.1 Encoding (fixed 288 bytes)

```
IntentPayload = abi.encode(
    uint8   version,         // = 1
    uint8   action,          // 1 LEND, 2 BORROW, 3 CANCEL, 4 REPAY
    uint8   tenorId,         // LEND/BORROW only, else 0
    uint32  rateBps,         // LEND: minimum acceptable; BORROW: maximum acceptable; else 0
    uint64  nonce,           // strictly greater than account.nonce
    uint64  refId,           // CANCEL: orderId; REPAY: loanId; else 0
    uint64  expiresAtEpoch,  // LEND/BORROW: order expires when epoch > this; 0 = never
    uint256 amount,          // LEND: tUSD to lend; BORROW: tUSD principal wanted; else 0
    uint256 collateral)      // BORROW: tETH to reserve as collateral; else 0
```

Nine static words → always exactly 288 bytes, so every action produces a ciphertext of identical length. No padding scheme needed.

### §5.2 Validation (enclave, in this order; first failure → intent ignored, nonce still consumed if decryption succeeded)

1. Decrypts with the AAD bound to the message sender (§6.3). Else `E_DECRYPT` (nonce **not** consumed: nothing authenticated).
2. `version == 1`, `action ∈ {1..4}`. Else `E_BAD_ACTION`.
3. `nonce > account.nonce`. Else `E_NONCE`. On success set `account.nonce = nonce` **before** further checks.
4. Action-specific checks (§12 step 3).

---

## §6 Encryption (ECIES over secp256k1, AES-256-GCM)

### §6.1 Keys
- Enclave keypair: secp256k1. `ENCLAVE_SK` (32 bytes, hex) lives only in the Vault DON (deployed) or `.env` (simulation). `enclavePubKey` (33-byte compressed) is stored in `TervaneCore` and is the **only** source clients may use.

### §6.2 Encrypt (client)
```
eph_sk   = randomBytes(32)                         // @noble/curves utils
eph_pk   = secp256k1.getPublicKey(eph_sk, true)    // 33 bytes compressed
shared   = secp256k1.getSharedSecret(eph_sk, enclavePubKey, true)  // 33 bytes
ikm      = shared[1..33]                           // x-coordinate, 32 bytes
key      = HKDF-SHA256(ikm, salt = eph_pk, info = utf8("tervane/ecies/v1"), L = 32)
iv       = randomBytes(12)
aad      = §6.3
ct_tag   = AES-256-GCM(key, iv, aad).encrypt(IntentPayload)   // 288 + 16 bytes
blob     = 0x01 ‖ eph_pk ‖ iv ‖ ct_tag              // 1 + 33 + 12 + 304 = 350 bytes
```

### §6.3 Associated data
```
aad = abi.encode(
    bytes32 keccak("TERVANE_INTENT_V1"),
    uint256 chainId,        // 10143 on Monad testnet
    address tervaneCore,
    address sender)         // msg.sender of submitIntent
```
Binding the sender means a blob copied from the chain and resubmitted by anyone else fails authentication. Binding chain and contract prevents cross-deployment replay.

### §6.4 Decrypt (enclave)
Parse `blob`: `version = blob[0]` must be `0x01`; `eph_pk = blob[1..34]`; `iv = blob[34..46]`; `ct_tag = blob[46..350]`. Derive `key` with `ENCLAVE_SK` and `eph_pk`, rebuild `aad` from the inbox message's `sender`, decrypt. GCM tag failure → `E_DECRYPT`.

Libraries (QuickJS-safe, v2 import paths):
```ts
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { gcm } from "@noble/ciphers/aes.js"
import { randomBytes } from "@noble/ciphers/utils.js"   // client only; enclave never needs randomness
```
Verify these paths against the installed versions in spike S2 (`BUILD-PLAN.md`).

---

## §7 Ledger state and Merkle commitment

### §7.1 Types
```
Meta     { epoch: u64, cursor: u64, nextLoanId: u64 }
Account  { addr, usdFree, usdReserved, ethFree, ethReserved, ethLocked: u256,
           tier: u8, repaidVolume: u256, nonce: u64 }
Order    { id: u64, owner, side: u8 (1 lend | 2 borrow), tenorId: u8,
           remaining: u256 (tUSD), collateral: u256 (tETH; 0 for lend),
           expiresAtEpoch: u64, blobHash: bytes32 }
Loan     { id: u64, borrower, tenorId: u8, principal: u256, rateBps: u32,
           owed: u256, collateral: u256, tierAtOpen: u8,
           openedAt: u64, maturity: u64, lenders: LenderShare[] }
LenderShare { lender: address, amount: u256 }   // sorted by lender asc, duplicates merged
```

**Orders carry no rate.** The rate is re-derived each epoch by decrypting the order's original blob (server supplies it; enclave checks `keccak(blob) == order.blobHash`). This is how a partially filled lend order keeps its bid private across epochs.

Accounts are never pruned (their `nonce` must persist). Closed orders and closed loans are deleted from the state.

### §7.2 Leaf encoding (OpenZeppelin double-hash convention)
```
leaf(x) = keccak(bytes.concat(keccak(abi.encode(...fields of x...))))

META    : abi.encode(uint8 0, uint64 epoch, uint64 cursor, uint64 nextLoanId)
ACCOUNT : abi.encode(uint8 1, address addr, uint256 usdFree, uint256 usdReserved,
                     uint256 ethFree, uint256 ethReserved, uint256 ethLocked,
                     uint8 tier, uint256 repaidVolume, uint64 nonce)
ORDER   : abi.encode(uint8 2, uint64 id, address owner, uint8 side, uint8 tenorId,
                     uint256 remaining, uint256 collateral, uint64 expiresAtEpoch,
                     bytes32 blobHash)
LOAN    : abi.encode(uint8 3, uint64 id, address borrower, uint8 tenorId,
                     uint256 principal, uint32 rateBps, uint256 owed, uint256 collateral,
                     uint8 tierAtOpen, uint64 openedAt, uint64 maturity, bytes32 lendersHash)

lendersHash = keccak(abi.encode((address,uint256)[] lenders))
```

### §7.3 Tree
1. Compute all leaf hashes (exactly one META leaf; every account, order, loan).
2. Sort leaf hashes ascending as uint256.
3. Build levels bottom-up. Pair `(a, b)` hashes to `keccak(abi.encodePacked(min(a,b), max(a,b)))` (commutative, same as OZ `Hashes.commutativeKeccak256`). If a level has an odd count, the last node is **carried up unchanged**.
4. Root = the single remaining node. (A tree always has ≥ 1 leaf because META exists.)

Proofs are the sibling list bottom-up, skipping levels where the node was carried. `MerkleProof.verify(proof, root, leaf)` from OpenZeppelin v5 verifies them as-is.

### §7.4 State diff (enclave → server)
```
EpochDiff {
  epoch, prevRoot, newRoot,
  meta: Meta,
  upsertAccounts: Account[], upsertOrders: Order[], upsertLoans: Loan[],
  deleteOrders: u64[], deleteLoans: u64[]
}
```
JSON with all bigints as decimal strings. Server applies to its copy of `prevRoot`'s state, recomputes the root with `packages/core`, and rejects unless it equals `newRoot`.

---

## §8 Auction (uniform-price call auction, per tenor)

Inputs per tenor `τ`: open lend orders `L` (with decrypted `minRate`), open borrow orders `B` (with decrypted `maxRate`), price `p`, accounts.

```
sort L by (minRate asc, id asc)          // id = inbox index = time priority
sort B by (maxRate desc, id asc)
slices = L as mutable remaining amounts
consumed = []                             // (lendOrderId, amount, minRate)
fills = []

for b in B:
    if !openRatioOk(b, p, account(b.owner)): continue          // §10.2, stays open
    need = b.remaining
    # dry-run: can cheapest available slices with minRate ≤ b.maxRate cover need?
    avail = Σ remaining(l) for l in L where minRate(l) ≤ b.maxRate
    if avail < need: continue                                  // whole-or-nothing, stays open
    take from L in sorted order while need > 0 and minRate(l) ≤ b.maxRate:
        x = min(remaining(l), need); remaining(l) -= x; need -= x
        record slice (l.id, l.owner, x, minRate(l)) for this borrow
    fills.append(b with its slices)

if fills empty: no clear for τ
r* = max(minRate over all recorded slices)                     // marginal accepted lend
```

**Why every filled borrow can afford `r*`:** borrows are processed in descending max-rate order and always consume the cheapest remaining slices, so slice rates are non-decreasing across the loop. The most expensive slice was taken by the latest filled borrow, whose `maxRate ≥` that slice. Earlier filled borrows have `maxRate ≥` the latest's. Hence `r* ≤ maxRate(b)` for every filled `b`, and `minRate(l) ≤ r*` for every consumed slice. Test this as a property (I4).

Application, for each fill (in fill order):
- New loan: `principal = b.remaining`, `rateBps = r*`, `owed = §9`, `collateral = b.collateral`, `tierAtOpen = borrower.tier`, `openedAt = asOf`, `maturity = asOf + tenorSeconds(τ)`, `lenders = merge(slices by owner)`.
- Lenders: `usdReserved -= x` per slice; lend order `remaining -= x`; delete order at 0.
- Borrower: `usdFree += principal`; `ethReserved -= collateral`; `ethLocked += collateral`; delete borrow order.

Report `Clear{ tenorId: τ, rateBps: r*, volume: Σ principal }`.

**What leaks:** `r*` (equal to the marginal lender's bid, but unattributable because fills are never published) and aggregate volume. Nothing about unfilled orders.

**Incentive note (be precise in all copy):** an inframarginal lender's bid only decides whether they fill, not what they earn, so overstating gains nothing and understating only risks a fill below their true minimum. Only the marginal lender can move `r*`, by shading up at the risk of not filling. Do not claim strict dominant-strategy truthfulness.

---

## §9 Interest

Simple interest for the full tenor, fixed at open:

```
interest = ⌈ principal × rateBps × tenorSeconds / (BPS × YEAR) ⌉
owed     = principal + interest
```

Early repayment pays full `owed` (term loan semantics). Repay distributes `owed` to lenders pro rata to `LenderShare.amount` (§1 split rule).

---

## §10 Tiers, collateral, liquidation

### §10.1 Tier table
| tier | name | openRatioBps | liqRatioBps | minRepaid (tUSD, 6dp) |
|---|---|---|---|---|
| 0 | Bronze | 20_000 | 16_000 | 0 |
| 1 | Silver | 18_000 | 14_500 | 1_000e6 |
| 2 | Gold | 15_000 | 12_500 | 5_000e6 |
| 3 | Platinum | 13_000 | 11_500 | 20_000e6 |

Max outstanding principal (active loans **plus** open borrow orders):
```
cap(0) = 2_000e6
cap(1) = max(2_000e6, repaidVolume)
cap(2) = repaidVolume × 3 / 2
cap(3) = repaidVolume × 2
```

### §10.2 Value and checks
```
valueUsd(collWei, p) = ⌊ collWei × p / VALUE_SCALE ⌋            // conservative (down)
openRatioOk:  valueUsd(collateral) × BPS ≥ principal × openRatioBps(tier)
liquidatable: valueUsd(collateral) × BPS <  owed × liqRatioBps(tierAtOpen)
              OR asOf > maturity + GRACE
```
`tierAtOpen` (not current tier) governs liquidation, so later upgrades/downgrades never change an open loan's risk terms.

### §10.3 Tier transitions
- After a repay: `repaidVolume += principal`; `tier = max t such that repaidVolume ≥ minRepaid(t)`. Never decreases on repay.
- After a liquidation: `tier = max(0, tier − 1)`; `repaidVolume = minRepaid(tier)` (prevents instant re-upgrade).

### §10.4 Liquidation settlement
```
seizeCap = ⌈ owed × (BPS + LIQ_PENALTY_BPS) × VALUE_SCALE / (BPS × p) ⌉
seized   = min(collateral, seizeCap)
fee      = ⌊ seized × LIQ_FEE_BPS / BPS ⌋          → treasury.ethFree
pot      = seized − fee                             → lenders pro rata (§1 split), credited to ethFree
borrower.ethLocked -= collateral
borrower.ethFree   += collateral − seized
```
If `collateral` is worth less than `owed`, lenders absorb the shortfall pro rata (no socialization beyond the loan). The borrower keeps the borrowed tUSD; the debt is extinguished.

---

## §11 Settlement report

```solidity
struct Clear  { uint8 tenorId; uint32 rateBps; uint256 volume; }
struct Payout { address to; uint8 asset; uint256 requested; uint256 paid; }
struct SettlementReport {
    uint64  epoch;
    bytes32 prevRoot;
    bytes32 newRoot;
    uint64  inboxTo;
    bytes32 inboxAccTo;
    uint64  asOf;
    uint80  priceRoundId;
    int256  priceUsed;
    Clear[]  clears;
    Payout[] payouts;
}
report bytes = abi.encode(uint8(1) /*reportVersion*/, SettlementReport)
```

Onchain checks in `_processReport` (all must pass; each has a distinct custom error):
1. `!escaped`.
2. `reportVersion == 1`.
3. `epoch == lastEpoch + 1`.
4. `prevRoot == stateRoot`.
5. `cursor ≤ inboxTo ≤ inboxCount` and `inboxAccTo == inboxAcc[inboxTo]`.
6. `asOf ≥ lastAsOf` and `|asOf − block.timestamp| ≤ MAX_SKEW`.
7. `priceRoundId ≥ lastPriceRoundId`; `feed.getRoundData(priceRoundId)` returns `answer == priceUsed > 0` and `block.timestamp − updatedAt ≤ MAX_PRICE_AGE`.
8. `payouts.length ≤ MAX_PAYOUTS_PER_EPOCH`; for each: `paid ≤ requested ≤ pendingWithdraw[to][asset]`; then `pendingWithdraw -= requested`; transfer `paid`.
9. Apply: `stateRoot = newRoot; lastEpoch = epoch; cursor = inboxTo; lastAsOf = asOf; lastPriceRoundId = priceRoundId; lastSettleAt = block.timestamp`.
10. Emit `EpochSettled(epoch, newRoot, inboxTo, asOf, priceUsed)` and one `Cleared(epoch, tenorId, rateBps, volume)` per clear.

Note that check 8 constrains payouts **only by requests**, never by ledger balance — the contract can't see balances. The ledger guarantees `paid ≤ free`. Together: an honest enclave never overpays, and no enclave can pay an address that didn't request onchain. A compromised enclave that credits an attacker's account in the ledger can still be drained through that account's requests; see THREAT-MODEL A4.

---

## §12 Epoch transition (exact order)

```
runEpoch(prev, msgs, openOrderBlobs, price, asOf, params):
 0. newEpoch = prev.meta.epoch + 1
 1. Verify: merkleRoot(prev) == onchain.stateRoot; inbox accumulator (§4); blob hashes.
 2. Expire: delete orders with expiresAtEpoch != 0 && expiresAtEpoch < newEpoch; release reserves.
    Then, for each remaining open order (id asc): decrypt its blob with the order owner as AAD sender;
    if it no longer decrypts (enclave key rotated), release reserves and delete it as if cancelled (D-20).
 3. Ingest msgs in index order:
      DEPOSIT  → free[asset] += amount
      WITHDRAW → paid = min(amount, free[asset]); free[asset] -= paid; payouts.push({to, asset, requested: amount, paid})
                 (stop ingesting before the message that would make payouts > MAX_PAYOUTS_PER_EPOCH;
                  inboxTo = last ingested index)
      INTENT   → §5.2, then by action:
        LEND   : tenor valid; 1 ≤ rate ≤ MAX_RATE; amount > 0; amount ≤ usdFree
                 → usdFree -= amount; usdReserved += amount; create Order(side=1, remaining=amount)
        BORROW : tenor valid; 1 ≤ rate ≤ MAX_RATE; amount > 0; collateral > 0;
                 collateral ≤ ethFree; outstanding(owner) + amount ≤ cap(tier);
                 openRatioOk at price
                 → ethFree -= collateral; ethReserved += collateral; create Order(side=2, remaining=amount)
        CANCEL : order exists && owner == sender → release reserve; delete order
        REPAY  : loan exists && borrower == sender && usdFree ≥ owed → §9 split; unlock; §10.3
 4. Auction per tenorId ascending (§8). Rates come from decrypting each open order's blob.
 5. Liquidate: for each active loan by id asc, if liquidatable → §10.4, §10.3; delete loan.
 6. meta = { epoch: newEpoch, cursor: inboxTo, nextLoanId }
 7. newRoot = merkleRoot(state); build EpochDiff and SettlementReport.
 8. Assert invariants I1–I3, I6 (§13). Any failure → throw E_INVARIANT (never write).
```

Every step consumes only deterministic inputs. Two honest executions of the same epoch produce byte-identical diffs and reports.

---

## §13 Invariants

| ID | Statement | Checked by |
|---|---|---|
| I1 | Per asset: Σ accounts (free + reserved [+ locked for ETH]) == Σ deposits − Σ paid withdrawals (ledger-internal), and ≤ `balanceOf(TervaneCore)` | enclave each epoch (balance via chain read), property tests |
| I2 | Per account: Σ open lend `remaining` == `usdReserved`; Σ open borrow `collateral` == `ethReserved`; Σ active loan `collateral` == `ethLocked` | enclave, property tests |
| I3 | Per loan: Σ `lenders.amount` == `principal`; `owed ≥ principal` | enclave, property tests |
| I4 | Per clear: every consumed slice `minRate ≤ r* ≤` every filled borrow's `maxRate` | auction property tests |
| I5 | Server-recomputed root == enclave root for every epoch | server on POST, integration test |
| I6 | No rate field exists in any persisted state type; no decrypted rate is ever serialized | type-level + `scripts/audit-leaks.ts` |
| I7 | Onchain: `pendingWithdraw` never underflows; `paid ≤ requested` | Foundry invariant tests |
| I8 | Determinism: same inputs → identical report bytes | test runs `runEpoch` twice and on shuffled map insertion orders |

---

## §14 Escape hatch math (onchain)

Activation: `activateEscape()` succeeds iff `block.timestamp > lastSettleAt + ESCAPE_DELAY`; sets `escaped = true` permanently.

- `exitAccount(Account a, bytes32[] proof)`: `msg.sender == a.addr`, `!exited[a.addr]`, proof valid against `stateRoot` → transfer `a.usdFree + a.usdReserved` tUSD and `a.ethFree + a.ethReserved` tETH; `exited = true`. (`ethLocked` is released through loan resolution.)
- `escapeRepay(Loan l, LenderShare[] s, bytes32[] proof)`: `msg.sender == l.borrower`; `keccak(abi.encode(s)) == l.lendersHash`; `!resolved[l.id]`; proof valid → pull `l.owed` tUSD from borrower; `claimUsd[lender_i] += split(l.owed, s)`; transfer `l.collateral` tETH to borrower; `resolved = true`.
- `escapeLiquidate(Loan l, LenderShare[] s, bytes32[] proof)`: anyone; same proof/hash checks; `latestRoundData` fresh (`MAX_PRICE_AGE`); liquidatable per §10.2 using `block.timestamp` as `asOf` → §10.4 amounts: `claimEth[lender_i] += split(pot)`, `claimEth[treasury] += fee`, `claimEth[borrower] += collateral − seized`; `resolved = true`.
- `claim()`: pays and zeroes `claimUsd[msg.sender]`, `claimEth[msg.sender]`.

Split rule is §1 (floor + dust to largest share, ties lowest address) implemented identically in Solidity.

Selective disclosure (onchain credit history, works any time, not only in escape): `verifyAccount(Account a, bytes32[] proof) view returns (bool)` lets a user prove tier and repaid volume against the current root without revealing anything else.

---

## §15 Golden vectors (`packages/core/test/vectors/`)

| File | Contents |
|---|---|
| `inbox.json` | 5 messages of mixed kinds → every `msgHash_i`, `acc_i` |
| `payload.json` | 4 payloads (one per action) → 288-byte encodings |
| `ecies.json` | fixed `ENCLAVE_SK`, fixed `eph_sk`, fixed `iv`, sender, chainId, core → `aad`, `key`, `blob`; plus a tampered-sender case that must fail |
| `leaves.json` | one of each leaf type → inner hash and leaf hash; `lendersHash` with 3 shares |
| `tree.json` | 1, 2, 3, 7, 8 leaves → roots and every proof |
| `auction.json` | the demo book (§DEMO) + 6 edge books (no cross, exact cross, whole-or-nothing skip, ties, multi-tenor, open-ratio failure) → fills and `r*` |
| `liquidation.json` | 4 cases: healthy, unhealthy, past maturity, underwater → seized/fee/pot/splits |
| `report.json` | full `SettlementReport` → ABI bytes |

Foundry reads them with `vm.readFile` + `vm.parseJson` and asserts equality with the Solidity implementations (inbox hashing, leaf hashing, proof verification, split rule, liquidation math, report decoding).
